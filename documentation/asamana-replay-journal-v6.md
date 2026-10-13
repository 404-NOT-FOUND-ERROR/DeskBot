# Asamana → DeskBot v6 发布说明

本文件记录 `codex/asamana-replay-journal-v6` 相对 v5 的增量。它是发布说明，不替代 [迁移矩阵](asamana-migration-matrix-v1.md) 或 [测试文档](tests.md)。

## 本轮已发布

- `replay-capture.mjs` 增加 `replay.capture-journal` namespace 和版本化 `deskbot.service-operation.v1` envelope。
- operation context 使用 `AsyncLocalStorage` 保存 operation id、operation kind、source、request hash、result reference 和开始时间；journal 不保存原始请求正文。
- `ingestNonChatEvent` 通过 `ingress:<event_id>` 关联入口 operation，保持现有 `persistentWorld.ingest` 为 canonical world 唯一写入口。
- journal 对事务写入进行 namespace 白名单校验、顺序编号和 record hash；捕获失败或未登记 namespace 会 fail-closed。
- 导出档案包含 journal，并在恢复时校验数量、顺序和哈希；replay capture 本身不会递归产生 journal。

## 已验证

- operation-journal 合同覆盖：捕获 hook 失败回滚、未登记 namespace 拒绝、capture namespace 不递归、异步上下文保留、请求原文不写入 journal。
- 既有 canonical replay、service-ingress、客户端、voice-sidecar 和生产构建结果沿用 v5 发布基线。

## 明确未完成

v6 只完成 M6b 的第一批捕获基础设施，不把“有 journal”写成“全服务生产回放已完成”。以下入口仍需逐项接入并通过原业务入口回放：

- `/api/chat`、provider result 和 TTS/output artifact；
- input-runtime source refresh、TTL/backoff 和 connector result；
- role proposal/trial/stage、world candidate、life/research 直接路由；
- shared-life、NPC、slow cognition、wall-clock worker、WebSocket/设备 ACK；
- 重启后的全服务 operation replay 与完整 coverage registry。

因此，本分支适合作为后续 M6b 接入的可回滚开发基线；它不宣称完成真实模型多日生活、无限自主故事、真实 TTS、实体外壳或全服务 production replay。
