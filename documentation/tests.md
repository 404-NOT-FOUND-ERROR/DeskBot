# 当前验证与实验

## 2026-10-20 R3 修正批次

首次冻结 `89ae6146fdef` 前，后端 **854/854**、Python **24/24**、TypeScript 与 Vite 构建通过。随后仅两条四窗口病例，58 次真实调用，峰时保守估算 **¥1.1778212**；六个完整窗口，一次第三窗口计划失败。原版本 **2/2** 缓存复现初终态及异常类别，新增调用 **0**，不把失败回放计为行为成功。

后续本地修正 `034f89cfbcfa` 完整后端 **857/857**、Python **26/26**、相关专项 **47/47** 通过。新增回归覆盖换措辞/缩减收件人不能重复催问、实际收件编号回复可唤起发送者、私有联系依据不泄漏、新观察允许继续、休息/失败不构成新结果，以及精确话语段落修复提示。最新前端 TypeScript 与 Vite 构建通过，保留既有大 chunk 警告；浏览器可读本轮修正、两例失败边界与单独费用。服务重新载入后 `/health` 为 ok，聊天记录接口仍可读取 28 条。后续修正未再次付费复验，未放行 R4，见 [修正报告](../research/milestones/cognition-r3-hardening-2026-10-20.md)。

## 2026-10-20 R3 首轮

修复后后端 **843/843**、Python **21/21**、前端 TypeScript 与生产构建通过，保留既有大 chunk 警告。新增回归覆盖留言标题不能证明物品交付、旧任务证据、冻结背包、材料预扣与完成增量、重启重复结算及兴趣夹具补算一致性。

真实实验完成 108 组主对照、6 组人物、4 组有效兴趣；局部修复另有 4 例，含一条协议失败，原失败保留。共 122 条初终态/异常类别可零调用回放。原主矩阵至少四例存在关键叙述错误，因此 R3 尚未整体验收。完整分母、无效夹具、费用、局部修复和剩余工作见 [R3 里程碑](../research/milestones/cognition-r3-2026-10-20.md)；不能用测试数量代替生活质量。

## 2026-10-19 恢复与蜕壳原野重建

前端完整回归 54 组、305 项通过；末轮新增减少动态效果下的灯光测试，相关 5 项通过。TypeScript 与 Vite 构建通过。服务恢复专项 51 项通过，覆盖重启、迁移、地图、风语林和连续后续；本轮未重跑全部服务测试。桌面与手机浏览器已核对全景、工作位置、昼夜风雨、正式存档只读与聊天草稿。几何测试包含投影连续性、隐藏实例不漂移，以及实际路径不被地面/空地网格遮盖。完整条件与剩余限制见 [6B 蜕壳原野记录](../research/milestones/shaping-field-stage6b-shell-v4.md)。

## v0.6 发布检查（2026-10-11）

本轮服务 768 项：767 项直接通过，地图新增夜灯状态导致旧数量断言失败，已修正，最终相关专项 35/35 通过。前端 269 项：268 项直接通过，并发路径测试超时后单独 9/9 通过。Python 17 项、类型检查和生产构建均通过；资源体积警告及边界见 [第五阶段验收](../research/milestones/asamana-cognition-stage5-v1.md)。

新增合同覆盖权限、冻结引用、感知回执、私有关系、有限方法、记忆归档、公平调度、实际机会、兴趣归因、角色试做和恢复。真实模型样本与确定性测试分开，后续逐项评分为 7/11；不能用自动测试数量代替生活质量。每次付费实验应先约定数据范围与费用，默认只运行虚构夹具。

以下保留 v0.5 角色发展验证记录，数字不是本次重新运行结果。


**以下历史基线：v0.5 · 角色发展第 6 阶段，2026-10-07。** 保留当时已验证的规则和实际边界；当前发布结果以上方 v0.6 检查为准。

## 最近完成的检查

| 范围 | 已完成结果 | 能说明什么 |
| --- | --- | --- |
| DeskBot 服务完整回归 | 649 项通过 | 世界、存档、资源、生活、来源、记忆、角色发展、设备与接口规则的回归基线 |
| 第 6 阶段最终专项复核 | 37 项通过 | 最终组合答语、重试边界、实际制作与送架、原自主生活接入；这是补充复核，不另报未经全量重跑的总数 |
| 3D 客户端 | 39 套、259 项通过 | 读模型、控制、样本、场景和组合几何；不替代浏览器像素检查 |
| 前端类型与生产构建 | 均通过 | 类型一致性和可构建性 |
| SQLite 阶段实验 | 九种隔离样本，重启前后完整世界一致 | 原任务和配方产生的实际成果能支持预览、采用、组合和按轴回退 |
| DeepSeek Flash 有限状态样本 | 三种公开虚构摘要真实调用通过 | 明确区分未采用、已采用、形态回退而职业继续；不代表所有连续聊天或真实语音均已验收 |

完整证据与条件见 [第 6 阶段验收](../research/milestones/role-development-stage6.md)。本次文档整理不把已有回归快照写成重新运行结果。

## 当前自动覆盖

以下文件位于 `apps/deskbot-service/test/` 和 `apps/jev-town-client/tests/`。

| 能力 | 主要覆盖 | 代表测试 |
| --- | --- | --- |
| 现实钟与持续任务 | 上海日期、停机校正、回拨保护、禁止生产快进、到期结算、重启和真实旅行 | `realtime-world.test.mjs`、`realtimeTravel.test.ts` |
| 地图与环境 | 十地点目录、区域/物件、合法扩建、封路、重规划、天气与环境更新 | `world-map-content.test.mjs`、`world-environment.test.mjs`、`mapCatalog.test.ts`、`routeVisual.test.ts` |
| 可感知场景 | 工作姿态、资源/项目读模型、风雨与昼夜、家庭和工作灯光、光粒居民造型 | `activityProjection.test.ts`、`sceneWorkplace.test.ts`、`domesticLights.test.ts`、`shapingFigures.test.ts` |
| 自主生活与供给 | 有限候选、需要优先、真实任务、库存预留、生态恢复、错开生产、帮助与食物交接 | `autonomous-life.test.mjs`、`living-resources.test.mjs`、`life-supply-cycle.test.mjs`、`supply-coordination.test.mjs`、`supply-help.test.mjs` |
| 居民与关系 | Persona、有限目标、邀约、约定、共同生活与三个长期项目 | `npc-personas.test.mjs`、`social-life.test.mjs`、`resident-projects-domain.test.mjs`、`shared-life-reports.test.mjs` |
| 多源折射 | 来源权限、TTL、过期、失败退避、消息去重与重启、有限新闻和区域空气 | `input-refraction.test.mjs`、`input-runtime.test.mjs`、`external-connectors.test.mjs`、`inputInfluences.test.ts` |
| 共同记忆与发展维度 | 事实/消息/理解分层、同根去重、建议与实际结果区分、主动/受邀实践、条件困难 | `lived-memory.test.mjs`、`development-causality.test.mjs`、`development-facets.test.mjs`、`development-facets-integration.test.mjs` |
| 有依据的愿望 | 前提、冻结依据、冷却、主人回应、旧关键词/聊天旁路限制、事实校准 | `role-wishes.test.mjs`、`role-wish-lifecycle.test.mjs`、`role-wishes-http.test.mjs`、`role-wish-chat-guard.test.mjs` |
| 实际试做 | 原任务准入、当前方式及回顾窗口的主要成功、两上海日、缺料与失败区分、暂停/调整/退出、预留释放与重载 | `role-practical-trials.test.mjs`、`role-practical-trials-http.test.mjs`、`rolePracticalTrials.test.ts` |
| 阶段采用与回退 | 只读预览、指纹过期、双轴组合、封存试做、当前阶段回退、重试与恢复、实际生活候选 | `role-stages.test.mjs`、`role-stages-http.test.mjs`、`roleStages.test.ts`、`roleStageFigures.test.ts` |
| 表达一致性 | 当前双轴、历史不冒充当前、单方向与组合问答、屏幕/mock TTS/outbox 共用答语 | `role-stage-expression.test.mjs`、`role-wish-fact-guard.test.mjs`、`role-practical-expression.test.mjs` |
| 身体与输出协议 | 登记能力、可信感知、未知壳、坐标、受限 yaw、ACK、失败、过期和重启 | `body-perception-domain.test.mjs`、`body-perception-http.test.mjs`、`body-device-config.test.mjs`、`websocket-bridge.test.mjs` |
| 网络与配置 | provider 错误不泄露上游正文/密钥、天气缓存、配置重载、音频工件与 sidecar 合同 | `llm-http-error.test.mjs`、`weather-persistence.test.mjs`、`voice-sidecar-client.test.mjs`、`audio-artifacts.test.mjs` |

历史研究回放、旧角色方向与世界候选也保留兼容测试。它们不能替代现版本的实际生活愿望与试做门槛。

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

## 实验效果的解释

第 1–6 阶段已验证同一共同结果可以进入生活、兴趣/能力、愿望、试做与阶段，而不是各自维护一套经验值。采用会改变有限日常选项和同一 3D/表达投影；回退不删除经历。受控跨日样本验证了这些规则可执行。

此前供给阶段完成十四日加速规则实验，发展维度阶段完成三日隔离实验；它们证明有限规则在指定条件下运作，不等于正式世界自然经过这些天。早期普通循环实验也有未达到多情境稳定兴趣、未形成愿望的结果。不能只展示成功样本就宣称人格或愿望已自然涌现。

第 6 阶段尚未完成实际浏览器像素与新截图验收，本机自动化初始化失败。现有 2026-10-05 场景图片应按独立美术预览阅读。有限真实模型状态摘要没有发送完整存档、个人记忆或真实对话，也不能证明长期表达质量。

## 后续验收

| 工作 | 需要形成的证据 |
| --- | --- |
| 第 7 阶段真实声音 | 中文 ASR/TTS 连通、同一答语、人工试听、延迟、一次回合与播放失败恢复 |
| 第 8 阶段真实身体 | 小智固件适配后的触摸、触屏、双麦方向、地磁、屏幕和受限单轴动作；回执与实测分别记录 |
| 第 9 阶段长期观察 | 正式 1:1 时间连续 7–14 天的供给、关系、兴趣、愿望、反复行为和模型开销；据实际结果拓展地图、职业和居民 |
| 当前视觉与表达体验 | 正式浏览器的昼夜、风雨、工作灯、阶段预览/组合/回退；连续真实对话中来源与状态可读、信息完整 |

阶段顺序与后续计划见 [v0.5 路线](../research/development-roadmap-v0.5.md)，历史细节见 [第 2 阶段供给](../research/milestones/community-supply-stage2.md)、[第 3 阶段维度](../research/milestones/role-development-stage3.md)、[第 4 阶段愿望](../research/milestones/role-development-stage4.md)、[第 5 阶段试做](../research/milestones/role-development-stage5.md) 与 [第 6 阶段采用](../research/milestones/role-development-stage6.md)。
