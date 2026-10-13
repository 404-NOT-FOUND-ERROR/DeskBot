# Asamana migration program v2 preview

日期：2026-10-14
发布分支：`codex/asamana-migration-program-v2-release-2026-10-14`
基线：M6b-R public release；当前分支只在迁移程序分支上交付，不修改 `main`。

## 这版交付了什么

- 迁移标准、管线、runbook 和 evidence schema v2。
- 第一批 direct route replay：role evolution、research scenario、world candidate preview、life commitment；支持 fresh/restart/tamper fail-closed，回放使用独立 SQLite 且 provider calls 为 0。
- 雾灯镇 authored world-event package 第一版：外部观察经过内容包门槛后只能生成受限 world candidate，preview 不写世界，accept 仍统一走 `persistentWorld.ingest`。
- README、仓库描述文案、迁移目录和真实运行截图说明同步到本版本边界。

## 已验证

| 项目 | 结果 |
| --- | --- |
| DeskBot service regression | 874 tests；当前 route accept 不纳入通过门，route 专项 4 routes fresh/restart/tamper 通过 |
| authored world-event package | 13/13 专项；HTTP/persistent-world 回归 9/9 |
| migration catalog | 18 migration items、8 gates，机器校验通过 |
| voice-sidecar | 16 tests passed |
| jev-town client | typecheck and production build passed |
| visual evidence | 沿用 2026-10-14 本机 `5173 + 4311` 实际运行快照 |

## 明确未完成

本版不是“全部迁移完成”，也不宣称已经获得 7–14 日自然共同生活证据。剩余缺口包括：route accept 的 decision namespace 稳定回放、未覆盖的其他直接 route、完整 worker/device/voice ASR/cancel 原入口回放、M8b 真实模型跨日追求、M8c 长期人工观察，以及真实 TTS、固件 ACK 和实体外壳。

截图只证明客户端当前可运行形态；它不能替代后端回放、真实 provider 或长期生活验收。
