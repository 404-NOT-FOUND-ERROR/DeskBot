# M6b-R worker replay release · 2026-10-14

## Snapshot

- Branch: `codex/asamana-m6b-r-worker-replay-2026-10-14`
- Base: Asamana migration program v2 preview
- Scope: scheduler worker capture/replay, route replay hardening, voice/chat fixture compatibility
- UI: unchanged; the release image is a real local `5173` runtime snapshot, not a generated mock

## What changed

- Scheduler slots now have stable operation IDs and durable `deskbot.replay-capture-worker.v1` records.
- Fresh and restart replay can re-enter the original worker/domain handler without starting timers, sockets or providers.
- Authored world-candidate accept replay avoids replaying its nested canonical ingress twice.
- Legacy voice/chat replay runtimes without a worker seam can consume zero-write worker records safely; modern runtimes replay the worker entry directly.
- Role-evolution startup replay is guarded so a worker run is not created twice.

## Verification

Focused replay contract: **14/14 passed**. Full DeskBot service suite: **874/874 passed**.

Covered route, worker, voice fixture, chat fixture, fresh replay, restart replay, provider-zero replay, tamper fail-closed, idempotency and namespace digest checks. The full suite result is a regression baseline, not a claim that P4 or long-life natural experience is complete.

## Visual evidence

![M6b-R worker replay runtime snapshot](images/asamana-m6b-r-worker-replay-2026-10-14/live-town-worker-replay.png)

The screenshot shows the current town map, resident panel, shared-life history and chat entry. The worker/replay work is a service-layer change, so the client visual baseline is intentionally unchanged.
