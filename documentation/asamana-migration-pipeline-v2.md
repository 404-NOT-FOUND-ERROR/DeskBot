# Asamana → DeskBot 迁移管线 v2

本文把“全部迁移”拆成可停止、可回滚、可逐项验收的波次。它与
[标准 v2](asamana-migration-standard-v2.md) 和 [作业单 v2](asamana-migration-runbook-v2.md)
配套使用；不替代 `asamana-migration-catalog-v1.json`，而是要求目录成为每次执行的
唯一入口。

## 1. 工作流

每一个 `item_id` 只能按以下顺序推进：

```text
登记目录 → 冻结合同 → 建立基线 → 写正/负测试 → 接入原 writer
→ fresh/restart/duplicate/replay → 人工门 → 记录证据 → 升级状态
```

任何门失败，停在当前 item；不提前开启依赖项，不用邻近模块的通过结果代替当前项。

每次执行前：

```powershell
git status --short --branch
node scripts/validate-migration-catalog.mjs
git diff --check
```

每次执行后（仅在当前 item 的证据完成时）：

```powershell
npm.cmd --prefix apps/deskbot-service test
npm.cmd --prefix apps/jev-town-client run typecheck
npm.cmd --prefix apps/jev-town-client run build
git diff --check
```

测试输出和 fixture 只留临时目录；文档只引用路径、hash、命令和脱敏结果。

表中的每个波次都必须按标准 v2 的 G0–G7 通用门执行：合同/权限（G0）、正向
（G1）、安全拒绝（G2）、幂等（G3）、重启恢复（G4）、原入口回放（G5）、人工体验
（G6，若适用）和交付复核（G7）。各目录项的 `required_gates` 是适用门的唯一裁决；
表格中的“正向/负向/重启/幂等/回放/人工门”是这些通用门的可执行拆分。

## 2. 波次与交付物

| 波次 | 目录项 | 迁移目标 | 依赖 | 正向验收 | 负向验收 | 重启/幂等与回放 | 人工门 | 交付后状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S0 | `M0-migration-program-standard` | 标准、Gate Crosswalk、证据模板冻结 | 无 | catalog/matrix/pipeline/runbook 一致 | 重复项、悬空依赖、未知 gate fail closed | validator 不改状态 | 文档可读性 review | `automated_verified` |
| S1 | `M1-runtime-contracts-and-trace` | typed stage、trace、稳定 fingerprint | S0 | 每次 run 可追 event/evidence/revision | malformed schema、未知 writer、伪造完成 | 同 event replay 不重复；重启恢复 journal | 无 | `automated_verified` |
| S2 | `M2-memory-projection-ranking` | factual/experiential 只读投影、衰减、MMR | S1 | 召回正确排序并可追来源 | assistant/device/召回不生成 evidence | 重复召回无成长，重启一致 | 记忆可读性（可选） | `automated_verified` |
| S3 | `M3-slow-cognition` | decay→compression→reflection→goal/relation | S2 | 有来源反思/目标/关系视图 | 无来源、越权 goal、模型错误不造故事 | 同逻辑日一次；重启不重调 provider | 跨日叙事（后续） | `automated_verified` |
| S4 | `M4-autonomous-cadence` | 需要/压力/情绪/idle 调度 | S3 | 合法 choice 按 cadence 触发 | 重复 tick、非法路线、模型不可用 fail safe | slot 幂等；重启继续在途任务 | 长时间频率体验 | `automated_verified` |
| S5 | `M5-world-candidate-governance` | evidence→candidate→preview→accept→ingest | S1 | 合法候选可预览并接受 | 客户端任意 mutation、过期/revision 冲突拒绝 | duplicate accept 无增量；重启保留候选 | 地图/故事可理解性 | `automated_verified` |
| S6 | `M6a-canonical-world-replay` | canonical world seed/ledger 可回放 | S5 | fresh/restart/replay semantic hash 相同 | SQL 导入、读源库、联网、缺捕获 fail | 重复事件/接受无新 mutation | 历史面板（由 M7） | `automated_verified` |
| S7a | `M6b-C-chat-handler-replay` | chat/provider/输出原入口回放 | S6 | success/skip/error 可归属 | assistant 台词、缺/篡改 fixture 不写事实 | fresh/restart/duplicate，0 provider calls | 对话呈现 | `partial`→`automated_verified` |
| S7b | `M6b-I-input-runtime-replay` | source refresh、TTL/backoff、ingest 回放 | S7a | success/skip/error、多来源隔离 | 未登记 source、网络失败半提交 | 重启、重复、过期，0 provider calls | 真实 provider 长期观察 | `automated_verified` |
| S7c | `M6b-R-http-route-operation-context` | role/life/world/research route 原入口封套 | S7b | 每路由有 operation context 和 namespace | bypass、越权、缺 operation 失败 | fresh/restart/duplicate/replay | 页面操作可见性 | `partial`→`automated_verified` |
| S7d | `M6b-R-voice-route-operation-context` | voice transcribe/tts 原入口回放 | S7c | voice success/error 路由可追踪 | 篡改音频/转写越权、无 fixture fail closed | 音频/utterance 幂等，0 provider calls | 真实声音待 P7 | `partial`→`automated_verified` |
| S7e | `M6b-R-worker-cadence-replay` | life/NPC/cognition worker 回放 | S7c | 每 slot 一次、合法 task/clock | 重复 tick、半提交、非法行动 | 中途重启、slot 重放 | 持续生活观察 | `partial`→`automated_verified` |
| S7f | `M6b-R-device-ack-replay` | device output/ACK 审计封套 | S7d | ACK 只证明 receipt | 伪造 ACK、physical claim 拒绝 | command/ack sequence 幂等 | 真实固件/实体 G6 | `partial`→`manual_pending` |
| S8 | `I2-authored-world-event-content` | 有限世界事件内容包 | S5,S7e | 内容只生成合法 candidate | 未知地点/资源/任意 mutation 拒绝 | event/content version 幂等 | 地图/故事叙事 | `planned`→`manual_pending` |
| S9 | `M7-render-and-long-disconnect` | observer snapshot、render gate、长断线 | S6 | revision/sequence 顺序渲染 | 旧快照回滚、客户端写 mutation 拒绝 | 重连恢复、历史分页冻结 | context loss/长断线 | `automated_verified`→`accepted` |
| S10 | `M8b-grounded-live-model` | 真实模型多日目标追求 | S3,S4,S6 | 有来源目标通过合法 task 成果 | ungrounded goal、错误模型、伪完成拒绝 | 跨日重启、重复反思不增量 | 人工沉浸体验 | `inconclusive`→`manual_pending` |
| S11 | `M8c-natural-long-life` | 7–14 日现实 1:1 共同生活 | S7f,S8,S9,S10 | 多源→生活→反馈→回放闭环 | 任意越权/重复/失真均停 | 每日快照、重启、回放 | 必须人工观察 | `planned`→`accepted` |
| S12 | `P7-P9-voice-body-shell` | TTS、表情、外壳/机械验证 | S11 | intent→设备 adapter→ACK | ACK 不冒充物理执行 | command/audio 幂等、断电恢复 | 必须设备人工门 | `planned`→`accepted` |

## 3. 单项验收记录规则

每项完成时，复制 v2 作业单模板为 `documentation/evidence/<item_id>-<run_id>.md`
（证据目录可由父任务决定是否公开），至少记录：

1. `item_id`、依赖状态和 `base_commit`。
2. schema/rule/content 版本及变更指纹。
3. 正向、负向、重复、重启、回放命令和结果。
4. SQLite 临时库、逻辑时钟、provider mode/calls、namespace coverage。
5. 人工观察窗、参与者、截图/录屏路径（若适用）。
6. 未通过的门、已知缺口、回滚开关与下一步。

目录的 `evidence_refs`、`status`、`last_verified_at`、`base_commit` 和 `known_gaps`
必须同一变更更新；不能只改 Markdown 状态。

## 4. 停止、回滚与并行规则

- 依赖项不是 `accepted` 或至少满足该项声明的自动门前，不启动后继项。
- 可并行项只在 writer、数据库 namespace、合同文件不重叠时进行；文档、catalog 和
  同一运行时入口默认由主任务串行更新。
- 失败只关闭新路径；不删除 canonical ledger，不覆盖用户改动，不把测试库合并进正式库。
- 同一 blocker 连续三次仍无可行替代时才标记 `blocked`，否则保持 `partial` 或
  `inconclusive` 并继续收集证据。

## 5. 本轮执行顺序

标准冻结后，建议顺序为：

1. `M6b-C` 补齐 assistant/provider/TTS 全组合并原入口回放。
2. `M6b-R` route → voice → worker → device，逐项锁定 operation journal。
3. `I2` 世界事件内容包，再做 `M8b` 真实模型多日目标追求。
4. `M7` 长断线人工门，再做 `M8c` 7–14 日自然生活。
5. 最后进入 P7–P9 的真实声音、表情、外壳和机械验证。

每一步结束先记录证据与缺口，再决定是否形成本地提交；当前用户明确要求不上传 Git，
因此本轮允许本地提交但不执行 push。任何 item 只有在自己的 required gates 全部有
证据时才可升级，邻近模块的通过结果不能代替当前 item；整条管线仍未完成。
