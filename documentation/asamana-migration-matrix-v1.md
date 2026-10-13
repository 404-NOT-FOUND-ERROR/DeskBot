# Asamana → DeskBot 正式迁移矩阵 v1

核对日期：2026-10-14
本轮公开发布分支：`codex/asamana-m6b-r-public-release-2026-10-14`（从 `codex/asamana-m6b-r-release-2026-10-14` operation-context preview 继续推进；`codex/asamana-m6b-r-public-release` 为更早 M6b-R 基线，`codex/asamana-m6b-v6-4-public-release` 为历史 v6.4 发布基线，`codex/asamana-m6b-v6-4-release`、v6.3/v6.2 保留为历史发布基线，远端状态以 Git 交付核验为准）
目标：把 Asamana 中有价值的“感知 → 动机 → 决策 → 行动 → 反馈 → 记忆/回放”机制迁移为 DeskBot 的长期共同生活能力，同时保持聚形域、喵呜、多源输入、受规则约束的世界事实和可逆角色阶段。

本矩阵是 [迁移标准](asamana-migration-standard-v1.md) 与 [迁移管线](asamana-migration-pipeline-v1.md) 的状态权威。逐项执行、回滚和证据字段见 [迁移作业单](asamana-migration-runbook-v1.md)。它不把上游 Asamana 当作 DeskBot 的运行时，也不把通过单元测试或受控样本误写成已经完成自然长期生活。

## 状态定义

| 状态 | 解释 |
| --- | --- |
| `implemented / automated verified` | 当前代码已实现，针对性自动化验收已通过；不代表真实模型、真实声音或自然长期生活已通过。 |
| `implemented / manual pending` | 代码和自动化门已具备，但需要浏览器、真实模型、长断线或人工体验证据。 |
| `contract verified` | 合同、边界和专项静态/负向门已通过；不代表原业务入口回放或完整能力已通过。 |
| `accepted` | 自动化门与适用的人工门均有可复核证据；必须引用证据清单，不能由测试数量推断。 |
| `controlled fixture only` | 受控 SQLite/模拟时间/固定输入能证明规则闭环；不能证明正式世界自然形成同样行为。 |
| `inconclusive` | 验收运行诚实结束，但关键结果没有发生或未能归因，不能算通过。 |
| `rolled_back` | 新实现已停用或回退；原 canonical 历史保留，失败证据仍可追溯。 |
| `baseline / gap` | 已有 DeskBot 基线或仍缺实现，不能以 Asamana 参考代码替代。 |
| `out of current migration scope` | 属于后续产品阶段（声音、实体、开放生成），本轮不以迁移完成计。 |

## 正式迁移矩阵

| 项 | 从 Asamana 学习的机制与目标 | DeskBot 代码映射 | 依赖 | 验收门（必须同时满足） | 当前状态与下一步 |
| --- | --- | --- | --- | --- | --- |
| G0 标准与权威边界 | 将 Soul/State、世界状态、执行结果、观察回放分层，明确谁能写事实 | `documentation/asamana-migration-standard-v1.md`、`permissions.md`、`persistent-world.mjs`、`role-stages.mjs` | SQLite canonical ledger、唯一角色阶段状态机 | 文档能列出唯一写入口、失败边界、回滚方式；客户端/LLM/trace 均无世界写权限 | `implemented / automated verified`。继续在每次迁移中维护矩阵，不能新增第二套事实源 |
| M0.1 Soul/State 与阶段分层 | 稳定个体辨识与动态需要、理解、目标、形态和职业分开；不会因一次输入重写人格 | `character-seed.mjs`、`life-state.mjs`、`npc-personas.mjs`、`role-stages.mjs`、`role-experience-packages.mjs`、`prompt-composer.mjs` | G0 权威边界、已采用双轴阶段、版本化体验包 | Soul 原文和主体身份不被动态状态改写；当前阶段按轴可逆；表达、生活、虚拟形象读取同一当前版本 | `implemented / automated verified`。稳定个体不等于固定外貌；真实口癖与沉浸质量仍需人工体验 |
| M1 阶段合同与 trace | 感知、选择、执行、反馈使用 typed stage contract，运行有稳定 ID 和可回放引用 | `runtime-contracts.mjs`、`input-runtime.mjs`、`role-evolution.mjs`、`world-candidates.mjs` | 稳定 event/evidence/revision ID、SQLite 幂等 | 同一输入重放不重复计数；模型调用成功与解析/采纳成功分开；每个 run 可追到来源与规则版本 | `implemented / automated verified`。扩大到尚未统一捕获的服务操作时仍受 M6b 约束 |
| M2 记忆分层与召回 | factual/experiential 双流、R/I/R、衰减、MMR，理解不能覆盖事实 | `lived-memory.mjs`、`memory-ranking.mjs`、`development-evidence.mjs` | canonical facts、来源事件、同根结果 | 召回是只读纯函数；同一召回不增加成长；assistant/device 输出不成为证据；来源和事实可追溯 | `implemented / automated verified`。向量召回不是当前必需项；先观察词法召回的生活质量 |
| M3 慢认知维护 | `decay → compression → reflection → goal/relation revision`，单体失败隔离 | `slow-cognition.mjs`、`cognition-cadence.mjs`、`lived-memory.mjs` | M2 记忆、canonical task/共同经历、角色知识边界 | 同一逻辑日最多一次；无新来源不重算；模型失败不生成占位故事；反思不直接改资源、身份、阶段或关系数值 | `implemented / automated verified`。真实模型跨 7–14 日仍待观察 |
| M3.1 角色感知边界 | 按位置、时刻、受众和消息状态构建每个 Agent 的已知世界，拒绝全知剧情 | `actor-perception.mjs`、`world-context.mjs`、`world-message-transport.mjs`、`npc-agent-loop.mjs` | canonical location、消息运输、世界公开事件 | 远处私人内容不进入上下文；旧位置不授予视线；来信保留来源且不算亲历；公开世界面板不泄露给角色 | `implemented / automated verified`。继续做浏览器/真实 NPC 叙事人工检查 |
| M3.2 目标持续性 | 目标不是一句反思文本，而是稳定 goal、合法 activity、实际结果和终结状态 | `slow-cognition.mjs`、`autonomous-life.mjs`、`npc-goals.mjs`、`life-planning.mjs` | 合法配方/路线/资源、真实任务结算、M3.1 上下文 | 目标跨日续接同一 `goal_id`；文本不能完成目标；成功、失败、取消、缺条件分开；重复结算不增加进度 | `implemented / automated verified`（专项 action integration）。真实模型产生的目标在后续合法机会执行仍需 M8 证据 |
| M3.3 关系与社会偏好 | 主观关系视图影响同优先级选择，但事实关系只由真实相遇、兑现和失败更新 | `social-life.mjs`、`shared-life.mjs`、`resident-projects.mjs` | M2/ M3 共同事实、canonical social task、需要优先级 | 有依据的感激/警惕只改变下一次排序；反思不能直接改信任；见面/兑现保留任务来源 | `implemented / automated verified`。更复杂的自治政治和经济仍是产品缺口 |
| M3.4 延迟消息运输 | 社交消息由原 world mutation 产生，经排队、送达、过期、撤回进入收件人的认知 | `world-message-transport.mjs`、`persistent-world.mjs`、`social-life.mjs` | M3.1 感知边界、消息 recipient/place 交集、事务 ledger | 内容原样；同地观察不走信道；重启不重复投递；撤回只保留历史，不产生行动/成长后果 | `implemented / automated verified`。继续人工验证消息在地图与故事面板中的可理解性 |
| M4 自治 cadence | cold start、need、emotion、pressure、max idle gate；正在执行的角色不被重复决策 | `cognition-cadence.mjs`、`life-choice.mjs`、`autonomous-life.mjs` | 现实 1:1 时钟、任务状态、稳定 cadence key | 重复 tick/重启不重复决策；紧急需要直接处理；模型不可用回退规则生活；真实反馈唤起下次认知 | `implemented / automated verified`。正式世界长期开机稳定性属于 M8/P9 |
| M5 行动仲裁与世界写入 | 计划、仲裁、执行、反馈分离；外部观察不能直接写世界 | `life-choice.mjs`、`life-planning.mjs`、`persistent-world.mjs`、`world-candidates.mjs`、`role-practical-trials.mjs` | 路线、容量、材料、权限、revision 乐观锁 | 预览无副作用；accept 重校验候选/版本/过期；只写合法 mutation；失败保留发生过的尝试 | `implemented / automated verified`。更丰富的世界事件需要新增合法 mutation 类型，不放宽写权限 |
| M6a canonical replay | 保存 seed、canonical ingress、adapter、时钟、mutation hash，在隔离 SQLite 通过原写入口重演 | `replay-capture.mjs`、`replay-tape.mjs`、`persistent-world.mjs`、`scripts/replay-capture.mjs` | canonical mutation ledger、SQLite transaction、规则版本 | fresh/restart/replay 状态和 mutation hash 相等；重复事件/重复 accept 无增量；replay 不调 provider、不读密钥 | `implemented / automated verified`，范围是 `canonical_world_only` 与已验证 service-ingress seam |
| M6b 全服务生产归档 | 将 input runtime、proposal/trial/candidate、HTTP chat/provider result 等操作统一捕获并按原业务入口重放 | `replay-capture.mjs` 的 operation context、journal envelope、namespace fail-closed；v6.4 已接入 chat 用户 handler 与 input-runtime fixture replay；本轮新增统一 route helper，已覆盖 role sync/proposal/stage、world candidate action、research scenario，life-choice/slow-cognition request scope | M1 envelope、各 namespace beforeCommit/afterCommit、provider result registry、fresh service replay | 一份存档覆盖所有写 namespace；中途重启、重复、缺记录、篡改均可检测；重放不绕过原业务规则 | `partial`。chat/input-runtime 专项和 route behavior baseline 已通过；route 原入口 replay、worker scheduler/NPC、WebSocket/device ACK、独立 provider fixture 和完整全服务 replay 仍是 gap；按 [M6b-R 接缝合同](asamana-m6b-route-worker-device-replay-v1.md) 逐波次接入 |
| M6b-C chat/provider 接缝 | 将聊天请求、provider/TTS 结果和输出路由作为可审计服务操作，不把台词当世界事实 | `app.mjs` `/api/chat` 用户分支、`chat-orchestrator.mjs` provider result ref、`replay-capture.mjs` journal；v6.3/v6.4 已增加受控 chat 用户 handler LLM fixture replay 接缝 | 稳定 `normalizeChat` event、脱敏 fixture registry、原 chat handler replay | LLM fixture fresh/restart/duplicate 均稳定；正文不进 archive；fixture replay 零 provider calls；缺 fixture/篡改 fail closed | `partial`。chat fixture 专项 10/10、服务端广套 861/861 已通过；独立 TTS fixture、assistant 分支、success/error/TTS 全分支和全服务 replay 仍是 gap |
| M6b-I input-runtime 接缝 | 将 source refresh、TTL/backoff、provider result、ingest callback 和 run 完成作为可恢复服务操作 | `input-runtime.mjs`、`replay-capture.mjs`、`replayServiceCapture`；run/source 状态、trace、TTL、失败退避、私有 fixture registry 与原 callback 回放 | M1 envelope、source registry、脱敏 provider fixture、input/runtime replay factory | success/skip/error、多个 source 隔离、重启/重复/篡改、provider calls=0；网络等待在事务外，失败不留半状态 | `implemented / automated verified`（I0–I7 受控 fixture）。专项 `input-runtime-replay.test.mjs` 通过；真实 provider 长期运行、其他旁路入口仍属于 M6b/M8 缺口，详见 [I4/I7 验收记录](asamana-input-runtime-replay-v1.md) |
| M6.1 行动反馈 | 区分计划、开始、进行中、成功、失败、取消、未执行，台词不等于结果 | `action-feedback.mjs`、`autonomous-life.mjs`、`persistent-world.mjs` | canonical task、稳定 receipt、任务结果 ledger | 没有 task 的完成文本只能是 `not_executed`；真实失败保留尝试；回执 `audit_only` 且不授予写权限 | `implemented / automated verified`。继续把反馈接入全服务 capture（M6b） |
| M6.2 阶段体验/资产冻结 | 学习每个世界冻结资产的合同，避免旧阶段和回放静默套用今天的新包 | `role-stages.mjs`、`role-experience-packages.mjs`、`role-experience-performance.mjs`、`world-map-content.mjs` | 体验包 schema/version/hash、stage archive、canonical map catalog | 采用时冻结 snapshot/hash；篡改 freeze fail-closed；回退保留历史；虚拟表现与真实外壳区分 | `implemented / automated verified`（阶段体验包）。地图目录已有版本与持久安装，但尚无开放资产生成/任意历史资产仓库；需作为以后开放生成的门 |
| M7 统一观察与渲染门 | live/replay 共用序列；前端重连、去重、等渲染完成再推进 | `world-observer.mjs`、`replay-tape.mjs`、客户端 `deskbot/worldObserver.ts`、`deskbot/DeskBotApp.tsx`、`three/renderCompletion.ts` | canonical revision/sequence、WebSocket、文字 fallback | 所有面板同 revision；旧快照不回滚；渲染失败不假 ACK；停机/重连恢复当前事实；客户端不能写 mutation | `implemented / automated verified`；真实 WebGL/CSS2D/RAF context loss 与长断线仍 `manual pending` |
| M7.1 历史分页与断层 | 冻结 head sequence、保留同 commit item 顺序，双向分页与断层提示 | `world-observer.mjs`、`persistent-world.mjs`、客户端 `deskbot/worldHistory.ts`、`deskbot/WorldHistoryPanel.tsx` | mutation ledger 完整性、sequence cursor、history API | 新事件不挤旧页；`history_unavailable` 不伪造数据；读取历史不写世界；回最近和 `after_sequence` 可恢复 | `implemented / automated verified`；人工长期浏览仍 `manual pending` |
| M8a 受控共同生活回放 | 用多源输入、实际任务、愿望、试做、阶段、世界候选和重启/重复证明跨模块闭环 | `scripts/review-asamana-migration.mjs`、`m8-shared-life-replay.test.mjs`、角色/生活模块 | M1–M7、隔离 SQLite、受控逻辑日 | 至少两个上海逻辑日；不重复计证据；前端能看见生活；普通表达不泄露审计字段 | `controlled fixture only` / `automated verified`。288 ingress 事件 fixture 通过；最新三日追求样本也 `verified`，Day2 目标在 Day3 重启后的下一合法机会完成。不是正式存档自然生活 |
| M8b 自主追求与真实模型 | 证明模型生成的 grounded intention 在之后合法机会中实际执行并产生后果 | `scripts/review-asamana-migration.mjs --live`、`slow-cognition.mjs`、`autonomous-life.mjs` | Clash/真实 provider、足够长观察窗、资源与机会、M6 记录 | Day 1 反思 → Day 2/3 目标 → 合法行动 → 真实结果 → 新反思；失败分类可追溯 | `inconclusive`。六次真实调用中 Day2 `ungrounded_goal` 被拒绝；三日规则样本通过不能替代这一真实模型门。不能放宽 validator，需改进 harness/prompt 后重跑 |
| M8c 自然长期生活与沉浸体验 | 证明世界会在无人持续输入时按现实 1:1 生活，角色形成可理解的兴趣/关系/故事 | 正式存档 `realtime-world.mjs`、`world-life.mjs`、`lived-scenes.mjs`、Jev Town client | M8a/b、稳定服务、断线恢复、人工体验、7–14 日观察 | 连续 7–14 日；停机不补造；Scene 不重复失真；多源输入有可解释后果；人工确认陪伴感 | `implemented / manual pending`。仍需正式存档长观察、长断线和自然中文表达体验 |
| I1 多源输入接入 | 外部天气、新闻、空气、主人/身体事件按来源、TTL、权限折射到处境和选择 | `input-runtime.mjs`、`input-refraction.mjs`、`external-connectors.mjs`、`body-perception.mjs` | 受信 adapter、TTL/退避、配置、M1 evidence | 失败隔离；过期不影响当前；新闻/天气不直接创建身份/资源；同一事件不重复计数 | `implemented / automated verified`（真实 connector 连通仍受配置/网络影响）。动态生成世界事件仍需 I2 |
| I2 输入驱动世界事件 | 让多源输入经过 evidence → candidate → preview → accept 后生成规则允许的世界事件 | `world-candidates.mjs`、`persistent-world.mjs`、`input-refraction.mjs` | I1、M5、服务端候选审核、合法 mutation catalog | 外部正文/LLM 不能直接写世界；preview 无副作用；accept 只有合法 mutation；事件可被角色按 M3.1 感知 | `baseline / gap`。候选桥已实现，但真实外部观察到丰富世界事件的内容包、adapter 和人工体验尚不足 |
| P7 真实声音 | 将统一 expression intent 接入真实中文 ASR/TTS，保持角色口癖、信息和错误边界 | `expression-intent.mjs`、`output-router.mjs`、`voice-sidecar` | 真实 ASR/TTS、音色资产、人工试听、播放回执 | 同一答语文本/意图一致；延迟、失败、重试可观测；音频不写世界 | `out of current migration scope` / `baseline only`。协议和 mock sidecar 有测试，真实模型未接入 |
| P8 实体身体与外壳 | 将阶段表现映射到屏幕、触摸、磁识别、受限 yaw 与可换壳 | `body-perception.mjs`、`device-bridge.mjs`、`body-device-config.mjs`、`role-experience-performance.mjs` | 小智固件适配、设备协议、ACK、外壳/CAD | 实测 ACK 与模拟 ACK 分离；设备输出无世界写权限；阶段变化可回退 | `out of current migration scope` / `baseline only`。软件合同存在，实机适配和生成外壳未完成 |
| P9 开放形态与世界扩展 | 在闭集体验包之后支持新职业/形态、更多地点/NPC/经济而不破坏事实边界 | `role-experience-packages.mjs`、`world-map-content.mjs`、`resident-projects.mjs` | M8 长期观察、作者审查、资产版本、合法规则与内容包 | 新包有 schema、预览/回退、生活候选和资产版本；不让模型直接生成未验证资源/几何 | `baseline / gap`。当前闭集荷叶青蛙/学徒/厨师和有限地图是刻意基线，开放生成留待后续设计 |

## 当前缺口排序

按“对长期共同生活闭环的阻塞程度”排序，而不是按代码数量排序：

1. **M6b-C → M6b-I 全服务生产归档**：当前 canonical-only replay 和首批 chat journal 不能证明 assistant/provider fixture、input-runtime、proposal/trial、candidate 等操作在生产存档中可完整恢复和重演。
2. **M8b 真实模型的多日目标追求**：需要在合法机会出现时证明目标会实际执行；`ungrounded_goal` 或未执行必须继续判为 inconclusive。
3. **M8c 正式世界长观察**：需要 7–14 日现实 1:1 运行、断线/重启、Scene 连续性和人工陪伴感证据。
4. **I2 多源输入折射为世界事件**：候选桥和权限门已存在，但可持续的事件内容包、来源适配器、事件后果和人工体验尚不完整。
5. **M7 长断线与真实渲染异常**：基础 sequence/render gate 已通过自动化，仍需 context loss、长断线、历史旧断层的真实浏览验证。
6. **P7–P9**：声音、实体与开放形态属于后续产品阶段，不能在当前迁移中用 mock 或闭集样本宣称完成。

## 当前复验与历史证据

2026-10-14 v6.2 基线复验为服务端广套 **857/857**、M8 长时生活回放 **1/1**、operation-journal/replay/persistence **27/27**、input-runtime **7/7**、chat/replay-capture **19/19**。v6.3 增量复验为服务端广套 **859/859**；v6.4 增量复验为服务端广套 **861/861**、原 chat handler LLM fixture replay **10/10**、input-runtime replay **2/2**、客户端 typecheck/build、voice-sidecar **16/16** 和 `git diff --check` 通过。上述数字是自动化证据，不是最终生活目标已经完成；独立 TTS fixture、assistant 分支、全服务生产归档和自然长期生活仍未完成。

本轮发布检查也已重新运行客户端 44 套 301/301、voice-sidecar 16/16 和生产构建（含 typecheck/client/server），全部通过；正式实时小镇截图已按本轮 22:12 的实际页面更新。页面天气显示“等待新天气”，不能据此宣称天气 provider 本轮 fresh。Asamana 独立前端 140/140 是更早的上游部署结果，本轮未重跑。真实 context loss、长断线、完整阶段像素和长期体验仍不能由这些命令代替。

当前三日规则样本的权威报告是 `tmp/asamana-migration-review-lsN0DX/report.json`（`verified`、零外部调用）；真实模式报告是 `tmp/asamana-migration-review-btgixK/report.json`（`inconclusive_reflection_failed`、六次外部调用）。报告和 SQLite 位于忽略目录，不随公开仓库上传。

## M6b namespace 边界审计

M6b 的“全服务”不是“导出时对所有 namespace 算一次 hash”。必须同时记录导致写入的规范化操作、业务输入、adapter/模型结果引用、提交边界和重启位置，并在隔离服务中通过原业务入口重演。当前实现的实际边界如下：

| 覆盖级别 | 实际 namespace/路径 | 当前证据 | 结论 |
| --- | --- | --- | --- |
| 事务内 canonical capture | `canonical-world.states`、`canonical-world.mutations`、`canonical-world.turns`；`replay.capture-*` 为捕获自身 | `persistent-world.persistCommit` 调用 `recordCommit`，同一 SQLite transaction；`replay-capture.test.mjs` 通过重启、重复、篡改和零 provider replay | `M6a implemented / automated verified`。这些是世界事实回放，不是全服务归档 |
| canonical 但未纳入 operation tape | `canonical-world.wall-clock` 的 `persistWallClockMarker`；启动/定时 `syncWallClock` 还会单独写 marker | 代码有普通 `persistence.put`，不进入 `recordCommit` 的 operation/ingress 链 | `M6b gap`。需要记录时钟同步操作，或明确把 marker 作为可由已捕获 canonical event 完全重算的派生记录并验证 |
| ingress 后副作用、仅被最终 namespace digest 检查 | `input.events`、`state.characters`、`state.results`、`world.active`、`world.matches`、`evidence.records`、`interaction.decisions/settings`、`output.commands/routes`、`devices.records`、`role.evolution-*`、`world.candidates`、`world.candidate-decisions`，以及部分 role/world 业务写入 | `app.ingestNonChatEvent` 在业务写完后调用 `recordIngress`；`replayServiceCapture` 能对已捕获 ingress 重走原入口并最终比较 namespace digest | `partial / not atomic`。捕获失败不能回滚此前已提交的这些写入；任何未从 ingress 触发的写入都没有可执行输入记录 |
| chat/voice 路径的分层接入 | `chat.turns`、`chat.correlations`、`audio.artifacts`；`POST /api/chat` 用户分支在 `chat:<event_id>` operation context 下运行，assistant/非 user 分支已有公共 `chat.reply` / `event_ingress` operation scope | `app.mjs` 规范化用户 chat、`chat-orchestrator.mjs` provider/TTS result ref、`operation-journal-contract.test.mjs`；v6.3 已把受控 LLM fixture 注入原用户 handler | `M6b-C partial`。v6.2 合同边界与 v6.3 LLM replay 已验证；独立 TTS fixture、assistant 分支、output route 和完整 success/failure/TTS/restart 边界仍待补齐；不能把 assistant 文本当世界事实 |
| 直接 HTTP role/life/research 路径 | `role.proposals`、`role.proposal-decisions`、`life.commitments`、`life.daily-summaries`、`life.memories`、`life.plans`、`life.memory-boundaries`、`research.sessions`、`l1b.probes` | `/api/roles/proposals` 的 choose/trial/observations/complete/archive、`/api/life/*` 和 `/api/research/*` 多数直接调用 domain store；只有部分 stage/practical actions 通过 `ingestNonChatEvent` | `M6b gap`。需要 route-level normalized operation envelope 和原 handler replay；只比较最终 hash不足以证明操作顺序/权限/失败分支 |
| input runtime/provider 外部路径 | `input-runtime.sources`、`input-runtime.runs`、`external-connectors.v1`、`news-title-translations.v1`、`connector.weather` | `inputRuntime` 已持久化 run/source、TTL、失败退避、trace、归一化 event IDs，并由 `app.mjs` 传入 `replayCapture` operation scope；fixture registry/原入口 replay 尚未完成 | `M6b-I partial / contract verified`（I0–I3）。需继续捕获并回放 schedule、脱敏 provider result、TTL/backoff、缓存命中和失败分类；网络等待必须在事务外，密钥不得进入归档 |
| worker / WebSocket / NPC 旁路 | `life.npc-goals`、`life.npc-agent-decisions`、`output.*` 及设备 ACK 状态；`sharedLife.tick`、`npcGoals.tick`、`worldLife.tick`、`slowCognitionWorker.tick`、WebSocket device path 可能在无 HTTP ingress 时写入 | `app` 启动/定时器/任务 timer 直接调用 worker；现有 replay seam 没有 scheduler tick envelope | `M6b gap`。需捕获 worker tick 的逻辑时刻、选择输入、provider fixture、设备回执以及实际 handler 结果；只重放状态快照不够 |

### M6b 现有实现的两个关键非原子点

1. `persistent-world.persistCommit` 的 canonical mutation 与 `recordCommit` 是同一事务，故 M6a 的世界事实不会出现“已写世界、没有 mutation tape”的半提交。
2. `app.ingestNonChatEvent` 在 `inputStore`、`persistentWorld`、evidence、output、role evolution、candidate 等业务写入完成后，才调用 `recordIngress`。因此 ingress capture 写失败时，前面的业务 namespace 不能全部回滚；`persistence` 的 `after-commit` write observer 也只能审计，不能补出可执行输入。这个边界正是 M6b 尚未完成的原因。

### M6b 完成门（比“namespace digest 相等”更严格）

要把 M6b 从 `gap` 提升为已完成，必须新增并通过以下证据：

1. **覆盖注册表**：捕获启动时冻结预期 namespace/版本清单，包括本轮无记录的 namespace；运行期间禁止未登记 writer。
2. **操作封套**：每次 HTTP、WebSocket、input-runtime tick、worker tick、provider result、设备 ACK 和内部 domain action 都有稳定 `operation_id`、规范化请求、adapter、逻辑/收到时间、结果引用和前后 namespace digest。
3. **原子提交**：业务写入与 operation journal 在同一 SQLite transaction；捕获失败、缺 envelope 或未登记 namespace 必须回滚业务写入。仅 `subscribeWrites` 或事后 hash 不合格。
4. **原业务重演**：隔离服务按原入口重放 HTTP/worker/domain handler，不能 SQL 导入或直接覆盖状态；provider 使用已捕获、脱敏且固定的结果 fixture，调用数必须为 0。
5. **边界重启与重复**：在每个 operation 前后、同 commit 多写、定时 tick、provider 失败、候选 preview/accept、重复 HTTP 和 SQLite 重启点重放，比较所有 namespace 的记录顺序、状态、失败分类和 semantic hash。
6. **负向完整性**：删掉一个 envelope、篡改 adapter/请求/结果、插入未登记 writer、改变 rule/content fingerprint、在 capture 关闭期间写入，均应 fail closed，且目标库不得产生部分业务状态。
7. **数据安全**：capture 默认关闭、仅本地显式开启、不开放 HTTP；密钥、音频原文和不可回放的用户敏感内容不得进入公开归档，provider 结果引用与脱敏策略可审计。

当前 `replay-capture.test.mjs` 与 operation-journal 专项已证明 M6a、一个 `ingestNonChatEvent` service seam，以及 `/api/chat` 用户分支的 operation 归属/摘要边界；它们尚未证明上述七项的全服务生产覆盖，因此不能将 `service_ingress_namespaces_verified` 写成 M6b 完成。Chat/provider 与 input-runtime 的逐项字段、负向门和停止条件见 [M6b 服务操作接缝合同](asamana-m6b-seam-contract-v1.md)。

## 可复核的验收证据入口

服务端测试路径相对 `apps/deskbot-service/test/`；客户端测试路径相对 `apps/jev-town-client/tests/`。文件存在和总数通过只是入口，需审查每个测试是否实际覆盖对应门。

| 门 | 已有证据入口 | 尚缺的完整证据 |
| --- | --- | --- |
| M1/M2 | `runtime-contracts.test.mjs`、`memory-ranking.test.mjs`、`lived-memory.test.mjs`、`role-evolution.test.mjs` | 正式生活的召回质量仍需人工观察，不用新增重复单元测试替代 |
| M0.1/M6.2 | `role-experience-packages.test.mjs`、`role-experience-runtime.test.mjs`、`role-stages.test.mjs`、`world-map-content.test.mjs` | 完整阶段像素、真实口癖体验和开放资产历史保真 |
| M3/M3.2 | `slow-cognition.test.mjs`、`slow-cognition-action-integration.test.mjs`、三日 review report | 真实模型跨日 grounded goal 实际追求与后果 |
| M3.1/M3.4 | `actor-perception.test.mjs`、`world-message-transport.test.mjs` | 真实 NPC 对话中的知识边界和消息可读性 |
| M3.3/M4 | `social-relation-preferences.test.mjs`、`social-life.test.mjs`、`cognition-cadence.test.mjs`、`cognition-cadence-integration.test.mjs` | 1:1 时间的自治频率、重复行为和社会生活质量 |
| M5/M6.1 | `world-candidates.test.mjs`、`world-candidates-http.test.mjs`、`action-feedback.test.mjs`、`autonomous-life.test.mjs` | 更丰富事件与协作的合法内容包和人工效果 |
| M6a/M6b | `replay-capture.test.mjs`、`replay-determinism.test.mjs`、`persistence-journal.test.mjs`、`operation-journal-contract.test.mjs`、[M6b 接缝合同](asamana-m6b-seam-contract-v1.md) | `/api/chat`/input-runtime/全部 service operation 的 executable capture 与原业务入口 replay，而非 SQL 导入；v6.3 已完成受控 chat 用户 handler LLM fixture replay，input-runtime 及其他 service operation 尚待接入 |
| M7/M7.1 | `world-observer*.test.mjs`、`world-history*.test.mjs`；客户端 `renderCompletion.test.ts`、`worldHistory.test.ts` | 浏览器真实 context loss/长断线、恢复之后 snapshot 继续到达，旧断层可返回实时 |
| M8a/M8b/M8c | `m8-shared-life-replay.test.mjs`、`scripts/review-asamana-migration.mjs`、真实模式报告 | 真实模型成功样本、正式 7–14 日观测、中文叙事与陪伴人工结论 |

## 统一验收记录格式

每个迁移项在进入 `implemented / automated verified` 前必须留下：源码映射、正向测试、负向测试、SQLite 重启/重复证据、可观察读模型和失败分类；字段模板、回滚结果和证据清单见 [迁移作业单](asamana-migration-runbook-v1.md)。进入 `manual pending` 后还要有运行时间、配置/代理、页面或音频证据、人工结论。`controlled fixture only`、`inconclusive` 和当前 v6.3 的 `partial` 不得升级为已完成；失败应保留在报告中而不是放宽规则。

Asamana 软件迁移目标只有在 M6b、M8b、M8c、I2 的所需验收全部完成后才可称为完整。完整产品目标“长期共同生活的桌面潮玩生命体”还需要 P7/P8 的真实声音与身体证据；这些是独立后续阶段，不扩大本次迁移范围。当前版本是规则底座已成形、迁移大部分已落地，但自然长期生活和输入驱动世界演化仍未完成。
