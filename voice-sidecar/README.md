# DeskBot Voice Sidecar

`voice-sidecar` is a small, standard-library-only HTTP boundary for ASR and
TTS.  The checked-in worker is deliberately **fake/model-free** so the
software and firmware paths can be exercised before downloading large model
weights.  It never writes the canonical world or calls DeepSeek.  Node
`deskbot-service` remains the only state owner and should submit the final ASR
event to `POST /api/chat`.

## Run

From the `voice-sidecar` directory (Python 3.10+):

```powershell
python -m voice_sidecar --host 127.0.0.1 --port 4321
```

`python server.py` is an equivalent compatibility launcher.

No third-party package or model download is required.

## Routes

The versioned routes are the integration contract.  `/api/*` routes are
backwards-compatible aliases.

| Method | Primary route | Alias | Purpose |
|---|---|---|---|
| GET | `/v1/health` | `/health`, `/api/health` | Liveness and active request count |
| GET | `/v1/capabilities` | `/capabilities`, `/api/capabilities` | ASR/TTS formats and limits |
| POST | `/v1/asr` | `/api/asr` | Fake partial/final transcription |
| POST | `/v1/tts` | `/api/tts` | Fake PCM/WAV synthesis |
| POST | `/v1/jobs/{request_id}/cancel` | `/api/cancel` | Cooperative cancellation |

`/asr`, `/tts`, `/cancel` and `/v1/*/transcribe|synthesize` are also accepted
for local smoke scripts.  The cancellation body form can target either a
`request_id` or every active request with a `correlation_id`.

## Correlation and errors

ASR/TTS requests may provide `request_id` and `correlation_id`; both are
returned unchanged at the top level and in the ASR `event`.  If omitted, the
sidecar generates opaque IDs and still returns them, so every downstream Node
event has a correlation value.  Retries should supply the original IDs.

All expected failures use one JSON envelope and a stable `error.code`:

```json
{
  "schema": "voice.error.v0.1",
  "ok": false,
  "request_id": "req-1",
  "correlation_id": "turn-1",
  "error": {
    "code": "unsupported_audio_format",
    "message": "playback codec 'opus' is not supported by the fake sidecar",
    "details": {"direction": "playback", "supported_codecs": ["wav", "pcm_s16le"]}
  }
}
```

Important codes include `invalid_json`, `invalid_request`,
`unsupported_audio_format`, `missing_input`, `request_in_flight`, `cancelled`,
`timeout`, and `request_not_found`.  Error responses never include audio,
conversation text beyond a field-level message, stack traces, or credentials.

## ASR request/response

The fake recognizer accepts text (`text` or `raw_utterance`) and preserves the
raw value.  It performs only conservative Unicode/whitespace cleanup; this is
the `clean_utterance` that Node should pass to `/api/chat`.  `stage` is
`partial` or `final` (default `final`).  An audio-only request is accepted and
returns a deterministic `[fake-audio:<digest>]` marker instead of pretending to
decode speech.

```powershell
$body = @{
  request_id = 'req-demo-1'
  correlation_id = 'turn-demo-1'
  utterance_id = 'utt-demo-1'
  stage = 'partial'
  text = '  今天   怎么样  '
  character_id = 'shaping-001'
  device_id = 'vocat-001'
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4321/v1/asr `
  -ContentType 'application/json' -Body $body
```

The response has top-level `stage`, `raw_utterance`,
`clean_utterance`, `is_final`, `utterance_id`, `stream_id`, `confidence`, and
an optional `event`:

```json
{
  "schema": "voice.asr-result.v0.1",
  "ok": true,
  "request_id": "req-demo-1",
  "correlation_id": "turn-demo-1",
  "operation": "asr",
  "provider": "fake",
  "model": "identity-text-v0",
  "stage": "partial",
  "is_final": false,
  "raw_utterance": "  今天   怎么样  ",
  "clean_utterance": "今天 怎么样",
  "text": "今天 怎么样",
  "event": {
    "schema": "foundry.event.v0.1",
    "type": "voice.asr.partial",
    "source": "voice-sidecar",
    "correlation_id": "turn-demo-1",
    "payload": {
      "stage": "partial",
      "text": "今天 怎么样",
      "raw_utterance": "  今天   怎么样  ",
      "clean_utterance": "今天 怎么样"
    }
  }
}
```

For a final result, the Node adapter can submit the response to
`POST /api/voice/asr` (or use `POST /api/voice/transcribe` when Node should
invoke this sidecar itself).  If another client submits directly to the
generic input layer, use a normalized `conversation.input` containing the
final `clean_utterance`, not the `voice.asr.final` transport event as a chat
message.  Partial/final transport events are read-only in the canonical world;
only the final conversation input counts as a user turn.

Audio input is JSON base64 (`audio_b64`) with an optional format object, for
example `{"codec":"pcm_s16le","sample_rate_hz":16000,"channels":1}`.
The baseline records byte count and SHA-256 metadata but does not claim real
speech recognition.

## TTS request/response

```json
{
  "request_id": "req-tts-1",
  "correlation_id": "turn-demo-1",
  "text": "我在这里。",
  "profile": {"name": "shaping-neutral", "speed": 1.0},
  "format": {"codec": "wav", "sample_rate_hz": 16000, "channels": 1}
}
```

The response includes `audio_b64` and metadata under `audio`:

```json
{
  "schema": "voice.tts-result.v0.1",
  "ok": true,
  "request_id": "req-tts-1",
  "correlation_id": "turn-demo-1",
  "provider": "fake",
  "model": "tone-v0",
  "profile": {"name": "shaping-neutral", "speed": 1.0},
  "audio": {
    "format": {"codec": "wav", "sample_rate_hz": 16000, "channels": 1},
    "codec": "wav",
    "sample_rate_hz": 16000,
    "channels": 1,
    "mime_type": "audio/wav",
    "encoding": "base64",
    "data_base64": "UklGR...",
    "byte_count": 1234,
    "duration_ms": 260,
    "sha256": "..."
  },
  "audio_b64": "UklGR...",
  "audio_ref": "memory://voice-sidecar/req-tts-1.wav"
}
```

Supported output codecs are `wav` and raw `pcm_s16le`, mono, at 8/16/24 kHz.
`opus` is intentionally reported as unsupported until a real encoder is
installed; the firmware's preferred downlink format still comes from
`device.hello` negotiation in the bridge contract.

## Cancellation and timeout

ASR/TTS accept `timeout_ms` (1–120000).  Tests may set
`simulate_delay_ms` (0–30000) to exercise the boundary.  A timeout returns HTTP
`504` with `error.code = "timeout"`.  While a request is active, cancel it
with:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:4320/v1/jobs/req-tts-1/cancel `
  -ContentType 'application/json' -Body '{"correlation_id":"turn-demo-1"}'
```

The in-flight request then returns HTTP `409` with `error.code = "cancelled"`.
Cancellation is cooperative and bounded to the identified request or
correlation; it cannot interrupt a completed operation.

## Tests

```powershell
cd voice-sidecar
python -m unittest discover -s tests -v
```
