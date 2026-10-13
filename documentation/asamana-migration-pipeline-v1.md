# Asamana 迁移管线 v1

目标：把 Asamana 已验证的编排和可观察性机制，迁移到 DeskBot 的“长期共同生活的桌面潮玩生命体”闭环，同时保留聚形域、喵呜、多源输入、角色阶段和受控世界事实边界。逐项的目标、代码映射、依赖、验收门和状态以 [正式迁移矩阵](asamana-migration-matrix-v1.md) 为准。

## 阶段门

| 阶段 | 交付 | 验收门 | 状态 |
| --- | --- | --- | --- |
| M0 | 迁移标准、权威边界、风险和回滚合同 | 文档能区分上游参考、DeskBot 事实和未知 | `implemented` |
| M1 | runtime trace、typed contracts、replay metadata | 输入、角色演化、世界候选都能关联 event/evidence/revision；重放不改变策略 | `implemented` / `automated verified` |
| M2 | 现有三类记忆的双流投影、R/I/R、衰减、MMR、事实-解释关联 | 召回是纯函数；同一召回不增长；原有 assistant/device 输出证据隔离通过回归 | `implemented` / `automated verified` |
| M3 | 慢认知维护 | 只在 cadence 到期时执行 decay → compression → reflection → goal/relation revision；失败不阻塞生活 | `implemented` / `automated verified` |
| M4 | 自治 cadence gate | 主角和居民按需要、压力、情绪和空闲阈值安排认知；跨日重启后频率连续 | `implemented` / `automated verified` |
| M5 | mutation channel 治理强化（DeskBot 原有能力；本轮增加 candidate replay 审计） | 非确定性/非受信观察先成为候选；preview 无 revision 变化；accept 只能写合法 mutation；受信天气 adapter 继续兼容 | `baseline implemented` / `automated verified` |
| M6 | snapshot/replay/restart | 事件序号、SQLite 状态、候选、trial、stage 在重启和重复回放下保持一致 | `canonical capture implemented` / `automated verified`；隔离服务入口 seam 支持多时间、重复与中途重启并核验全部 namespace；独立调度/决策/chat 操作尚未统一捕获，完整生产服务归档未完成；历史断层仍严格返回 `history_unavailable` |
| M7 | 前端观察连续性 | 服务端统一 snapshot/WS、客户端 revision/sequence gate、重连和有界 render gate | `implemented` / `automated verified`；基础历史面板已接入，长期断线与历史浏览体验待验收 |
| M8 | 长期共同生活回放 | 两个以上逻辑日、多源输入、角色试行、合法世界候选、重启和人工沉浸体验闭环通过 | 既有 288 事件隔离 fixture `automated verified`；三日受控目标追求样本 `verified`；真实模型为 `inconclusive_reflection_failed`，人工长期体验仍 `pending` |

## 每阶段固定流程

1. 先写合同和失败边界，再改实现。
2. 先添加针对性测试，再修改代码。
3. 运行模块专项测试，再运行服务端完整回归、客户端 typecheck/build。
4. 执行 `git diff --check`，排除密钥、数据库、音频、截图和临时输出。
5. 更新本表状态；`automated verified` 不代表 `manual pending` 已通过。
6. 每个阶段保留可回滚点；不把上游 Asamana 文件复制进 DeskBot 运行时，避免形成第二套事实源。

## 当前交付边界与下一批顺序

M0–M8 的代码底座属于 v3 基线，但不等于每个迁移项或最终闭环都已通过；精确状态以 [正式迁移矩阵](asamana-migration-matrix-v1.md) 为准。本轮已在本地创建 `codex/asamana-shared-life-v4`，保留 `main` 和 v1–v3 分支；远端完成状态由交付核验确认。2026-10-13 本轮复验服务端 843/843、客户端 44 套 301/301、voice-sidecar 16/16、生产构建（含 typecheck/client/server），全部通过。Asamana 独立前端 140 项是更早的上游部署结果，本轮未重跑。自动样本不会污染正式世界。

本版补齐 M3.2 合法候选到同配方实际任务的连接，保留终结目标状态；M6 的大存档恢复按需 hydration，因果场景索引不载入无关 diff；M7 的 WebGL/CSS2D/RAF 异常进入真实文字视图后才推进序列，旧断层提供返回实时入口。普通正式页面与往事已检查并更新效果图，真实 context loss、长断线、真实模型多日生活与完整阶段像素仍待验收。

`scripts/review-asamana-migration.mjs` 新增零外部请求的三日实际生活验收，首日完整意图→计划→任务→结果成立；次日真实实践与反思成立，原具体目标等待下一次合法机会，第三日重启后通过原计划和真实任务完成。最新报告 `tmp/asamana-migration-review-lsN0DX/report.json` 为 `verified`，原资源、每日实践上限和期限保持有效。模型合法返回空目标仍必须报告 inconclusive。来源幂等、SQLite 重启和世界候选门通过，但该受控样本不等于 M8 自然长期生活通过。真实 DeepSeek 模式已使用 Clash 执行最多六次调用；报告 `tmp/asamana-migration-review-btgixK/report.json` 为 `inconclusive_reflection_failed`，Day2 `ungrounded_goal` 被拒绝，未放宽 validator。

历史完整性差异已定位并修复新序列的表示问题，“小镇往事”的基础前端交互和真实旧断层提示已有人工证据。下一批顺序为：M6b 全服务生产归档 → M8b 真实模型多日目标追求 → M7 真实渲染异常/长断线 → I2 规则世界事件内容包 → M8c 7–14 天现实 1:1 观察。无需重复实现已通过的 M1/M2/M3/M4 基线；真实中文声音、设备和外壳沿 v0.5 后续阶段推进。

## 原迁移合同与持续验收门

以下是原迁移的固定合同，并非重新开工的待办清单。当前缺口优先级按上文和正式矩阵执行；并行开发只在文件所有权不重叠时采用。每项必须同时具备源码、负向测试、SQLite 恢复和可观察结果，完成状态再写回矩阵。保留现有实际愿望、试做和双轴阶段，不回退成旧聊天试行机制。

| 门 | 可实施合同 | 必须证明的结果 |
| --- | --- | --- |
| M3 | `world.memory.maintenance` 保存每日每角色准备/调用/完成记录；事实压缩保留原记录及来源；反思只写个人理解，有限目标与关系标签仅影响后续偏好 | 同日最多一次、无新来源不重复反思；模型错误/非法来源无虚构理解；重启不重复调用；世界资源/身份/关系数值不被反思改写 |
| M4 | `world.memory.cognition_cadence` 仅门控新模型请求；冷启动/真实反馈/需要/压力/空闲使用稳定键，既有模型额度继续适用 | 在途任务照常结算、紧急需要直接执行、重复 tick/重启不重复决策；真实反馈可唤起下次认知，失败仍有规则生活 |
| M6 | 捕获版本化 seed、原事件、adapter、时钟与已获得模型响应；隔离 SQLite 重放，相同事实 ledger/revision/state 哈希；源存档只读 | 原运行、重启运行和新存档重放相等；重复事件/重复接受无增量；不重新调用真实模型、不导入外部写权限 |
| M6.1 | 行动反馈以 `deskbot.action-feedback.v1` 记录 canonical task 的真实状态，区分未执行、进行中、成功、失败和取消 | 台词不能伪造完成；失败尝试保留发生过的事实；回执稳定、可 JSON 恢复且不授予世界写权限 |
| M7 | 服务端一次捕获 canonical world 投影 map/Scene/NPC/feed/role；只读 world stream，按 revision/sequence 门控、断线重连与有界播放 | 不同面板同 revision；旧快照不回滚；地图完成呈现才推进下一帧；停机/重连能恢复当前事实，客户端无法写 mutation |
| M8 | 两上海日期隔离实际生活样本，加来源、实践、愿望、试做、采用、回退、世界候选、重启/重复回放 | 跨模块一致而不重复计证据；前端可见生活过程；普通表达不泄露审计字段；人工体验与自动化证据分别报告 |

M3 的压缩是可重算的来源索引和摘要，不删除 canonical 事实。其衰减沿用 M2 召回分数；理解、目标和关系标签不充当独立成长依据。模型失败保留代码层失败状态，台词和记忆不写故障占位故事。

### 2026-10-12 语义闭环复审

模块通过测试不等于生活闭环完整。本次复审发现三项先前表述过宽的缺口，并增加以下门；未通过前，不把 M3 的“有意图和关系视图”说成“已经能持续追求目标和改变来往”。

| 门 | 交付合同 | 验收效果 |
| --- | --- | --- |
| M3.1 | 每个体的认知使用自己的亲历、同地观察、来信及公开消息；世界面板可全镇观测，角色不共享全知 | 远处私人内容不进入 NPC 模型上下文；旅行中的旧位置不授予视线；来信保留出处且不算亲历 |
| M3.2 | 带来源的有限意向具有稳定 goal ID、状态、实际任务绑定与结果；偏好仅影响现有合法候选 | 文本不能完成目标；真实成功、失败、取消和缺条件分开；SQLite 重启及重复结算不增加进展 |
| M3.3 | 主观关系视图有限影响同优先级来往；基本需要先于偏好，数值关系由实际事务结果更新 | 有依据的感激/警惕改变下一次邀请排序；反思不直接改变信任；真实见面与兑现保留事务/任务原因 |
| M3.4 | Asamana 消息管线在原 social canonical mutation 中运行；邀请与已核验公告产生延迟消息，收件人与地点取交集 | 内容原样、排队/送达/过期/撤回分开；同地观察不走外部信道；没有新增记忆、成长、任务或关系后果；重启不重复投递 |
| M7.1 | 历史分页冻结头序号、保留同 commit 条目顺序；有界前后翻页，重连后恢复当前事实 | 翻页期间新事件不挤走旧页；旧断层有明确提示；客户端历史读取不写 canonical world |

本次语义收口另覆盖三项：慢认知目标带 `activity_id` 并经来源事实校验，只有实际执行同一合法配方才能记进展；actor cognition 按请求时间裁剪已送达消息；无效 source 时间戳不使 social tick 崩溃，已撤回邀请保留历史状态但不再影响行动偏好。专项回归与 811 项总数均通过。

这些门是原迁移的补齐，不引入第二套世界、记忆或角色阶段状态机。消息正文、反思与 observer snapshot 都不能成为新的完成事实。

### M3：慢认知维护

把 Asamana `engine/cognition_maintenance.py` 的顺序迁移为 DeskBot 的只读/受控维护任务：

```text
decay → compression → reflection → goal revision → relation evolution
```

反思输入只能来自已经落地的 canonical task、共同经历和安全记忆；反思输出先是 interpretation/insight，不直接改变角色阶段或世界。压缩必须可追溯到 source memory IDs，且保留关键情绪锚点。当前 M2 的衰减只是召回分数权重，不是 M3 的持久化删除或压缩。

### M4：自治节拍

将 Asamana `engine/scheduler.py` 的 cadence gate 映射到已有 `autonomous-life`：紧急需要优先，已有任务不打断；无压力时按主角/居民 idle 上限安排；模型不可用时回退规则计划。节拍是调度，不是人格决定，不得绕过路线、材料、容量和时间规则。

### M6：回放门

为输入运行、角色演化和 world candidate 提供统一 replay fixture：同一 SQLite、同一 event 序列、同一规则版本必须产生相同 canonical revision 和 mutation IDs；LLM 输出不作为重放确定性的假设。

现有 replay tape 是已捕获 fixture 的隔离确定性输入重演；正式历史面板是只读 snapshot/ledger 观察。显式本地捕获器通过 `DESKBOT_REPLAY_CAPTURE_DIR` 开启：canonical world 的 seed、原始 event、受信 adapter、receipt/logic clock、mutation receipt 和已取得的慢认知模型结果引用在 canonical 事务内记录，`scripts/replay-capture.mjs export/replay` 在新 SQLite 只经原写入口回放。它默认关闭，不开放 HTTP，不读取密钥，不写源存档；导出和恢复均拒绝未捕获 canonical gap。

另外已捕获 `ingestNonChatEvent` 的有序入口、重复投递、operation 边界与结果 hash，归档为 `canonical_world_with_service_ingress`。本地 `replayServiceCapture` seam 通过隔离原 runtime 核对所有 namespace 的语义 hash，专项证明多时间、重复事件和中途重启；CLI 仍只验证 `canonical_world_only`。持久化 write audit 是可用基础，不是已完成的统一可执行 journal。input-runtime 独立调度、proposal/trial/candidate 独立决策、HTTP chat 与 provider 输出尚待捕获和对应原业务重放，不能将本轮称为全服务生产归档器。

### M8：人工体验

使用临时 SQLite：注入对话/天气/NPC 多源观察，跨两个逻辑日观察 Scene、feed、NPC 面板、喵呜主动提案和 stage 投影；重复注入、重启、preview/accept 各做一次。普通聊天不得泄露 score、rule_version、evidence 或后台 trace。

## 可观测性与回滚

每个 run 至少关联 `run_id`、`rule_version`、`source/event IDs`、`evidence IDs` 和 world revision 前后值。迁移失败时只停止新迁移 worker，保留已有世界、角色阶段和任务；不得删除或重写历史 canonical ledger。若新召回或节拍导致生活质量下降，回滚到原 `retrieveLivedMemory`/规则 cadence，trace 和 replay metadata 可以保留为审计数据。

## 最终命令

```powershell
npm.cmd --prefix apps/deskbot-service test
npm.cmd --prefix apps/jev-town-client run typecheck
npm.cmd --prefix apps/jev-town-client run build
git diff --check
```

本阶段的交付方式是独立分支备份；不修改 `main`，也不把本地密钥、数据库、音频、缓存、临时截图或测试输出纳入提交。
