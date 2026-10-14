# M6b-C chat handler replay evidence

- `item_id`: `M6b-C-chat-handler-replay`
- `run_id`: `M6b-C-chat-handler-replay-20261014`
- `base_commit`: `7fd853b`
- `branch`: `codex/asamana-m6b-r-worker-replay-2026-10-14`
- `status`: `automated_verified`
- `provider_mode`: `fixture`
- `provider_calls_during_replay`: `0`
- `logic_time`: `2026-10-05T04:00:00.000Z` to `2026-10-05T04:00:00.000Z` (`Asia/Shanghai`)

## Contract

The original `POST /api/chat` handler remains the entry point. `persistentWorld.ingest`
and the existing chat turn/output writers remain authoritative. LLM and TTS provider
results are private replay fixtures; assistant/device output is never promoted to role
evidence or canonical world authority.

## Commands

```powershell
npm.cmd --prefix apps/deskbot-service test -- test/replay-capture.test.mjs
npm.cmd --prefix apps/deskbot-service test
git diff --check
```

Results: focused replay `12/12 passed`; full service regression `876/876 passed`;
`git diff --check` passed.

## Gate evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| G0 | pass | Stable `chat:<event_id>` operation, existing chat writer and provider fixture contracts retained. |
| G1 | pass | LLM-only chat, successful TTS chat, and TTS-error chat all complete through `/api/chat`. |
| G2 | pass | Missing/tampered provider fixtures fail closed; TTS failure is retained as an error fixture and does not fabricate audio. |
| G3 | pass | Duplicate chat request returns the first result without a second provider call or journal write. |
| G4 | pass | Fresh and restart replay produce the same namespace digest and preserve audio artifact identity. |
| G5 | pass | Replay re-enters the original service chat handler and calls zero providers. |
| G7 | pass | Only source, test, contract and evidence files are included; no database, secret, audio cache or temporary fixture is committed. |

## Important implementation detail

The chat operation stores the LLM fixture under provider kind `llm` and a successful
TTS result under provider kind `tts` with `fixture.kind = tts.synthesize.v1`. The private
TTS fixture retains the deterministic provider audio needed by `audioArtifacts.put`, while
the operation journal exposes only hashes and metadata.

## Known gaps

- The assistant-role request branch remains audit-only and is not a model generation path.
- TTS cancellation and device ACK replay remain in the later M6b voice/device items.
- This evidence proves deterministic replay, not real TTS quality or physical playback.
