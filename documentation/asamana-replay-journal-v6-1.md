# Asamana → DeskBot v6.1 发布说明

本文件记录 `codex/asamana-replay-journal-v6-1` 相对 v6 的增量。它是本版本发布说明，不替代 [迁移矩阵](asamana-migration-matrix-v1.md)、[测试文档](tests.md) 或 v6 的基础说明。

## 本轮已发布

- `/api/chat` 在进入编排器前生成稳定的规范化事件摘要，并在 `chat:<event_id>` operation context 下执行，重复请求不会重复创建 journal 或业务事实。
- operation journal 记录 `deskbot.service-operation.v1` envelope、请求摘要哈希和脱敏的 provider/TTS 结果引用；聊天正文、密钥和原始音频不会进入公开回放归档。
- provider 成功、provider 失败和 TTS 失败都保留结构化结果引用，方便后续把 chat/provider seam 接入可执行服务回放。
- 更新本版本 README、迁移评估、架构与测试说明；效果图继续使用正式运行的小镇和往事面板截图，并明确说明本版视觉沿用 v6、增量主要在服务端回放审计。

## 已验证

- operation-journal、replay-capture 与 HTTP chat 合同专项通过；覆盖 operation attribution、请求正文不落盘、provider result reference 和重复 chat 幂等。
- v6 基线的服务端、客户端、voice-sidecar 和生产构建结果沿用，并在本轮文档中按 2026-10-14 发布快照更新。

## 明确未完成

v6.1 仍是 M6b 的增量发布，不把“chat 已有 journal”写成“全服务生产回放已完成”。以下入口仍需逐项接入并通过原业务入口回放：

- assistant-role `/api/chat` 与通用 `/api/event` 分支；
- input-runtime source refresh、TTL/backoff 和 connector result；
- role proposal/trial/stage、world candidate、life/research 直接路由；
- shared-life、NPC、slow cognition、wall-clock worker、WebSocket/设备 ACK；
- 重启后的全服务 operation replay 与 coverage registry。

本分支适合作为后续 M6b 接入的可回滚开发基线；它不宣称完成真实模型多日生活、无限自主故事、真实 TTS、实体外壳或全服务 production replay。
