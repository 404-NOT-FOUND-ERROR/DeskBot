"""Compress a verified local DB copy, or restore it to a NEW offline path.

Never opens the live service, deletes a source, overwrites a destination, or
includes credentials. Use after checkpoint-local.py; remove the redundant raw
copy only after this command reports verified. Recovery uses the matching code.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path


def stream_copy(source, target=None):
    digest, size = hashlib.sha256(), 0
    while block := source.read(1024 * 1024):
        digest.update(block)
        size += len(block)
        if target is not None:
            target.write(block)
    return {"bytes": size, "sha256": digest.hexdigest()}


def pack(folder):
    folder = folder.resolve(strict=True)
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    verification = json.loads((folder / "verification.json").read_text(encoding="utf-8"))
    if not verification.get("verified") or verification.get("database_integrity") != "ok":
        raise ValueError("requires a verified checkpoint database")
    source, archive = folder / "world.sqlite", folder / "world.sqlite.gz"
    with source.open("rb") as src, archive.open("xb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=3, mtime=0) as dst:
            expected = stream_copy(src, dst)
    with gzip.open(archive, "rb") as src:
        if stream_copy(src) != expected:
            raise ValueError("archive verification failed; source retained")
    info = {**expected, "file": archive.name, "compressed_bytes": archive.stat().st_size,
            "codec": "gzip", "verified": True, "source_retained": True}
    manifest["database"]["archive"] = info
    temporary = manifest_path.with_suffix(".json.pending")
    with temporary.open("x", encoding="utf-8") as dst:
        json.dump(manifest, dst, ensure_ascii=False, indent=2)
    os.replace(temporary, manifest_path)
    return info


def restore(folder, output):
    folder, output = folder.resolve(strict=True), output.resolve()
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    info = manifest["database"]["archive"]
    # Restrict the archive name, never follow a manifest path outside its folder.
    if info["file"] != "world.sqlite.gz" or info["codec"] != "gzip" or not info["verified"]:
        raise ValueError("unsupported or unverified archive")
    if output.exists() or any(Path(str(output) + ext).exists() for ext in ("-wal", "-shm")):
        raise FileExistsError("restore requires a new offline destination")
    with gzip.open(folder / info["file"], "rb") as src, output.open("xb") as dst:
        actual = stream_copy(src, dst)
    if actual != {key: info[key] for key in ("bytes", "sha256")}:
        raise ValueError("restore checksum failed; do not use this output")
    return {"verified": True, "output": str(output), **actual}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("pack", "restore"))
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--output", type=Path, help="new offline file, required for restore")
    args = parser.parse_args()
    if args.operation == "restore" and not args.output:
        parser.error("restore requires --output")
    print(json.dumps(pack(args.checkpoint) if args.operation == "pack" else restore(args.checkpoint, args.output), ensure_ascii=False))
