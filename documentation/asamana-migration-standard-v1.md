# Asamana 迁移标准 v1

> M6b-R 增量（2026-10-14）：`codex/asamana-m6b-r-public-release-2026-10-14` 已完成受控 input-runtime/chat、voice transcribe/tts 原入口 replay 接缝，并把 worker operation 纳入验收；服务端广套和其余 route/worker/device 覆盖以本分支证据为准，M6b 全服务仍为 `partial`。

状态：`adopted`（迁移标准）。具体迁移项的唯一状态表见 [正式迁移矩阵](asamana-migration-matrix-v1.md)；本文保留权威边界、共同合同和迁移范围说明。逐项执行与证据字段见 [迁移作业单](asamana-migration-runbook-v1.md)。

当前公开发布分支为 `codex/asamana-m6b-r-public-release-2026-10-14`，从 `codex/asamana-m6b-r-release-2026-10-14` operation-context preview 继续推进；`codex/asamana-m6b-r-public-release` 作为更早 M6b-R 基线，`codex/asamana-m6b-v6-4-public-release`、`codex/asamana-m6b-v6-4-release`、v6.3/v6.2 的发布记录仍保留为历史基线。本文是能力范围说明，分支交付仍以 commit 和远端核验为准。当前分支已收口受控的 chat/input-runtime/voice transcribe/tts replay 接缝，并把 worker operation 接入验收；assistant/provider 全分支和 M6b 全服务生产回放仍未完成，M6b 仍为 `partial`。

本文把本地部署的 [dreamscroll-lab/asamana](https://github.com/dreamscroll-lab/asamana) 作为架构参考，不把它当作 DeskBot 的上游运行时。Asamana 本地副本位于 `C:\Users\Administrator\Desktop\Jeremy\asamana-runtime`，Apache-2.0，后端 `7860`、前端 `5174`，当前可浏览示例世界，本机组装 file+mock profile 使用上游提供的 mock provider；Docker/真实模型不是本次 DeskBot 运行前提。

## 1. 迁移结论

可以迁移的是工程机制，不是产品哲学：

- 迁移“感知 → 动机 → 决策 → 行动 → 反馈”的阶段化编排，减少一个无限增长的 agent loop。
- 迁移 typed JSON/结构化阶段合同、运行 trace 和回放元数据。
- 迁移 SoulLayer/StateLayer 分离；在 DeskBot 现有 `world_fact`、`personal_interpretation`、`hearsay` 三类记录上增加只读的事实/解释/听闻 stream 投影、R/I/R（词法相关性/近期性/重要性）和 MMR 去重，不新增第二套 memory writer。
- 迁移慢认知维护：衰减、压缩、反思、长期目标修订和关系演化。
- 迁移 cadence gate，使自治频率由需要、情绪、压力和空闲超时共同决定。
- 迁移受权限控制的 mutation channel、作者权限、观察依据、snapshot/replay/event sequence 和前端按序渲染；Asamana 的 mutation channel 不是其所有世界事实的唯一写入口，DeskBot 仍以 `persistentWorld.ingest` 作为唯一 canonical 写入口。
- 迁移行动仲裁后的结构化反馈合同：计划、开始、资源转移、成功、真实执行失败、取消和未执行必须分开；回执为 `audit_only`，以 canonical task 为依据，不能授权写世界或从台词推断结果。

明确不迁移：

- Asamana 的“AI as a human”作为 DeskBot 的人格定义；喵呜仍是奇幻潮玩生命体，不被拉回完整拟人。
- Asamana 的单主题、有限步数世界作为 DeskBot 的时钟。DeskBot 继续使用现实 1:1 时间，重启恢复已发生的事务但不补造停机期间未安排的生活。
- Python 文件快照替换 DeskBot 的 SQLite canonical world。
- 可直接修改世界的导演/`direct` 接口。DeskBot 的外部输入必须经过 evidence → candidate → preview → accept → `persistentWorld.ingest`。
- 固定外观 SoulLayer。DeskBot 的外壳、职业和表达必须由已采用的 role stage 派生，且虚拟形态不等于真实外壳已经更换。

## 2. 权威边界

`persistentWorld.ingest` 是世界事实唯一写入口；proposal/trial/stage 是角色生命周期唯一状态机；客户端和 LLM 只能提交受限请求或合法候选。runtime trace 是 `audit_only`，不能反向成为 prompt、evidence、角色分数或世界事实。

| 对象 | 唯一权威 | 允许的迁移影响 |
| --- | --- | --- |
| 世界事实、资源、任务、位置、revision | `persistent-world.mjs` / SQLite | 只能增加审计与回放元数据 |
| 角色愿望、试做、阶段 | `role-proposals.mjs`、`role-practical-trials.mjs`、`role-stages.mjs` | 只能增加证据引用、trace 和投影 |
| 记忆 | `lived-memory.mjs` | 改善只读召回，不因召回重复增加成长 |
| 现实来源 | `input-runtime.mjs`、受信 adapter | 增加运行合同，不能授予来源写权限 |
| 场景和客户端 | canonical read model | 增加序列门控，不能维护第二个可写世界 |

## 3. 共同合同

所有迁移模块必须满足：

1. 事件、证据、决策和 mutation 使用稳定 ID；同一输入重放不得重复计数。
2. 跨模块传递优先使用版本化 JSON 合同；自由文本只作为叙事呈现，不作为状态写入协议。
3. trace 记录真实阶段，不凭空补造未执行阶段；模型“调用成功”与“结果解析/采纳成功”分开。
4. preview 无副作用；accept 重新校验过期、预期 revision、权限和领域规则。
5. 任何自动化都要能从 SQLite 重启恢复；恢复不重新计费、不重复写事实。
6. 失败、未知、未执行、被拒绝和已完成必须可区分，且能按 run/event 追溯。
7. 迁移不扩大外部输入、网页内容、设备输出或客户端的信任边界。

### 3.1 统一迁移目录与 Gate Crosswalk（设计）

为了让“逐项迁移”可审计、可调度，后续以一个机器可读的迁移目录（建议
`documentation/asamana-migration-catalog-v1.json`）作为矩阵、管线和 M6b
registry 的共同来源。目录不替代本标准的叙述性边界，而是冻结每个迁移项的
唯一身份、依赖、责任和证据关系。每条记录至少包含：

```json
{
  "item_id": "M6b-R-device-ack-replay",
  "phase": "M6b-R",
  "wave": "R7",
  "upstream_refs": ["asamana:engine/event_seq.py"],
  "deskbot_modules": ["apps/deskbot-service/src/websocket-bridge.mjs"],
  "authority_writer": "devices.records",
  "contracts": ["deskbot.service-operation.v1"],
  "dependencies": ["M1", "M6b-R-registry"],
  "required_gates": ["G0", "G1", "G2", "G3", "G4", "G5", "G7", "R0", "R1", "R2", "R3", "R4", "R6", "R7", "R8"],
  "status": "partial",
  "evidence_refs": [],
  "known_gaps": ["real firmware ACK"],
  "last_verified": null
}
```

目录规则：`item_id`、`authority_writer` 和 `required_gates` 必须唯一且不能为空；
新增 side-effect writer 先登记再实现；没有目录记录的 writer 在 CI/回放模式中视为
`unknown_writer` 并 fail closed。状态更新必须同时写入 evidence reference、base
commit、rule/content fingerprint 和原因；代码、合同、fixture 或规则指纹变化后，
旧证据自动标记 `stale`，不能继续支撑 `automated_verified` 或 `accepted`。

统一 Gate Crosswalk 将各阶段子门映射到通用门：

| 通用门 | 含义 | M6b 子门示例 | 其他阶段示例 |
| --- | --- | --- | --- |
| G0 | 合同、权威写入口、信任边界冻结 | R0、C0、I0 | M0/M1 |
| G1 | 正向成功、skip 和必要结果 | R1、C1、I1/I2 | M3/M4/M5 |
| G2 | 负向、安全和 fail-closed | R4、C3、I6 | M5、I1 |
| G3 | 幂等、重复和冲突 | R1/R2、C0/C2、I4 | M3.2、M6a |
| G4 | 重启、恢复、提交边界 | R2、I4/I5 | M4、M7 |
| G5 | 原业务入口隔离回放 | R3、C2、I5 | M6a/M6b |
| G6 | 页面、声音、设备或长期观察 | R7（模拟 ACK 仍不等于实机） | M7/M8/P7/P8 |
| G7 | 交付、安全文件和可复核证据 | R8 前的发布检查 | 所有公开发布项 |

每个目录项都要为每个 `required_gate` 记录 `pass`、`fail` 或 `na` 及理由；
`na` 不能静默填写，必须说明为什么该门不适用。只有所有必需门为 `pass`、依赖项
已接受、无未豁免 critical gap 且证据未过期时，迁移项才可进入 `accepted`。

## 4. 当前证据

已在本地落地并验证：

- `runtime-contracts.mjs`：阶段顺序、trace recorder、稳定输入指纹和 replay metadata；专项测试已通过。
- `input-runtime.mjs`：真实 input/perception seam 的运行记录，保留 TTL、失败退避、SQLite 恢复和来源隔离。
- `role-evolution.mjs`、`world-candidates.mjs`：增加审计型 replay 引用，不改原状态机和世界写权限。
- `memory-ranking.mjs`、`lived-memory.mjs`：中文 bigram/英文 token 的词法 cosine 相关性，固定 `.7/.2/.1` 权重，近期半衰期 72h，三类记录衰减半衰期 336/168/72h，以及同锚点/高相似度 MMR 的只读召回投影。它不会压缩、删除、写回兴趣或增加证据；重要性使用存档值或规则默认值，未新增模型评分。
- Jev Town 客户端生活 feed：优先按 canonical mutation sequence 排序，刷新重叠时不让旧响应回滚叙事。

- `slow-cognition.mjs` / `cognition-cadence.mjs`：每日有来源的反思、有限目标与主观关系视图，以及需要/压力/真实反馈/最大空闲的决策调度。慢认知目标的 `activity_id` 只能绑定引用的同话题 canonical activity；`null` 只保留兴趣意图，其他同话题活动不能冒充目标成果。新理解不变成独立成长证据，也不直接写资源、角色阶段或关系数值。
- `social-life.mjs`：只用有效、未过期且有双方共同事实支撑的主观关系视图影响同优先级合法来往的排序，偏好分数限制在 `-3..3`；信任、相遇和兑现计数仍只由实际见面、兑现或失败更新，并保留事务、任务和事件来源引用。
- `actor-perception.mjs`、`world-message-transport.mjs`：区分亲历、同地观察、延迟投递、公开消息和未知；消息查询使用明确的 `at`，非法源日期隔离，送达后撤回保留原文与状态历史并标记 `historical_only`，不再产生行动偏好。全镇观察面板不赋予主角全知。
- `world-observer.mjs`、`replay-tape.mjs` 与客户端历史面板：统一 live/read payload、序号与 render gate；历史读取核验 ledger，不执行行动、不重调模型、不改正式世界。历史分页冻结 `head_sequence`，同时报告 `current_sequence`，使用 before/after cursor 和同一提交内的 `item_index`；客户端保持有界窗口并支持回最近与 `after_sequence` 恢复。正式旧历史存在完整性不符时返回 `history_unavailable`。
- `action-feedback.mjs`：以 `deskbot.action-feedback.v1` 固定 `authority=audit_only`，保存稳定回执 ID、因果事件、任务状态和失败分类；真实任务失败仍是一次发生过的尝试，而没有 canonical task 的“完成”文本只能是 `not_executed`。
- 阶段体验包采用时冻结 version/snapshot/hash，已有阶段的生活、表达、TTS 意图与虚拟外观不会被新 registry 静默改写。
- `input-runtime.mjs` / `replay-capture.mjs`：source run、TTL/backoff、success/skip/error、重复结果和原 ingest callback 已接入私有 fixture replay；fixture 只存在本地 tape，operation journal 只保存脱敏引用，回放不调用 provider。专项合同与证据见 [M6b-I4/I7 验收记录](asamana-input-runtime-replay-v1.md)。

v6.2 分支的历史实现与验证记录保留：服务端广套 857/857、M8 长时生活回放 1/1、operation-journal/replay/persistence 27/27、input-runtime 7/7、chat/replay-capture 19/19、客户端 44 套 301/301、voice-sidecar 16/16 和生产构建。v6.4 当前通过原 chat handler LLM fixture replay 10/10、input-runtime replay 2/2、服务端广套 861/861、客户端 typecheck/build、voice-sidecar 16/16 和生产构建；独立 TTS fixture、assistant/provider 全分支和 M6b 全服务 replay 不在通过范围内。隔离两日 M8 fixture、重启/重复规则和真实 DeepSeek 六次调用的 `inconclusive_reflection_failed` 仍按历史证据保留。长时间断线恢复、完整阶段像素验收、真实模型多日运行和长期沉浸体验仍需验收。逐项代码映射、依赖和验收门见 [正式迁移矩阵](asamana-migration-matrix-v1.md) 与 [迁移作业单](asamana-migration-runbook-v1.md)。

### M6 本地捕获范围

`src/replay-capture.mjs` 提供一个显式、本地、默认关闭的 canonical-ingress 捕获器。设置 `DESKBOT_REPLAY_CAPTURE_DIR` 后，它在 canonical mutation 的同一 SQLite 事务中记录版本化 seed、原始 event、受信 adapter、receipt/logic clock、mutation digest，以及已取得的慢认知模型结果引用；`scripts/replay-capture.mjs export/replay` 可在新的 SQLite 中只通过现有 `persistentWorld.ingest` 回放，支持中途重启、重复投递和零 provider calls。归档目录被 gitignore，未开放 HTTP 入口，不读取密钥，也不写源存档。

CLI 回放的验证范围仍是 `canonical_world_only`。同一捕获器另外记录经 `ingestNonChatEvent` 的有序入口、投递重复标记、入口前后 canonical operation 边界与结果 hash；带这种入口的归档标记为 `canonical_world_with_service_ingress`，不能据此自动宣称所有服务操作已捕获。`replayServiceCapture` 是本地隔离工厂 seam：先经原 `persistentWorld.ingest` 补齐独立内部操作，再经原业务入口回放输入，核验所有非捕获 namespace 的记录数与语义 hash。多时间、重复投递、SQLite 中途重启及入口篡改拒绝已专项验证；缺少任何 namespace 结果时失败，不用 SQL 导入替代业务重放。

`persistence.mjs` 已提供默认关闭的 commit/before-commit write audit 与流式 namespace 读取；v6.4 已接入 input-runtime source run 的可执行 replay，但独立 proposal/trial/candidate 决策、HTTP chat/provider 全分支、wall-clock marker 和 worker/WebSocket 旁路尚未统一完成。因此 M6a 世界捕获已完成，M6b 全服务生产归档仍未完成。本轮不将入口 seam 测试替代该验收门；完整 namespace 边界、原子提交和七项完成门见 [正式迁移矩阵](asamana-migration-matrix-v1.md)。canonical 捕获缺口会在恢复或导出时拒绝；其他未捕获服务写入会由全 namespace 对比检出，但事后 digest 不能证明操作顺序、权限或失败分支已被捕获。

v6.2 已把 `/api/chat` 的 `role=user` 分支收口为第一批 `chat.request` operation：请求先规范化、生成稳定事件 ID，再在 `chat:<event_id>` context 中运行；assistant/非 user 分支也进入公共 operation scope。operation journal 只保存摘要 hash 和脱敏的 `deskbot.provider-result-ref.v1`，不保存聊天正文；本地私有 replay tape 为了可重放可能保留事件和 provider fixture 原文，不得公开发布。v6.4 已通过受控 chat 用户 handler 的 LLM fixture replay 专项 10/10、input-runtime replay 2/2 与服务端广套 861/861；这只覆盖已声明的 fixture 路径，不等于 success/error/TTS 全分支、assistant 分支或完整 chat replay 已通过。M6b 的接缝合同、状态和下一阶段 route/worker 验收门见 [M6b 服务操作接缝合同](asamana-m6b-seam-contract-v1.md)，逐项执行见 [迁移作业单](asamana-migration-runbook-v1.md)。
