"""Standard-library HTTP server for the DeskBot voice sidecar.

Run from this directory with ``python -m voice_sidecar`` or
``python -m voice_sidecar.server``.  The default implementation is explicitly
model-free: it accepts text as a deterministic ASR stand-in and synthesizes a
short PCM tone for TTS integration tests.  Model workers can replace the two
``_run_asr``/``_run_tts`` methods without changing the HTTP contract.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import struct
import threading
import time
import wave
from collections import OrderedDict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Mapping
from urllib.parse import unquote

from .protocol import (
    ASR_SCHEMA,
    CANCEL_SCHEMA,
    SERVICE_NAME,
    SERVICE_VERSION,
    TTS_SCHEMA,
    Capabilities,
    ProtocolError,
    asr_input,
    audio_metadata,
    error_body,
    make_asr_event,
    optional_identity,
    profile_name,
    tts_input,
)


# Base64 expands the advertised 12 MiB audio ceiling by roughly 4/3; leave
# headroom for JSON metadata so the body limit does not silently lower it.
MAX_BODY_BYTES = 20 * 1024 * 1024
DEFAULT_TIMEOUT_MS = 30_000
MAX_TIMEOUT_MS = 120_000
MAX_SIMULATED_DELAY_MS = 30_000
MAX_COMPLETED_IDS = 1_024


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class _Operation:
    def __init__(self, request_id: str, correlation_id: str) -> None:
        self.request_id = request_id
        self.correlation_id = correlation_id
        self.cancel_event = threading.Event()
        self.started = time.monotonic()


class OperationRegistry:
    """Track active requests and cooperative cancellation tokens."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._active: dict[str, _Operation] = {}
        self._completed: OrderedDict[str, float] = OrderedDict()

    def start(self, request_id: str, correlation_id: str) -> _Operation:
        with self._lock:
            if request_id in self._active:
                raise ProtocolError(409, "request_in_flight", f"request {request_id} is already running", request_id=request_id, correlation_id=correlation_id)
            operation = _Operation(request_id, correlation_id)
            self._active[request_id] = operation
            return operation

    def finish(self, operation: _Operation) -> None:
        with self._lock:
            self._active.pop(operation.request_id, None)
            self._completed[operation.request_id] = time.time()
            self._completed.move_to_end(operation.request_id)
            while len(self._completed) > MAX_COMPLETED_IDS:
                self._completed.popitem(last=False)

    def cancel(self, *, request_id: str | None = None, correlation_id: str | None = None) -> list[str]:
        with self._lock:
            selected: list[str] = []
            for operation in self._active.values():
                if request_id is not None and operation.request_id != request_id:
                    continue
                if correlation_id is not None and operation.correlation_id != correlation_id:
                    continue
                operation.cancel_event.set()
                selected.append(operation.request_id)
            return selected

    def is_active(self, request_id: str) -> bool:
        with self._lock:
            return request_id in self._active

    def was_completed(self, request_id: str) -> bool:
        with self._lock:
            return request_id in self._completed

    def active_count(self) -> int:
        with self._lock:
            return len(self._active)


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _coerce_int(value: Any, field: str, *, default: int, minimum: int, maximum: int, request_id: str | None = None, correlation_id: str | None = None) -> int:
    if value is None:
        return default
    # bool is an int subclass but is never a meaningful timeout/delay.
    if isinstance(value, bool):
        raise ProtocolError(400, "invalid_request", f"{field} must be an integer", request_id=request_id, correlation_id=correlation_id)
    if isinstance(value, float) and not value.is_integer():
        raise ProtocolError(400, "invalid_request", f"{field} must be an integer", request_id=request_id, correlation_id=correlation_id)
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise ProtocolError(400, "invalid_request", f"{field} must be an integer", request_id=request_id, correlation_id=correlation_id) from None
    if result < minimum or result > maximum:
        raise ProtocolError(400, "invalid_request", f"{field} must be between {minimum} and {maximum}", request_id=request_id, correlation_id=correlation_id)
    return result


class VoiceSidecar:
    """Request dispatcher shared by HTTP handlers and in-process tests."""

    def __init__(self, *, now: Callable[[], str] = utc_now, capabilities: Capabilities | None = None) -> None:
        self.now = now
        self.capabilities = capabilities or Capabilities()
        self.operations = OperationRegistry()

    def health(self) -> dict[str, Any]:
        return {
            "schema": "voice.sidecar-health.v0.1",
            "service": SERVICE_NAME,
            "status": "ok",
            "version": SERVICE_VERSION,
            "mode": "fake",
            "active_requests": self.operations.active_count(),
            "time": self.now(),
        }

    def capability_response(self) -> dict[str, Any]:
        return {
            "schema": "voice.sidecar-capabilities.v0.1",
            "service": SERVICE_NAME,
            "version": SERVICE_VERSION,
            "mode": "fake",
            "capabilities": self.capabilities.as_dict(),
        }

    def _check_operation(self, operation: _Operation, timeout_ms: int) -> None:
        if operation.cancel_event.is_set():
            raise ProtocolError(409, "cancelled", "request was cancelled", request_id=operation.request_id, correlation_id=operation.correlation_id)
        if (time.monotonic() - operation.started) * 1000 >= timeout_ms:
            raise ProtocolError(504, "timeout", f"request exceeded timeout_ms={timeout_ms}", request_id=operation.request_id, correlation_id=operation.correlation_id)

    def _delay(self, operation: _Operation, *, delay_ms: int, timeout_ms: int) -> None:
        if delay_ms <= 0:
            self._check_operation(operation, timeout_ms)
            return
        deadline = time.monotonic() + delay_ms / 1000
        while True:
            self._check_operation(operation, timeout_ms)
            remaining = min(0.01, max(0.0, deadline - time.monotonic()))
            if remaining <= 0:
                return
            operation.cancel_event.wait(remaining)

    def _run_with_limits(self, fields: Mapping[str, Any], worker: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        request_id = str(fields["request_id"])
        correlation_id = str(fields["correlation_id"])
        timeout_ms = _coerce_int(
            fields.get("timeout_ms"),
            "timeout_ms",
            default=DEFAULT_TIMEOUT_MS,
            minimum=1,
            maximum=MAX_TIMEOUT_MS,
            request_id=request_id,
            correlation_id=correlation_id,
        )
        delay_ms = _coerce_int(
            fields.get("simulate_delay_ms"),
            "simulate_delay_ms",
            default=0,
            minimum=0,
            maximum=MAX_SIMULATED_DELAY_MS,
            request_id=request_id,
            correlation_id=correlation_id,
        )
        operation = self.operations.start(request_id, correlation_id)
        try:
            self._delay(operation, delay_ms=delay_ms, timeout_ms=timeout_ms)
            self._check_operation(operation, timeout_ms)
            result = worker()
            self._check_operation(operation, timeout_ms)
            if isinstance(result, dict):
                result.setdefault("elapsed_ms", round((time.monotonic() - operation.started) * 1000, 3))
            return result
        finally:
            self.operations.finish(operation)

    def asr(self, body: Mapping[str, Any]) -> dict[str, Any]:
        fields = asr_input(body)

        def worker() -> dict[str, Any]:
            event = make_asr_event(fields, occurred_at=self.now())
            result_item = {
                "stage": fields["stage"],
                "is_final": fields["is_final"],
                "event_id": fields["event_id"],
                "raw_utterance": fields["raw_utterance"],
                "clean_utterance": fields["clean_utterance"],
                "text": fields["clean_utterance"],
                "confidence": fields["confidence"],
                "language": fields["language"],
                "metadata": fields.get("metadata"),
            }
            result = {
                **{"schema": ASR_SCHEMA, "ok": True},
                "request_id": fields["request_id"],
                "correlation_id": fields["correlation_id"],
                "operation": "asr",
                "provider": "fake",
                "model": "identity-text-v0",
                "stage": fields["stage"],
                "is_final": fields["is_final"],
                "utterance_id": fields["utterance_id"],
                "stream_id": fields["stream_id"],
                "event_id": fields["event_id"],
                "character_id": fields.get("character_id"),
                "device_id": fields.get("device_id"),
                "shell_id": fields.get("shell_id"),
                "role_revision": fields.get("role_revision"),
                "occurred_at": event["occurred_at"],
                "format": fields["format"],
                "raw_utterance": fields["raw_utterance"],
                "clean_utterance": fields["clean_utterance"],
                # ``text`` is retained as a Node/client convenience alias.
                "text": fields["clean_utterance"],
                "confidence": fields["confidence"],
                "language": fields["language"],
                "done": fields["is_final"],
                "final": fields["is_final"],
                "partial": not fields["is_final"],
                "results": [result_item],
                "event": event,
                "metadata": fields.get("metadata"),
            }
            if fields.get("audio") is not None:
                result["audio"] = fields["audio"]
            return result

        return self._run_with_limits({**dict(body), **fields}, worker)

    @staticmethod
    def _synthesize_pcm(text: str, profile: str, sample_rate_hz: int) -> tuple[bytes, int]:
        # A deterministic, non-silent tone gives integration tests an actual
        # payload while making it impossible to mistake this for natural TTS.
        duration_ms = max(120, min(2_000, 80 + len(text) * 35))
        sample_count = max(1, int(sample_rate_hz * duration_ms / 1000))
        seed = sum((index + 1) * ord(char) for index, char in enumerate(f"{profile}\0{text}"))
        frequency = 220 + seed % 440
        amplitude = 2_000
        frames = bytearray()
        for index in range(sample_count):
            value = int(amplitude * math.sin(2 * math.pi * frequency * index / sample_rate_hz))
            frames.extend(struct.pack("<h", value))
        return bytes(frames), duration_ms

    @staticmethod
    def _wav_bytes(pcm: bytes, sample_rate_hz: int, channels: int = 1) -> bytes:
        stream = io.BytesIO()
        with wave.open(stream, "wb") as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate_hz)
            wav_file.writeframes(pcm)
        return stream.getvalue()

    def tts(self, body: Mapping[str, Any]) -> dict[str, Any]:
        fields = tts_input(body)

        def worker() -> dict[str, Any]:
            profile = profile_name(fields["profile"])
            fmt = fields["format"]
            pcm, duration_ms = self._synthesize_pcm(fields["text"], profile, fmt["sample_rate_hz"])
            if fmt["codec"] == "wav":
                payload = self._wav_bytes(pcm, fmt["sample_rate_hz"], fmt["channels"])
                mime_type = "audio/wav"
                extension = "wav"
            else:
                payload = pcm
                mime_type = "audio/pcm"
                extension = "pcm"
            metadata = audio_metadata(payload, fmt, mime_type=mime_type, duration_ms=duration_ms)
            # Keep metadata in the compact nested form while also exposing
            # the flattened fields consumed by the Node adapter and firmware
            # bridge.  Both names are intentionally equivalent aliases.
            audio = {
                **metadata,
                "codec": fmt["codec"],
                "sample_rate_hz": fmt["sample_rate_hz"],
                "channels": fmt["channels"],
                "content_type": mime_type,
                "audio_id": f"audio-{fields['request_id']}",
                "data_base64": base64.b64encode(payload).decode("ascii"),
                "audio_base64": base64.b64encode(payload).decode("ascii"),
            }
            return {
                "schema": TTS_SCHEMA,
                "ok": True,
                "request_id": fields["request_id"],
                "correlation_id": fields["correlation_id"],
                "operation": "tts",
                "provider": "fake",
                "model": "tone-v0",
                "text": fields["text"],
                "profile": fields["profile"],
                "profile_id": profile,
                "stream_id": fields["stream_id"],
                "character_id": fields.get("character_id"),
                "device_id": fields.get("device_id"),
                "shell_id": fields.get("shell_id"),
                "role_revision": fields.get("role_revision"),
                "format": fmt,
                "audio": audio,
                # ``audio_b64`` is a convenience alias used by simple scripts.
                "audio_b64": audio["data_base64"],
                "audio_id": audio["audio_id"],
                # This is a traceable ephemeral reference, not a filesystem
                # path.  A production worker may replace it with blob storage.
                "audio_ref": f"memory://voice-sidecar/{fields['request_id']}.{extension}",
                "metadata": fields.get("metadata"),
            }

        return self._run_with_limits({**dict(body), **fields}, worker)

    def cancel(self, body: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(body, Mapping) or isinstance(body, (str, bytes, bytearray)):
            raise ProtocolError(400, "invalid_request", "body must be a JSON object")
        request_id, correlation_id = optional_identity(body)
        if request_id is None and correlation_id is None:
            raise ProtocolError(400, "invalid_request", "request_id or correlation_id is required")
        selected = self.operations.cancel(request_id=request_id, correlation_id=correlation_id)
        if request_id is not None and not selected and not self.operations.was_completed(request_id):
            raise ProtocolError(404, "request_not_found", f"request {request_id} is not active or completed", request_id=request_id, correlation_id=correlation_id)
        return {
            "schema": CANCEL_SCHEMA,
            "ok": True,
            "accepted": True,
            "request_id": request_id,
            "correlation_id": correlation_id,
            "cancelled": bool(selected),
            "request_ids": selected,
        }


class _RequestHandler(BaseHTTPRequestHandler):
    server: "VoiceHTTPServer"
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003 - stdlib hook name
        # Do not log request bodies, text, or audio.  A concise access line is
        # sufficient for local debugging and keeps secrets out of logs.
        return

    def _headers(self, length: int) -> dict[str, str]:
        return {
            "access-control-allow-headers": "content-type",
            "access-control-allow-methods": "GET,POST,OPTIONS",
            "access-control-allow-origin": "*",
            "cache-control": "no-store",
            "content-length": str(length),
            "content-type": "application/json; charset=utf-8",
            "connection": "close",
        }

    def _send(self, status: int, body: Mapping[str, Any]) -> None:
        payload = _json_bytes(body)
        self.send_response(status)
        for key, value in self._headers(len(payload)).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, error: ProtocolError, *, body: Mapping[str, Any] | None = None) -> None:
        request_id, correlation_id = optional_identity(body or {})
        self._send(error.status, error_body(error, request_id=request_id, correlation_id=correlation_id))

    def _read_json(self) -> dict[str, Any]:
        raw_length = self.headers.get("content-length")
        try:
            length = int(raw_length) if raw_length is not None else None
        except ValueError:
            raise ProtocolError(400, "invalid_request", "content-length must be an integer") from None
        if length is not None and (length < 0 or length > MAX_BODY_BYTES):
            raise ProtocolError(413, "payload_too_large", f"request body exceeds {MAX_BODY_BYTES} bytes")
        if length is None:
            raw = self.rfile.read(MAX_BODY_BYTES + 1)
        else:
            raw = self.rfile.read(length)
        if len(raw) > MAX_BODY_BYTES:
            raise ProtocolError(413, "payload_too_large", f"request body exceeds {MAX_BODY_BYTES} bytes")
        if not raw:
            raise ProtocolError(400, "invalid_json", "request body must be a JSON object")
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ProtocolError(400, "invalid_json", "request body must be valid UTF-8 JSON") from None
        if not isinstance(body, dict):
            raise ProtocolError(400, "invalid_json", "request body must be a JSON object")
        return body

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib hook name
        self.send_response(204)
        for key, value in self._headers(0).items():
            self.send_header(key, value)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - stdlib hook name
        path = self.path.split("?", 1)[0]
        if path in ("/health", "/api/health", "/v1/health"):
            self._send(200, self.server.service.health())
            return
        if path in ("/capabilities", "/api/capabilities", "/v1/capabilities"):
            self._send(200, self.server.service.capability_response())
            return
        self._send(404, {"schema": "voice.error.v0.1", "ok": False, "request_id": None, "correlation_id": None, "error": {"code": "not_found", "message": "route not found"}})

    def do_POST(self) -> None:  # noqa: N802 - stdlib hook name
        path = self.path.split("?", 1)[0]
        try:
            body = self._read_json()
            if path in ("/v1/asr", "/api/asr", "/asr", "/v1/asr/transcribe", "/api/asr/transcribe"):
                result = self.server.service.asr(body)
            elif path in ("/v1/tts", "/api/tts", "/tts", "/v1/tts/synthesize", "/api/tts/synthesize"):
                result = self.server.service.tts(body)
            elif path in ("/v1/cancel", "/api/cancel", "/cancel"):
                result = self.server.service.cancel(body)
            elif path.startswith("/v1/jobs/") and path.endswith("/cancel"):
                request_id = unquote(path[len("/v1/jobs/") : -len("/cancel")])
                if not request_id:
                    raise ProtocolError(400, "invalid_request", "request_id is required")
                body = {**body, "request_id": request_id}
                result = self.server.service.cancel(body)
            elif path.startswith("/api/jobs/") and path.endswith("/cancel"):
                request_id = unquote(path[len("/api/jobs/") : -len("/cancel")])
                if not request_id:
                    raise ProtocolError(400, "invalid_request", "request_id is required")
                body = {**body, "request_id": request_id}
                result = self.server.service.cancel(body)
            else:
                self._send(404, {"schema": "voice.error.v0.1", "ok": False, "request_id": None, "correlation_id": None, "error": {"code": "not_found", "message": "route not found"}})
                return
            self._send(200, result)
        except ProtocolError as error:
            self._error(error, body=locals().get("body"))
        except Exception:
            # Keep implementation details and user payloads out of the wire.
            self._send(500, {"schema": "voice.error.v0.1", "ok": False, "request_id": None, "correlation_id": None, "error": {"code": "internal_error", "message": "voice sidecar failed"}})


class VoiceHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], service: VoiceSidecar | None = None) -> None:
        self.service = service or VoiceSidecar()
        super().__init__(address, _RequestHandler)


def create_server(host: str = "127.0.0.1", port: int = 4321, *, service: VoiceSidecar | None = None) -> VoiceHTTPServer:
    return VoiceHTTPServer((host, int(port)), service=service)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="DeskBot model-free voice sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4321)
    args = parser.parse_args(argv)
    server = create_server(args.host, args.port)
    print(f"{SERVICE_NAME} listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
