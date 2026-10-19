"""Local recovery checkpoint. Never uploads data or opens a world runtime.

Sources follow git's tracked/non-ignored inventory; local secrets are excluded
again explicitly. SQLite uses the online backup API, including committed WAL.
Verify the extracted source and an independently opened database before success.
"""
import argparse
import hashlib
import json
import pathlib
import sqlite3
import subprocess
import time
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source_files(root, git):
    names = subprocess.check_output([git, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root).decode("utf-8").split("\0")
    for name in sorted(set(filter(None, names))):
        path = pathlib.PurePosixPath(name)
        if any(part in {".git", "node_modules", "data", "runtime", "__pycache__"} for part in path.parts):
            continue
        if path.name.startswith(".env") or path.name in {"llm_config.json", "weather.env", "body_devices.json"}:
            continue
        if any(word in path.name.lower() for word in ("credentials", "secret")) or ".sqlite" in path.name:
            continue
        if (root / name).is_file():
            yield name


def verify_checkpoint(destination):
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    restored = destination / "restore-check"
    restored.mkdir(exist_ok=False)
    with zipfile.ZipFile(destination / "source.zip") as archive:
        for name, expected in manifest["sources"].items():
            target = (restored / name).resolve()
            if not target.is_relative_to(restored.resolve()):
                raise ValueError("unsafe source path")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
            if digest(target.read_bytes()) != expected:
                raise ValueError("source hash mismatch: " + name)
    database = destination / "world.sqlite"
    if database.exists():
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as copy:
            check = copy.execute("PRAGMA integrity_check").fetchall()
            if check != [("ok",)]:
                raise ValueError("checkpoint integrity check failed")
            namespaces = dict(copy.execute("SELECT namespace, count(*) FROM records GROUP BY namespace"))
            canonical = {key: digest(payload.encode()) for key, payload in copy.execute("SELECT record_id,payload_json FROM records WHERE namespace='canonical-world.states'")}
        if namespaces != manifest["database"]["namespaces"] or canonical != manifest["database"]["canonical_hashes"]:
            raise ValueError("restored database differs from backup manifest")
    return {"verified": True, "source_files": len(manifest["sources"]), "database_integrity": "ok" if database.exists() else "not_included", "restored_source": str(restored)}


def checkpoint(root, database, destination, git="git"):
    started = time.monotonic()
    root, destination = root.resolve(), destination.resolve()
    destination.mkdir(parents=True, exist_ok=False)
    manifest = {"schema": "deskbot.local-checkpoint.v1", "created_at_unix": time.time(), "local_only": True,
                "git_head": subprocess.check_output([git, "rev-parse", "HEAD"], cwd=root).decode().strip(),
                "excluded": "dependencies, ignored files, local credentials; reconfigure credentials after recovery", "sources": {}}
    with zipfile.ZipFile(destination / "source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name in source_files(root, git):
            data = (root / name).read_bytes()
            archive.writestr(name, data)
            manifest["sources"][name] = digest(data)
    if database:
        database = database.resolve(strict=True)
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as source, sqlite3.connect(destination / "world.sqlite") as copy:
            source.backup(copy, pages=2048, sleep=.05)
            manifest["database"] = {
                "namespaces": dict(copy.execute("SELECT namespace,count(*) FROM records GROUP BY namespace")),
                "canonical_hashes": {key: digest(payload.encode()) for key, payload in copy.execute("SELECT record_id,payload_json FROM records WHERE namespace='canonical-world.states'")},
                "bytes": (destination / "world.sqlite").stat().st_size,
            }
    (destination / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    result = {**verify_checkpoint(destination), "elapsed_seconds": round(time.monotonic() - started, 2), "checkpoint": str(destination)}
    (destination / "verification.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    parser.add_argument("--database", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, required=True, help="A new local directory; never reused")
    parser.add_argument("--git", default="git")
    args = parser.parse_args()
    print(json.dumps(checkpoint(args.root, args.database, args.output, args.git), ensure_ascii=False))
