# DeskBot v6.4 M6b-R 发布记录（2026-10-14）

## 发布身份

- 分支：`codex/asamana-m6b-r-release-2026-10-14`
- 基线：`codex/asamana-m6b-r-public-release` 的公开 replay seam
- 目标：在不改变 `main` 的前提下，发布当前 operation-context 接缝与本机可体验效果
- 视觉资产：`documentation/images/asamana-m6b-r-release-2026-10-14/live-town-public-release.png`

## 本版包含

1. 保留持续生活、雾灯镇地图、居民面板、共同经历、记忆、愿望/试做/可逆角色阶段等 v6.4 能力。
2. 保留 `deskbot.service-operation.v1` 脱敏 journal 和 input-runtime/chat 受控 fixture replay。
3. 将 voice ASR、transcribe、TTS、cancel HTTP 路由纳入稳定 operation scope。
4. 将 WebSocket device bridge 接入 replay capture scope 的第一批 ACK 路径。
5. 更新公开 README、包描述、运行命令和效果图；本版不提交密钥、数据库、capture tape、音频或临时截图。

## 验收边界

本版是可复核的接缝预览，不是 M6b 全服务生产归档。已验证和待验收范围必须分开：

- 已有的服务端、客户端、voice-sidecar 与 replay 专项回归继续作为发布门槛。
- voice/device operation context 证明的是稳定归属、脱敏摘要和异步上下文边界，不证明真实 TTS、固件 ACK 或机械外壳。
- role/life/world-candidate/worker/device/voice 的完整 fresh/restart/replay/fail-closed 全入口仍按 [M6b 合同](asamana-m6b-route-worker-device-replay-v1.md) 逐波次推进。

## 本地体验

```powershell
git clone --branch codex/asamana-m6b-r-release-2026-10-14 https://github.com/404-NOT-FOUND-ERROR/DeskBot.git
Set-Location DeskBot
Copy-Item config\llm_config.example.json config\llm_config.json
# 编辑本机 DeepSeek 配置；天气配置按 config\README.md 准备
Push-Location apps\jev-town-client
npm.cmd ci
Pop-Location
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -StartWeb -StartWorld
```

体验入口：

- `http://127.0.0.1:5173/?mode=deskbot&deskbotUrl=http://127.0.0.1:4311`
- `http://127.0.0.1:4322/`

启动脚本会优先使用已有代理设置，并在本机检测到 Clash 时使用 `127.0.0.1:7897`；Git 可显式使用：

```powershell
git -c http.proxy=http://127.0.0.1:7897 fetch origin
```

