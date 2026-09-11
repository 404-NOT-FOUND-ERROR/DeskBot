# Contributing to DeskBot

DeskBot is a small continuous-world research prototype. Changes must keep the Node service as the only canonical state owner and must not put secrets, SQLite state, audio artifacts, model caches or downloaded source copies in Git.

## Local setup

1. Install Node.js 24+ and Python 3.10+.
2. Copy `config/llm_config.example.json` to `config/llm_config.json` and fill it locally if real DeepSeek is required.
3. Copy `config/weather.env.example` to `config/weather.env` only if QWeather is required.
4. Run `npm.cmd start` from the repository root. This invokes the launcher with a process-scoped PowerShell policy and uses `config/llm_config.json`. Use `scripts/start-local.ps1 -WeatherEnvFile (Resolve-Path config/weather.env)` when weather is configured.

## Before a pull request

```powershell
npm.cmd test
```

The equivalent explicit commands are `npm.cmd --prefix apps\\deskbot-service test` and `python -m unittest discover -s voice-sidecar\\tests -v`.

For behavior changes, add the corresponding automated contract test and record the real-model, page, or hardware boundary separately. A green fake test is not evidence that DeepSeek, QWeather, TTS or ESP-VoCat is live.

## Branch and commit rules

- Keep `main` runnable; use a short `feature/`, `fix/`, `research/` or `docs/` branch.
- PRs must describe user-visible behavior, canonical state or migration impact, tests, live/manual evidence, and firmware impact.
- Interface changes update `research/protocol/interaction-contract-v0.1.md` and notify the firmware agent.
- Never commit `config/llm_config.json`, `config/weather.env`, `.env`, `*.sqlite`, audio, model weights or `tmp/`.
- Use `npm.cmd run package:source` to build the filtered public source archive; inspect its manifest before publishing.
