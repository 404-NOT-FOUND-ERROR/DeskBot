# 聚形域接口与调用链

依据 [当前开发基线](development-baseline.md)。本表区分已有实现和下一轮待统一合同。新增接口或迁移入口时，同步更新 `contracts/architecture.v1.json`，执行 `npm run check:architecture` 和 `npm test`。

## 当前链路与状态归属

| 环节 | 实际入口与接缝 | 写入归属 | 失败和恢复 |
| --- | --- | --- | --- |
| 输入刷新 | `input-runtime.createInputRuntime` → 来源适配器 → 原事件入口 | 输入状态表；世界变化仍经 `persistent-world.ingest` | 提供者故障与 TTL 分开；不补写亲历 |
| 内容安装 | `content-packages`、`world-map-content` → 原世界安装动作 | 作者文件只读；运行状态在 canonical world | 校验引用、路线、版本；扩展活动包尚非通用可安装格式 |
| 活动方法 | `activity-methods` → 原配方执行器、选项目录、完成证据、发展主题 | 同一作者定义只读；方法绑定和结果由世界执行器写入 | 条件键、定义指纹、取消退料与 SQLite 恢复；见 [接入规范](activity-methods.md) |
| 唤起 | `cognitive-schedule.scheduleCognitiveActor` → `cognitive-life.run` | Node 认知 job、计划控制权和时钟 | 原任务优先；待反馈保持控制权；同人物调用串行 |
| 冻结感知 | `cognitive-life-state.cognitiveContext` → `freezeCognitiveReferences` | Node 冻结本人可知对象、来源、能力和相关状态 | 提交时复核实际状态；状态过期与模型错误分开 |
| 选择 | `cognitive-choice-catalogue` → stdio bridge → `life_worker` / Asamana → `catalogue_choice` | Python 只生成候选意图、记忆和理解 | v2 选项由程序绑定；旧合同保留用于兼容，禁止隐式切换 |
| 接纳与执行 | `applyCognitiveMutation` → 原任务、资源和社交执行器 | Node 核验并通过唯一世界事务结算 | 已送达不等于答应；资源预留、耗时和失败仍由执行器负责 |
| 结果与记忆 | `cognitiveActualResult` / `cognitiveMemoryFrame` → Python feedback → Node 接纳 | 事实来自实际结果；个人理解保留本人范围 | 技术失败只进入 job 诊断，不创造经历；重启先反馈原结果 |
| 公开结果与责任 | `cognitive-event-evidence` → 选项/消息/实际回执 → `event_evidence.py` 与 Node 复核 | Node 投影执行结果；消息与条款仍由原执行器保存 | 完成通知不等于告知读数；责任需当前条款和动作范围；见 [事件证据接口](cognitive-event-evidence.md) |
| 机会、目标与后续 | `cognitive-opportunities`、`cognitive-goal-opportunities` → 选择 / Asamana 目标适配 / `cognitive-continuation` | Node 保存条件绑定、目标证据和事项；视图只读 | 同源用途和条件、失效复查、实际结果根与恢复，见 [机会规范](cognitive-opportunities.md) |
| 稳定目标与复查 | `cognitive-goal-lifecycle` ↔ Python `goal_lifecycle` / `OpportunityNeedEngine` → 原 `goal_bindings` | Node 固定标准并校验显式转换；Python 无世界提交权 | 等价方法、近义目标、跨夜、单次唤起、恢复与旧合同；见 [A2 规范](cognitive-goal-lifecycle.md) |
| 可知位置 | `cognitive-position-knowledge` → `event_evidence.people` → 原感知采用 | 本人有界位置知识，来源为已采用观察或实际收到的结构化报告 | 不从远处人物状态补全，思考时间不改冻结观察时间，过期线索置为未知 |
| 发展 | `cognitive-development` → 同一结果根 | Node 保存兴趣、能力与愿望状态 | 登记方法主题接入；目标文本不授予实践或角色资格 |
| 表现 | `app` 的 `/api/world/snapshot` → 前端地图、任务、人物与角色投影 | 客户端只读投影；输入请求返回服务端 | 显示版本、断线和实际绘制；动画不能结算任务 |

调用链不是每个 tick 都完整执行。plan、perceive、feedback、reflect、relate 和 maintain 有不同入口与上下文范围。正式启用由 `cognitive-runtime` 的独立 live budget 和人物配置控制，实验额度不会开启正式人生。

## 现有合同覆盖

| 合同 | 当前版本或表示 | 完整性 |
| --- | --- | --- |
| 早期 cognition context/proposal/result/memory | `services/deskbot-cognition/contracts/*.v1.json`，双方读取 | 有共享结构，范围是早期隔离观察，不能视为完整生活 Schema |
| 持续认知 context/proposal | context v3、proposal v2/v3，手写适配与校验 | 已运行；仍需集中定义完整合同 |
| 具体动作目录 | `deskbot.choice-catalogue.v2` | 模型选择、Python 绑定、Node 复核已接；活动语义登记尚不完整 |
| 行动来源字段 | `deskbot.cognitive-decision-fields.v1` | Python 提示/绑定与 Node 共用类别和错误码；需要类型不代替行动来源，不自动推断或修正本人意愿 |
| 反馈阶段字段 | `deskbot.cognitive-followup-phases.v1` | Python 提示/校验与 Node 接纳共用允许字段；步骤归档及目标绑定只属计划，反馈保留实际结果、证据与未来意向，不重复执行 |
| 公共事件证据 | `deskbot.cognitive-event-evidence.v1` | 结果摘录、送达回执、事实依据与当前约定范围；Python/Node 共用错误码和反例；旧 job 保留历史语义 |
| 活动方法与条件 | `deskbot.activity-methods.v1`，`method-conditions-v2` | 第二轮迁移普通汲水、借灯净滤与水岸测记；同源定义、分条件证据和兴趣主题已接，其他活动仍待迁移 |
| 事项与后续 | `deskbot.cognitive-continuation.v3` + `deskbot.opportunities.v1` | 第三轮共用机会、用途与条件；生命周期仍有双端校验，由共同反例约束 |
| 短期目标步骤 | `deskbot.goal-opportunities.v1` | 显式机会绑定与执行结果根；未绑定设想只保留个人意义 |
| 世界结果与个人记忆 | 原 task/root outcome + `deskbot.event-memory-frame.v1` | 事实有依据；生成感受受限，不代表最终自由表达 |
| 失败报告 | `deskbot.cognitive-failure.v1` 与共享分类目录 | 第一轮接入运行诊断；未知原因保留 unknown，不推断为模型故障 |
| 世界内容 | 当前地图和作者内容包 v1 | 能安装有限目录；第二轮提取活动方法接口，地区规律、活动与表现的完整包合同留待 R3-C |

## 失败报告

统一字段为 `schema`、`layer`、`code`、`cause_code`、`phase`、`stage`、`job_id`、`actor_id`、`retryable`、`record_as_experience`。原始错误码继续保留，以兼容已有日志和重放；诊断报告只保留有限符号字段，不复制提示、模型原文或密钥。

分类区分 transport、provider、budget、contract、decision、stale_context、world_precondition 和 unknown。`upstream_decision_failed` 只能定位到决策未成功，不能据此断言是格式还是生活语义问题。实际调用阶段随错误保留，包装为 `python_session_failed` 时不丢失已知原因。

报告是观测合同，不能授予重试、扩展预算或改变原状态转换。`retryable` 由实际错误及既有调度规则决定。正常的休息、放下、拒绝、条件受阻结果不转为技术异常；任务实际失败仍按原结果形成经历。

## 第一轮验证边界

架构检查验证登记项的路径、导出接缝、生产者/消费者、唯一世界提交归属、证据文件和版本引用。它是可维护的接口索引，不是对全部代码副作用的形式化证明。

同一测试入口执行架构检查及反例、跨语言失败合同、Node 服务测试、Python 认知全部 unittest、语音 sidecar、前端测试和构建。CI 使用相同入口，不按不完整路径列表漏掉认知与内容改动。

第一轮未修改活动和兴趣规则、放宽候选接纳、启用正式新认知或运行付费模型。旧失败响应、真实 Python 桥接和原执行器的无付费集成用于保护行为边界。

## 第二轮验证边界

第二轮在同一执行链上登记三种方法，增加条件绑定、分条件结果证据、事实记忆和发展主题投影。接口登记增至 11 个模块、10 个接口。验证包括实际 Python 绑定、Node 执行和 SQLite 恢复，不用模型生成文本代替执行结果。完整检查结果见 [第二轮交付记录](../research/milestones/architecture-round2-2026-10-28.md)。

第二轮交付时，当前选择已能读取方法条件，反馈、短期目标与后续仍有脱节。第三轮接入同源机会投影，登记增至 12 个模块、11 个接口，结果见 [第三轮交付记录](../research/milestones/architecture-round3-2026-10-28.md)。离线通过不推导真实模型或自然生活通过。

[第四轮冻结复验](../research/milestones/architecture-round4-2026-10-28.md) 在第一个行动选择的来源字段处失败，完成 0/20。之后统一行动来源字段，登记为 12 个模块、12 个接口；精确合同错误只进入 job 诊断。原版本缓存回放与当前版本反例回归分别记录，不以免费模拟纠正代替真实模型采用。

[10 月 31 日复验](../research/milestones/architecture-round4-retest-2026-10-31.md) 完成 2/20 后停止于第三次结果反馈；实际装罩保留。共享反馈阶段合同将登记扩至 12 个模块、13 个接口。两端拒绝规划专属字段和未知附带字段；只读世界字段沿用既有保护。反馈不能事后改完成标准或将另一事项恢复为当前事项，允许凭已有目标证据收束，也允许继续研究。原失败与本地修复分别保留，完整 life context/proposal 的共享 Schema 仍未全部统一。

随后 [反馈阶段合同版冻结验收](../research/milestones/r3a-phase-contract-validation-2026-10-31.md) 完成 18/20、有效 15 个，在语义审阅处停止：完成通知被个人后续扩大成读数已告知，原责任枚举与实际约定也未完全贯通。该批原始结论保留。

2026-11-01 [事件证据第一批](../research/milestones/r3a-event-evidence-2026-11-01.md) 接入共享内容/送达/责任校验，登记为 13 个模块、14 个接口。原失败以未修改反例校验，新协议经真实子进程和 SQLite 离线恢复；目标连续性、历史位置和新版真实模型复验仍未完成。后续按 [标准交付管线](../research/design/engineering-delivery-plan-2026-11-01.md) 推进。

同日 A2 后续交付已补目标生命周期、等价方法、复查时钟和历史/报告位置，登记为 **15 个模块、16 个接口**。新 job 强制版本合同，旧冻结响应按旧协议回放；记录与边界见 [A2 交付](../research/milestones/a2-goal-lifecycle-2026-11-01.md)。R3-A 真实模型复验仍待 A3。
