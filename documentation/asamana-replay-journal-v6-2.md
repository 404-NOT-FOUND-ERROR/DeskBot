# Asamana 迁移回放日志 v6.2 发布说明

本分支 `codex/asamana-m6b-seam-v6-2` 是 DeskBot 在 v6.1 基线上的 M6b 接缝增量。它把服务操作、聊天入口和输入运行源逐步纳入同一套可审计 operation journal，同时保留现有持续生活与 canonical world 规则。

## 本版已交付

- `deskbot.service-operation.v1`：统一 operation id、operation kind、source、请求摘要、写入 namespace、记录哈希和事务边界。
- `/api/chat` 用户分支与 `/api/event` 通用入口：通过原业务入口捕获 operation context；重复事件仍保持幂等。
- `input-runtime`：每次 source refresh 使用 `input-runtime:<source>:<timestamp>:<sequence>` operation id，记录 start、source state、provider refresh、ingest 与 completion。
- provider/TTS：operation journal envelope 只保存脱敏结果引用与结构化错误摘要，不保存密钥、原始响应、聊天正文或完整敏感 prompt；本地私有 replay capture 为了可重放可能包含聊天事件和 provider fixture 原文，必须留在本机、不得公开发布。
- 验证：服务端回归、input-runtime 专项、前端 typecheck/build 与 voice-sidecar 检查均通过；本版 README 的截图沿用已验收的雾灯镇视觉基线，并于 2026-10-14 重新核对本机运行页面。

## 明确边界

本版不是完整生产归档。assistant 分支、durable provider fixture、原 `/api/chat` handler replay、worker、WebSocket、设备 ACK 和直接 HTTP domain route 仍按 [M6b 接缝合同](asamana-m6b-seam-contract-v1.md) 分波次推进。当前 input-runtime 已完成 operation scope 与 SQLite 恢复证据，但完整 fixture/replay 验收仍是后续门槛。

回放必须通过原业务入口执行，不能直接导入 SQL 状态；`persistentWorld.ingest` 仍是 canonical world 的唯一写入口。外部文本、assistant 回复、设备 ACK 和地图动画不能直接成为世界事实。

## 下一步

1. 完成 durable provider fixture 与原入口 replay，覆盖成功、provider/TTS 失败、重复、重启、缺失和篡改 fixture。
2. 统一 assistant/generic event、角色/生活/research route、worker、WebSocket 与设备操作的 operation scope。
3. 通过 M6b 全部验收门后，再开启角色提案、trial、world candidate 和跨日阶段投影的完整回放。
