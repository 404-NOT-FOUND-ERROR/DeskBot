# 当前验证与实验

**当前功能基线：v0.5 · 角色发展第 6 阶段，2026-10-07。** 本文件介绍现版本已验证的规则和实际边界。各阶段历史数字与运行日志保存在验收记录中，不作为当前部署状态。

## 最近完成的检查

| 范围 | 已完成结果 | 能说明什么 |
| --- | --- | --- |
| DeskBot 服务完整回归 | 652 项通过（2026-10-08 本机复验） | 世界、存档、资源、生活、来源、记忆、角色发展、设备与接口规则的回归基线 |
| 第 6 阶段最终专项复核 | 37 项通过 | 最终组合答语、重试边界、实际制作与送架、原自主生活接入；这是补充复核，不另报未经全量重跑的总数 |
| 3D 客户端 | 39 套、259 项通过 | 读模型、控制、样本、场景和组合几何；不替代浏览器像素检查 |
| 前端类型与生产构建 | 均通过 | 类型一致性和可构建性 |
| voice-sidecar 接口 | 16 项通过（2026-10-08 本机复验） | 无真实模型的 ASR/TTS 协议与失败边界；不代表中文识别或合成已接通 |
| SQLite 阶段实验 | 九种隔离样本，重启前后完整世界一致 | 原任务和配方产生的实际成果能支持预览、采用、组合和按轴回退 |
| DeepSeek Flash 有限状态样本 | 三种公开虚构摘要真实调用通过 | 明确区分未采用、已采用、形态回退而职业继续；不代表所有连续聊天或真实语音均已验收 |

完整证据与条件见 [第 6 阶段验收](../research/milestones/role-development-stage6.md)。2026-10-08 在 Windows 工作站重新运行服务端 652 项、客户端 39 套 259 项、类型检查、生产构建和 voice-sidecar 16 项，全部通过。三组旧研究界面测试在提取源码函数前统一 CRLF/LF，未改变生产逻辑；原第 6 阶段 649 项与 37 项专项仍保留为历史验收快照。

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
