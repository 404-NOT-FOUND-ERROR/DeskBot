# Asamana 迁移回放日志 v6.3 发布说明

本分支 `codex/asamana-m6b-seam-v6-3` 是 v6.2 M6b 接缝基线的增量发布，目标是把原 `/api/chat` 用户入口接入受控的本地 provider fixture 回放。它仍然不把受控回放写成完整生产归档，也不改变 DeskBot 的唯一世界事实写入口。

## 本版范围

- 为聊天回放保存分相位的 provider 引用，并以 hash 校验防止篡改；本版可执行门使用 LLM fixture，独立 TTS 成功 fixture 留作后续接缝。
- 回放时重新进入原有 chat orchestrator/handler，不调用真实 provider；`provider_calls` 必须为 `0`。
- 缺失、非法或篡改的 fixture 在创建目标 SQLite 之前 fail closed。
- 覆盖 fresh、重启、重复请求和缺失/篡改 fixture 失败分支，保持 operation、correlation、chat、world 与 replay namespace 的一致性。
- 对齐源服务与回放服务的启动初始化顺序，避免启动 bootstrap 记录造成伪差异。

## 仍未纳入

assistant 分支、input-runtime 的 fixture 消费式回放、worker/WebSocket/device ACK、直接 HTTP domain route 的全服务回放仍按 [M6b 接缝合同](asamana-m6b-seam-contract-v1.md) 分波次推进。真实模型多日生活、自然长期沉浸、TTS、实体外壳和机械联调也不属于本版。

## 视觉基线

本版没有改动雾灯镇 3D 世界的交互布局；README 中新增的 v6.3 本机截图记录实时小镇、居民侧栏和小镇往事面板。新增能力位于服务端回放与审计接缝，不伪装成新的视觉功能。

## 验收记录

本版已验证：`node --test test/replay-capture.test.mjs` 10/10，`npm.cmd test` 服务端 859/859，客户端 typecheck/build 和 voice-sidecar 16/16 通过，`git diff --check` 通过。独立 TTS fixture、assistant 分支和全服务生产归档仍不在本版完成范围。更完整的状态以 [验证文档](tests.md) 和 [迁移矩阵](asamana-migration-matrix-v1.md) 为准。
