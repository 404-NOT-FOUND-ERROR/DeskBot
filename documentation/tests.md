# 当前验证与实验

**当前功能基线：v0.5 · 角色发展第 6 阶段、Asamana 迁移与持续生活投影补强，2026-10-14。** 当前工作分支为 `codex/asamana-m6b-seam-v6-4-input-runtime-replay`；v6.3/v6.2 从 v6.1 复验的数字作为历史基线保留。本文件区分历史复验、当前专项和更早证据；测试数量不代表迁移完整完成。逐项证据字段与回滚要求见 [迁移作业单](asamana-migration-runbook-v1.md)。

## 最近完成的检查

| 范围 | 已完成结果 | 能说明什么 |
| --- | --- | --- |
| DeskBot 服务完整回归（v6.3） | 广套 861/861 通过；原 chat handler LLM fixture replay 10/10；input-runtime replay 2/2；M8 长时生活回放单独 1/1（2026-10-14）。v6.2 的 operation-journal/replay/persistence 27/27、input-runtime 7/7、chat/replay-capture 19/19 作为历史基线保留 | 当前代码的世界、存档、资源、生活、来源、记忆、角色发展、体验包、设备与接口规则回归；独立 TTS fixture、assistant/provider 全分支和全服务 replay 仍未完成 |
| 第 6 阶段最终专项复核 | 37 项通过 | 最终组合答语、重试边界、实际制作与送架、原自主生活接入；这是补充复核，不另报未经全量重跑的总数 |
| 3D 客户端 | 44 套、301/301 通过（2026-10-14 本轮发布复验，`npm.cmd --prefix apps/jev-town-client test`） | 读模型、控制、样本、场景、组合几何、渲染失败回退和生活 feed 连续性；不替代浏览器像素检查 |
| 前端类型与生产构建 | 本轮生产构建通过（含 typecheck/client/server） | 类型一致性和可构建性 |
| voice-sidecar 接口 | 16 项通过（2026-10-14 本轮发布复验） | 无真实模型的 ASR/TTS 协议与失败边界；不代表中文识别或合成已接通 |
| M6b chat operation 合同（v6.2 历史基线） | operation-journal / replay-capture 专项通过（覆盖用户 chat operation 归属、request hash 不落正文、provider/TTS 结果引用、重复 chat 幂等） | 证明首批 `/api/chat` 用户分支的审计边界；不证明 assistant 分支、durable provider fixture 或原 `/api/chat` handler replay |
| M6b-C2/C3 原 chat handler 回放（v6.3/v6.4） | `node --test test/replay-capture.test.mjs` 10/10；服务端全量 `npm.cmd test` 861/861 | LLM fixture fresh/restart/duplicate、缺失/篡改 fail closed、`provider_calls=0`；独立 TTS fixture、assistant 分支和全服务 replay 仍未纳入 |
| M6b input-runtime operation 合同 | `input-runtime.test.mjs` operation-scope 专项通过；`input-runtime-replay.test.mjs` 2/2（source run、TTL skip、error/backoff、重启/重复和 fail-closed 负向门） | 证明 I0–I7 的 operation scope、结果引用与受控 fixture replay；不证明真实 provider 长期运行、原子回滚覆盖所有旁路或全服务恢复 |
| SQLite 阶段实验 | 九种隔离样本，重启前后完整世界一致 | 原任务和配方产生的实际成果能支持预览、采用、组合和按轴回退 |
| DeepSeek Flash 有限状态样本 | 三种公开虚构摘要真实调用通过 | 明确区分未采用、已采用、形态回退而职业继续；不代表所有连续聊天或真实语音均已验收 |

完整证据与条件见 [第 6 阶段验收](../research/milestones/role-development-stage6.md)、[角色体验包路线](role-experience-roadmap-v1.md)、[正式迁移矩阵](asamana-migration-matrix-v1.md) 和 [迁移作业单](asamana-migration-runbook-v1.md)。2026-10-14 v6.2 历史基线在 Windows 工作站通过服务端广套 857 项、M8 长时生活回放 1 项、operation-journal/replay/persistence 27 项、input-runtime 7 项、chat/replay-capture 19 项、客户端 301 项、voice-sidecar 16 项和生产构建。v6.3 当前通过原 chat handler LLM fixture replay 10/10、input-runtime replay 2/2、服务端广套 861/861、客户端 typecheck/build、voice-sidecar 16/16 和 `git diff --check`；独立 TTS fixture、assistant 分支和全服务 replay 仍未完成。Asamana 前端 140 项是更早测试结果，本轮未重跑。Asamana 本地 mock 部署与 DeskBot 隔离，不代表 DeskBot 已采用 Asamana 运行时。

本次新增 `slow-cognition-action-integration.test.mjs`：托盘、做饭与光果供给从合法候选进入实际任务，由同配方真实结果结算目标；旅行、缺材料及重复结算不形成完成进度。`persistent-world-restart.test.mjs` 验证账本流式恢复、过滤后有限 hydration、feed/历史一致性与跨世界 Scene 隔离；默认账本接口仍保留完整 diff。`slow-cognition.test.mjs` 保留已完成、失败、取消和撤回意图的真实状态。

客户端 `renderCompletion.test.ts` 验证 WebGL/CSS2D 异常不产生假 ACK，文字视图提交后才能继续队列；`worldHistory.test.ts` 区分永久旧断层和可重试网络失败。正式页面的实时地图、往事还原及返回实时已人工检查并更新截图；真实 context loss、长断线和完整阶段像素验收仍待完成。

## 当前自动覆盖

以下文件位于 `apps/deskbot-service/test/` 和 `apps/jev-town-client/tests/`。

| 能力 | 主要覆盖 | 代表测试 |
| --- | --- | --- |
| 现实钟与持续任务 | 上海日期、停机校正、回拨保护、禁止生产快进、到期结算、重启和真实旅行 | `realtime-world.test.mjs`、`realtimeTravel.test.ts` |
| 生活事实到故事投影 | 任务状态、真实结果、同地 NPC、跨槽延续、地点设置、feed 重启与分页 | `lived-scenes.test.mjs`、`world-life.test.mjs`、`persistent-world-http.test.mjs` |
| 地图与环境 | 十地点目录、区域/物件、合法扩建、封路、重规划、天气与环境更新 | `world-map-content.test.mjs`、`world-environment.test.mjs`、`mapCatalog.test.ts`、`routeVisual.test.ts` |
| 可感知场景 | 工作姿态、资源/项目读模型、风雨与昼夜、家庭和工作灯光、光粒居民造型 | `activityProjection.test.ts`、`sceneWorkplace.test.ts`、`domesticLights.test.ts`、`shapingFigures.test.ts` |
| 自主生活与供给 | 有限候选、需要优先、真实任务、库存预留、生态恢复、错开生产、帮助与食物交接 | `autonomous-life.test.mjs`、`living-resources.test.mjs`、`life-supply-cycle.test.mjs`、`supply-coordination.test.mjs`、`supply-help.test.mjs` |
| 居民与关系 | Persona、有限目标、邀约、约定、共同生活与三个长期项目 | `npc-personas.test.mjs`、`social-life.test.mjs`、`resident-projects-domain.test.mjs`、`shared-life-reports.test.mjs` |
| 多源折射 | 来源权限、TTL、过期、失败退避、消息去重与重启、有限新闻和区域空气 | `input-refraction.test.mjs`、`input-runtime.test.mjs`、`external-connectors.test.mjs`、`inputInfluences.test.ts` |
| 共同记忆与发展维度 | 事实/消息/理解分层、同根去重、建议与实际结果区分、主动/受邀实践、条件困难 | `lived-memory.test.mjs`、`development-causality.test.mjs`、`development-facets.test.mjs`、`development-facets-integration.test.mjs` |
| 有依据的愿望 | 前提、冻结依据、冷却、主人回应、旧关键词/聊天旁路限制、事实校准 | `role-wishes.test.mjs`、`role-wish-lifecycle.test.mjs`、`role-wishes-http.test.mjs`、`role-wish-chat-guard.test.mjs` |
| 实际试做 | 原任务准入、当前方式及回顾窗口的主要成功、两上海日、缺料与失败区分、暂停/调整/退出、预留释放与重载 | `role-practical-trials.test.mjs`、`role-practical-trials-http.test.mjs`、`rolePracticalTrials.test.ts` |
| 阶段采用与回退 | 只读预览、指纹过期、双轴组合、封存试做、当前阶段回退、重试与恢复、实际生活候选 | `role-stages.test.mjs`、`role-stages-http.test.mjs`、`roleStages.test.ts`、`roleStageFigures.test.ts` |
| 角色体验包 | 合同校验、组合/冲突/回退、运行时迁移、Chef 世界投影、包内表达、统一表现、Explorer 实际活动与只读 HTTP | `role-experience-packages.test.mjs`、`role-experience-runtime.test.mjs`、`role-experience-world-life.test.mjs`、`role-package-prompt-expression.test.mjs`、`role-experience-performance.test.mjs`、`role-explorer.test.mjs`、`role-experience-http.test.mjs` |
| 表达一致性 | 当前双轴、历史不冒充当前、单方向与组合问答、屏幕/mock TTS/outbox 共用答语 | `role-stage-expression.test.mjs`、`role-wish-fact-guard.test.mjs`、`role-practical-expression.test.mjs` |
| 身体与输出协议 | 登记能力、可信感知、未知壳、坐标、受限 yaw、ACK、失败、过期和重启 | `body-perception-domain.test.mjs`、`body-perception-http.test.mjs`、`body-device-config.test.mjs`、`websocket-bridge.test.mjs` |
| 网络与配置 | provider 错误不泄露上游正文/密钥、天气缓存、配置重载、音频工件与 sidecar 合同 | `llm-http-error.test.mjs`、`weather-persistence.test.mjs`、`voice-sidecar-client.test.mjs`、`audio-artifacts.test.mjs` |
| Asamana 迁移合同 | 阶段 trace、慢认知节拍、角色感知边界、行动回执、replay、observer、历史完整性与首批 operation journal | `runtime-contracts.test.mjs`、`cognition-cadence.test.mjs`、`actor-perception.test.mjs`、`action-feedback.test.mjs`、`replay-determinism.test.mjs`、`replay-capture.test.mjs`、`operation-journal-contract.test.mjs`、`world-observer*.test.mjs`、`world-history.test.mjs` |

历史研究回放、旧角色方向与世界候选也保留兼容测试。它们不能替代现版本的实际生活愿望与试做门槛。

历史回放的完整性检查是严格的：新产生且可逆的序列应返回 200；真实迁移断层、重复 sequence、revision 分叉或未能从当前 canonical state 逆推的序列必须返回 `409 history_unavailable`，不能用放宽校验换取“看起来能回放”。提交边界会把内存状态规范化为 SQLite 的 JSON 表示，避免 `undefined` 字段造成运行态与重启态差异。

## 复现检查

从仓库根目录运行，使用 Node.js 24 或更新版本。先在 `apps/jev-town-client` 安装前端依赖。

```powershell
npm.cmd --prefix apps/deskbot-service test
npm.cmd --prefix apps/jev-town-client test
npm.cmd --prefix apps/jev-town-client run typecheck
npm.cmd --prefix apps/jev-town-client run build
```

单独重现第 6 阶段的完整隔离样本：

```powershell
node scripts/review-role-stages.mjs
```

启动正式客户端后，可在 `/development-review.html?sample=stages` 查看样本。脚本重新走第 4 阶段的实际路线和配方前置经历，再进入独立 SQLite。样本只有一个活动个体，十二位居民暂停，初始有限库存、次日需要与苗床条件是明确的受控条件。两种方向各产生两个上海日的主要成功，共四项主要结果与十二个新共同结果，没有直接插入完成成果。

九种样本是 `prepared`、`first-result`、`ready-preview`、`adopted-form`、`adopted-combination`、`ordinary-life`、`restart`、`rollback-form`、`rollback-vocation`。实验不导入正式世界，也不强制正式角色产生愿望或采用形态。

其他隔离入口：

```powershell
node scripts/review-body-perception.mjs --smoke
node scripts/review-body-perception.mjs
```

身体样本通过模拟设备真实经过 WebSocket、命令下发与延迟 ACK，界面为 `/body-review.html`。模拟回执不证明真实感知、屏幕、底座或中文播放已接通。

部署复核先读取 `/health`、`/api/model/status`、`/api/input-runtime`、`/api/life/body` 与 `/api/roles/evolution`。HTTP 成功、旧天气快照或配置存在，都不能单独证明本次模型/来源连通或实体动作成功。

### Asamana 跨日生活验收

```powershell
node scripts/review-asamana-migration.mjs
```

脚本新建 `tmp/asamana-migration-review-*/isolated.sqlite`，只使用公开虚构初始化、真实生活执行器、受控时钟和最多六次 fixture 选择，不读取或写入正式世界，也不种入完成任务或记忆结果。最新默认运行跨三个上海日期，使用两日反思和有限生活选择，零外部请求；首日目标→计划→同配方任务→完成成立，次日真实活动与新反思形成的原具体目标在第三日重启后的下一合法机会完成。`tmp/asamana-migration-review-lsN0DX/report.json` 返回 `verified`，资源、每日实践上限、原期限和任务链保持有效。SQLite 恢复、来源事件幂等、候选 preview 无副作用、accept 与重启后重复 accept 均通过。合法空目标另测仍返回 `inconclusive_no_intention`；不注入目标来强行通过。

`--live --config <本地配置路径> --max-requests 6` 是显式真实模型模式，需要在 Node 启动前配置 Clash HTTP/HTTPS 代理并启用 `NODE_USE_ENV_PROXY=1` 或 `--use-env-proxy`。本轮已经执行六次真实调用，`tmp/asamana-migration-review-btgixK/report.json` 返回 `inconclusive_reflection_failed`：Day1 反思与目标成功，Day2 `ungrounded_goal` 被拒绝；所有 life-choice 请求均返回。未放宽 validator，也不把 provider 返回等同于目标采纳或自然生活成功。报告与数据库留在忽略目录。当前脚本用于受控目标追求验收，不能证明真实多日自发愿望、完整阶段像素或长期沉浸效果。

## 实验效果的解释

第 1–6 阶段已验证同一共同结果可以进入生活、兴趣/能力、愿望、试做与阶段，而不是各自维护一套经验值。采用会改变有限日常选项和同一 3D/表达投影；回退不删除经历。受控跨日样本验证了这些规则可执行。

此前供给阶段完成十四日加速规则实验，发展维度阶段完成三日隔离实验；它们证明有限规则在指定条件下运作，不等于正式世界自然经过这些天。早期普通循环实验也有未达到多情境稳定兴趣、未形成愿望的结果。不能只展示成功样本就宣称人格或愿望已自然涌现。

第 6 阶段完整像素验收仍待完成。2026-10-13 正式小镇与往事图片是基础页面检查，页面于 2026-10-14 再次复核；2026-10-05 场景图片是独立美术预览。有限真实模型状态摘要没有发送完整存档、个人记忆或真实对话，也不能证明长期表达质量。

## 后续验收

| 工作 | 需要形成的证据 |
| --- | --- |
| M6b-C chat/provider 接缝 | v6.3 受控 chat 用户 handler fixture replay 的专项目测与广套回归；仍需 assistant/非 user chat operation、provider fixture registry、success/error/TTS/duplicate/restart 的完整原 `/api/chat` handler replay；`provider_calls=0`，缺 fixture/篡改 fail closed |
| M6b-I input-runtime 接缝 | `input-runtime:<run_id>` operation scope 覆盖 start/skip/success/error、TTL/backoff、多个 source、ingest callback、SQLite 重启/重复与 provider fixture replay；网络等待在事务外且不留半状态 |
| M6b-R 其余服务入口 | role/life/research/candidate、worker、WebSocket/device ACK 的覆盖注册表、原入口回放和失败分支；完成前不打开全局 `requireOperationContext` |
| 第 7 阶段真实声音 | 中文 ASR/TTS 连通、同一答语、人工试听、延迟、一次回合与播放失败恢复 |
| 第 8 阶段真实身体 | 小智固件适配后的触摸、触屏、双麦方向、地磁、屏幕和受限单轴动作；回执与实测分别记录 |
| 第 9 阶段长期观察 | 正式 1:1 时间连续 7–14 天的供给、关系、兴趣、愿望、反复行为和模型开销；据实际结果拓展地图、职业和居民 |
| 当前视觉与表达体验 | 正式浏览器的昼夜、风雨、工作灯、阶段预览/组合/回退；连续真实对话中来源与状态可读、信息完整 |

阶段顺序与后续计划见 [v0.5 路线](../research/development-roadmap-v0.5.md)，历史细节见 [第 2 阶段供给](../research/milestones/community-supply-stage2.md)、[第 3 阶段维度](../research/milestones/role-development-stage3.md)、[第 4 阶段愿望](../research/milestones/role-development-stage4.md)、[第 5 阶段试做](../research/milestones/role-development-stage5.md) 与 [第 6 阶段采用](../research/milestones/role-development-stage6.md)。
