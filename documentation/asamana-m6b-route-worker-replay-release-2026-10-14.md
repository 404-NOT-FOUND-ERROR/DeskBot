# M6b route / worker replay release · 2026-10-14

本分支是 DeskBot 的 Asamana 迁移开发快照，重点是让已经存在的业务入口能够被审计、重启恢复并在不调用 provider 的情况下回放。

## 本版已验证

- M6b-C chat handler replay：独立 LLM/TTS fixture，fresh/restart/duplicate 与错误 fixture fail-closed；12/12 专项通过。
- M6b-R route replay：研究、角色演化、世界候选和既有生活入口继续使用原 domain handler；角色阶段 `accept/rollback` 新增共享 domain seam，重复回放不产生新的世界 revision。
- M6b-R worker replay：worker operation ID、SQLite 恢复、原 worker 入口和 canonical mutation 去重沿用上一版已验收基线。
- 服务端全量回归：877/877 通过。
- `git diff --check`：通过。

## 交付边界

本分支不宣称 P4 全量、无限自主故事或长期自然共同生活已经完成。life/role 新增 route 的完整生产归档、嵌套 canonical ingress 的全量 archive 验收、真实模型跨日观察、真实 TTS、ASR cancel、实体 ACK 和外壳机械实现仍是后续迁移项。

`persistentWorld.ingest` 仍是唯一 canonical world writer；回放只重新进入原业务入口，不能通过 SQL 导入或客户端 payload 直接改写世界。provider fixture 仅保留在本机捕获目录，不提交到仓库。

## 运行效果

本版没有改变客户端视觉层，效果图沿用 2026-10-14 本机真实运行的雾灯镇 3D 小镇与居民面板：

![M6b route / worker replay 本机运行效果](images/asamana-m6b-route-worker-replay-2026-10-14/live-town-route-worker-replay.png)

图片仅证明当前可运行的地图、居民面板和生活侧栏，不作为 P4 全量或 7–14 日人工共同生活证据。
