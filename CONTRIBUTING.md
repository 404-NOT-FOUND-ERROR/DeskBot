# Contributing to DeskBot

DeskBot is a small continuous-world research prototype. Changes must keep the Node service as the only canonical state owner and must not put secrets, SQLite state, audio artifacts, model caches or downloaded source copies in Git.

The current product, architecture, milestones and acceptance rules are defined in [Development baseline](documentation/development-baseline.md). Maintain [the interface register](contracts/architecture.v1.json) and [ownership/call-chain documentation](documentation/interfaces.md) when changing a seam. Historical milestone reports keep their original outcomes; they do not override the current baseline.

For activity extensions, follow [Activity method contracts](documentation/activity-methods.md). Use the shared recipe/sample definition where applicable; add an explicit executor adapter for new world laws. Test condition-specific evidence, cancellation, restoration and development attribution. A model description does not define an executable effect.

Current choices, bound goal steps and followups must share [Opportunity contracts](documentation/cognitive-opportunities.md). Do not rebuild availability from activity names in a prompt or feedback path. Test changed conditions, satisfied uses, pending and expired replies, parked issues and real completion evidence. A future reference is not a reservation or a completed task; preserve open aspirations without granting execution authority.

Communication and accepted obligations use [Event evidence](documentation/cognitive-event-evidence.md). Keep completion notices distinct from actual result disclosures. Delivery proves only its exact content and recipients, not understanding, acceptance or material transfer. Recheck obligation terms and action scope before adoption. Preserve historical jobs without inventing receipts; test the shared Python/Node counterexamples and SQLite recovery. The current implementation and next acceptance gates are recorded in [the engineering delivery plan](research/design/engineering-delivery-plan-2026-11-01.md).

## Local setup

1. Install Node.js 24+ and Python 3.11+ (CI uses 3.12); install `services/deskbot-cognition/requirements-test.txt` for timezone data. `DESKBOT_COGNITION_PYTHON` can select the interpreter used by the bridge and project tests.
2. Copy `config/llm_config.example.json` to `config/llm_config.json` and fill it locally if real DeepSeek is required.
3. Copy `config/weather.env.example` to `config/weather.env` only if QWeather is required.
4. Run `npm.cmd start` from the repository root. This invokes the launcher with a process-scoped PowerShell policy and uses `config/llm_config.json`. Use `scripts/start-local.ps1 -WeatherEnvFile (Resolve-Path config/weather.env)` when weather is configured.

## Before a pull request

```powershell
npm.cmd test
```

This is the same gate used by CI: architecture references and counterexamples, all Python cognition unittests, all Node service tests, voice-sidecar tests, all frontend tests, type-checking and build. Install frontend dependencies with `npm.cmd --prefix apps/jev-town-client ci --ignore-scripts` first. `npm run check:architecture` is a fast reference check, not the whole gate. Tests use isolated fixtures; no real model calls belong in this command.

Every delivery records scope, code/contract/content changes, state ownership, compatibility and recovery, automated results, model or natural-life evidence, and remaining blockers. A local fix does not overwrite a frozen real experiment's outcome. Contract changes preserve unknown errors as unknown and keep technical failures out of personal memories. New mechanisms include blocked, cancelled, changed-condition and restart cases, with corresponding presentation.

Use `node scripts/capture-baseline.mjs --output <new-local-manifest.json>` to record hashes of tracked and new text sources, contracts and versioned content, including uncommitted changes. Store the manifest with local validation logs outside the repository. It excludes runtime data and secrets and does not copy sources; it is an audit inventory, not a recovery backup. Real experiments also retain their existing frozen source/request/response evidence.

For behavior changes, add the corresponding automated contract test and record the real-model, page, or hardware boundary separately. A green fake test is not evidence that DeepSeek, QWeather, TTS or ESP-VoCat is live.

## Branch and commit rules

- Keep `main` runnable; use a short `feature/`, `fix/`, `research/` or `docs/` branch.
- PRs must describe user-visible behavior, canonical state or migration impact, tests, live/manual evidence, and firmware impact.
- Interface changes update their registered contract and compatibility notes. Device-facing changes also update `research/protocol/interaction-contract-v0.1.md`; coordinate firmware work when authorized.
- Never commit `config/llm_config.json`, `config/weather.env`, `.env`, `*.sqlite`, audio, model weights or `tmp/`.
- Use `npm.cmd run package:source` to build the filtered public source archive; inspect its manifest before publishing.
