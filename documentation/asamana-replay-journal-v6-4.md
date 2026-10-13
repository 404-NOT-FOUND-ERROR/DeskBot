# Asamana 迁移回放日志 v6.4 发布说明

本分支 `codex/asamana-m6b-v6-4-release` 是 v6.4 replay seam 基线的发布分支，补齐 `input-runtime` source run 的受控捕获与原业务入口回放。它仍不把受控回放写成完整生产归档，也不改变 DeskBot 的唯一世界事实写入口。

## 本版范围

- 捕获 `input-runtime` source run 的 success、TTL skip、error/backoff 和 completed 状态。
- 保存 schema、rule version、run/source 标识、时间、结果事件引用、trace、request 摘要与脱敏 provider result reference。
- provider fixture 进入本机私有 replay tape；公开 operation journal 只保存脱敏引用，回放不调用真实 provider。
- 通过重复 source 结果、TTL skip、错误恢复、SQLite 重启、缺失/篡改 fixture、未登记 source 和 ingress 过滤等 fail-closed 验收。
- 保持 v6.3 的 `/api/chat` 用户 handler LLM fixture replay 合同与原有持续生活、角色阶段和世界规则。

## 验收结果

- 服务端完整回归：861/861。
- input-runtime replay 专项：2/2；operation-journal/input-runtime/replay-capture 专项合计：30/30。
- chat handler LLM fixture replay：10/10。
- 客户端 typecheck/build、voice-sidecar 16/16 和 `git diff --check` 通过。

这些数字是自动化与受控 fixture 证据，不等于 M6b 全服务生产归档、真实 provider 长期运行或连续 7–14 天自然生活已经完成。

## 未纳入本版

assistant 分支、独立 TTS 成功 fixture、worker/WebSocket/device ACK、直接 HTTP domain route 的完整回放、真实模型多日生活、真实中文 TTS、实体外壳和机械联调仍按 [M6b 接缝合同](asamana-m6b-seam-contract-v1.md) 分波次推进。

## 视觉基线

本版没有改动雾灯镇 3D 世界的交互布局。README 中的 v6.4 release 图片 `documentation/images/asamana-v6-4-release/live-town.png` 是 2026-10-14 04:01 通过本机运行页面截取的实际截图，展示实时小镇、居民侧栏和小镇往事面板；原 `asamana-v6-4` JPG 仍作为历史版本化副本保留。本版新增能力位于服务端 input-runtime replay、operation journal 和回放审计。
