# Authored World Event Package v1

`deskbot.world-event-package.v1` is a read-only content contract for bounded
world-line events. A package may describe an authored event and the narrow
observation conditions under which it can be proposed. It cannot write the
canonical world and cannot define arbitrary mutation payloads.

## Pipeline

```text
observation -> package evaluation -> normalized candidate event
             -> world candidate preview -> explicit accept
             -> persistentWorld.ingest -> canonical mutation ledger
```

`apps/deskbot-service/src/authored-world-events.mjs` compiles the packages
from `world-content/settlements/morrowmere/world-events.json`. It checks the
observation type, confidence and authored tags, then creates a bounded
`proposed_actions` list. The existing `world-candidates` store performs the
preview/accept boundary; it derives actions again and accepts only its server
whitelist. `persistentWorld.ingest` remains the only canonical fact writer.

## Package fields

- `package_id` and positive `version`: stable content identity and idempotency
  key.
- `activation`: allowed observation types, at least one authored tag, and a
  confidence threshold.
- `event_template`: authored title, summary, consequence, opportunity and
  unresolved hook. Observation text is provenance, not world prose.
- `actions`: bounded action kinds; v1 accepts world-line event, pending item,
  or external context projections only.
- `expires_after_hours`: advisory candidate lifetime, bounded to 30 days.

The HTTP read/evaluation route is `GET /api/world/authored-events` and
`POST /api/world/authored-events/evaluate`. Normal `/api/event` ingress also
evaluates matching packages before passing the normalized event to the existing
world-candidate bridge. Evaluation and preview have no canonical side effects;
duplicate observations and duplicate candidate acceptance retain the existing
candidate/mutation idempotency guarantees.

M8b/M8c remain separate gates: this package proves bounded authored content
can reach a legal candidate and replayable mutation, not natural multi-day
model life or a 7–14 day observation.
