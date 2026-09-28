# 设计定义与实现对照

**版本：** v0.6
**更新日期：** 2026-09-29

这份文件把《聚形域》的体验设计定义和软件当前实现放在同一张可审计的对照表中。设计定义是产品与论文讨论的约束；实现状态只根据仓库源码、测试和当前运行检查填写，不能把计划或旧日志当成已完成能力。

## 核心定义

| 设计定义 | 当前软件落点 | 状态与边界 |
|---|---|---|
| 聚形域是持续世界背景与演化机制，不是每句话都故弄玄虚 | `world-definition.mjs`、world context、角色提示词 | 已实现基础框架；实际表达仍由 LLM 生成，需用真实 DeepSeek 做人工验收 |
| 当前第一角色叫“喵呜”，猫型潮玩外壳只是阶段形态，不是永久身份 | canonical `protagonist`、`miaowu-expression-seed-v4`、角色 Soul/roleplay bible | 已写入角色/世界决策文档；accepted role-state 阶段档案可持久化并投影到普通表达；自动换壳仍未实现 |
| 雾灯镇是聚形域中的具体小镇，地图与内容包提供第一版生活舞台 | `DEFAULT_SETTLEMENT`、`GET /api/world/map`、`src/content-packages.mjs`、`world-content/settlements/morrowmere/` | 已实现 canonical settlement、地点归属、只读内容编译和「雾灯镇第一天」有限回放；内容包不是第二事实源，NPC 仍保持 NevaMind 式结构；更丰富的世界自动生活仍需继续扩展 |
| 喵呜是会主动选择奇幻生活方式的潮玩生命体 | `research/soul/miaowu-soul-v0.1.md`、`character-seed.mjs`、`fantasy-pull.mjs`、`role-evolution.mjs`、`role-proposals.mjs`、`prompt-composer.mjs`、`shared-life-reports.mjs` | Soul、幻想吸引聚合、角色候选/提案运行、有限试行、accepted 阶段、方向表达、显式承诺、关系趋势和可审计日报覆盖已实现；跨天主动选择和真实换壳仍未实现 |
| 功能信息必须内生于角色的日常嘴皮子，不能先中性回答再追加人设 | `prompt-composer.mjs`、`miaowu-expression-seed-v4`、角色圣经 v0.2 | 已实现融合式话语编译与禁止后台汇报规则；真实 DeepSeek 仍需人工验证连续体感 |
| 持续世界要以“今日影响 / 眼前机会 / 未解钩子”进入生活，而非只存标题摘要 | world-line canonical event、interaction policy、Web 世界线编辑器、`DESKBOT_LIVED_WORLD` | 已实现可选字段、持久化、展示、编辑和 prompt 生活切片；现存旧事件需人工追加这些字段后才有强体感 |
| 多源输入只能影响角色方向候选，不能由单句命令或角色自己的回复直接改人格、外壳或世界事实 | evidence ledger、`fantasy-pull.v0.2`、interaction policy、state engine、`/api/roles/*` | 已过滤 assistant/voice/transport/device output；历史污染提案保留审计，新候选实时按 v0.2 重算；接受方向仍不自动换壳 |
| 世界环境由世界规则和明确 mutation 改变，不由 LLM 正文直接写入 | persistent world、mutation ledger、world matches | 已实现 canonical world 和只追加 ledger；复杂世界线事件仍是后续能力 |
| NPC 能在有限生活中自主挑选下一步，但不能越过世界规则 | `npc-agent-loop.mjs`、`npc-goals.mjs`、`GET /api/life/npc-agents` | 已实现 NevaMind 风格候选/选择/执行分层；每 NPC 每逻辑槽一次、只允许相邻 hop、决策可持久化/回放；accepted 角色阶段已进入 world-life 的 `role_context` 和 Scene 选择上下文；开放式目标生成、跨天成长仍未实现 |
| 时间、天气、外部事件、用户偏好、关系事件和设备状态是不同来源 | `/api/context`、`/api/input-runtime`、`input-runtime.mjs`、weather connector、event/evidence stores | 来源分层与输入运行层已实现；天气实时/小实时/小时/每日缓存可恢复，四类天气来源独立调度，调度有 TTL、状态持久化和退避；外部新闻仍是 adapter 槽位，尚无自动抓取策略 |
| 外部天气应缓存慢更新，用户明确要求“最新/实时”时才强制刷新 | weather connector TTL、`input-runtime.mjs`、`/api/connectors/weather/refresh`、聊天天气意图 | 已实现当前天气及短临/小时/每日预报缓存、SQLite 重启恢复和后台到期检查；显式最新请求仍强制刷新；实际 provider 是否可用取决于服务端 token/Host |
| 文字、屏幕和未来 TTS 必须共享同一个表达意图 | `expression-intent.mjs`、`expression_intent` / output plan、device outbox 合同 | 已有版本化意图及 text/screen/TTS consumer 字段；真实 TTS、屏幕和固件 ACK 闭环尚未验收 |
| 固件只负责采集、播放和显示，不持有世界、人格或 API key | `interaction-contract-v0.1`、WebSocket bridge、outbox | 合同和桥接已实现；真实固件由独立 agent 维护，不能据此宣称真机闭环 |

## 当前可验证状态

### 2026-09-29 P3/P3.1 与 P4 复核

- DeskBot service 回归为 `244/244`；新增的内容包、跨日 `world-life.replay()`、NPC Agent Loop、NPC 有限目标、共同经历、记忆/承诺/日报、角色演化闭环和重启幂等均在隔离 SQLite 测试中通过。P4 验收覆盖跨来源候选到提案、显式试行到 accepted、普通对话与 Scene 上下文投影，以及 SQLite 重启恢复。Agent 决策与 goal 的绑定、重启对账、稳定探索脉冲和日志清理也有回归覆盖。
- Jev Town 客户端 `16 files / 132 tests` 通过，`npm run typecheck` 与生产 `npm run build` 通过。客户端路线定向测试覆盖 26 个用例。
- 路线视觉代码级闭环已完成：`canonicalGeometry.ts` 为当前聚形域地点提供稳定道路锚点，`routeVisual.ts` 根据服务端路径构造完整折线、分段动画、中转点和目的地标记；地点标签、喵呜/NPC 位置、路线折线、分段动画和到达提示共用同一投影。服务端仍拥有邻接、成本、阻断和 mutation 权威；未知地点保留安全的坐标 fallback，不会改变世界事实。路线版本漂移或失效时客户端会清除预览。
- 当前仍需人工验收桌面/移动端的路线观感与缩放，以及路线中转点、完整折线、到达提示和版本失效清除；记忆更正后的后续回调、承诺做到/错过/取消、日报预览/物化差异和关系趋势 evidence 的可读性也待人工验收。自动测试不等于证明长期生命感。

## 2026-09-18 NPC 与桌面潮玩叙事增量

- `npc-personas.mjs` 与 `research/npcs/*.md` 建立了“作者 Markdown -> 运行时 Persona 投影”的人物构造边界；首发 NPC 的欲望、爱憎、恐惧、口癖和触发点不再只存在于固定回复函数里。
- NPC HTTP 互动已接入 `llm.complete()`，提示词包含当前 Scene、地点、关系和最近共同经历；模型只返回台词，世界事实仍由 `npc_interaction` mutation 写入。重复互动直接重放，不二次调用模型。
- NPC Agent 有明确 fallback，因此 fake/offline 环境仍可运行，但真实 DeepSeek 人物质量仍需人工长对话验收。
- 首发地点与 Scene 已改写为桌边潮玩生活语言；客户端地图节点增加“小世界/摆件区域”语义与地点图标。此增量改善视觉和叙事方向，但还不是完整美术重制。
- 地图读模型现在稳定暴露 `toy_zone`、`prop_icon`、`material`、`signature_props`，回归测试会锁定这些字段，避免客户端退回只有抽象地点名的状态。
- 视觉 token v0.2 已同步到研究文档和游玩层样式：木桌/软垫/彩胶材质、深青灰正文、紫/珊瑚强调色、明确字号层级和 `4/8/12/18/24px` 间距；研究台与游玩层继续分离。

- Node 服务默认绑定 `127.0.0.1:4311`，Web 默认绑定 `127.0.0.1:4322`。
- 直接执行 `npm.cmd start` 时，若没有 `DESKBOT_LLM_*`，LLM 会合法地退回 `fake-llm-v0.1`；这不是 DeepSeek 失败响应。
- DeepSeek 可从 `DESKBOT_LLM_CONFIG` 指向的本地 JSON 读取；API key 不得进入源码、网页、日志或 Git。
- QWeather 只有在 `DESKBOT_WEATHER_ENABLED=true`、经纬度、有效 Host 和 `DESKBOT_WEATHER_TOKEN` 同时存在时才算 configured。SQLite 中的旧快照只是历史数据，不等于本次实时连接成功。
- Web 是服务代理和展示层；它不保存第二份世界状态，也不能替服务端补充缺失的密钥。
- `voice-sidecar` 当前是可插拔边界/基线，不等于真实 ASR/TTS 已经运行；表达意图字段已能提供给未来 TTS/屏幕消费者，但未形成真实音频和固件动作证据。

## 认知规则

1. 设计目标、计划路线和代码实现必须分别标注；“有接口”不等于“已接通”。
2. 运行状态以本次 `/health`、`/api/context`、连接器状态和真实请求为准；旧日志只作为历史证据。
3. provider、模型、天气 Host/token、数据库和进程属于部署状态，不写进角色世界或用户可见回复。
4. 任何角色演化都必须有证据、规则版本、方向候选和可回放记录；LLM 正文没有 canonical world 写权限。
5. 普通对话不暴露候选、分数、模式、阶段、试行或 overlay；研究 UI 可以读取完整审计数据。

## 2026-09-15 表达修订

- 修复 `conversation.reply` 反向强化角色方向的证据污染。
- 世界线事件新增 `daily_consequence`、`opportunity`、`unresolved_hook`，Web 可分别编辑和回看。
- prompt 分出后台审计数据与近端表演层；活动方向压成唯一第一人称生活倾向，不再把多张候选卡送给模型。
- 新验收核心是“功能是否长在角色语言里”“世界是否以具体生活而非状态摘要出现”，以及“疲惫或脆弱时是否先陪住对方，而不是变成任务管理器”。猫叫不设机械次数配额；世界询问禁止用“没有记录/不能编”的审计口吻抢走叙事。
- 2026-09-28 人格校准：新增可执行的陪伴契约与按场景检索示例；疲惫时允许一两句后停住，安排任务只给可挪动草案，变形先共同试用新生活再轻放外壳边界。DeepSeek 采样温度默认 0.55，可用 `DESKBOT_LLM_TEMPERATURE` 调整；这只改善表达变化，不代表长期关系或角色演化已验收。

## 本轮故障记录

2026-09-11 检查时 4311/4322 均无监听进程，当前 PowerShell、用户和机器环境均没有 `DESKBOT_*` 变量。因此直接启动会使用 Fake LLM、默认 Open-Meteo 且天气 disabled。DeepSeek 本地配置文件仍存在；QWeather token 未在当前环境中发现，不能宣称天气已连接。统一启动脚本见 [`scripts/start-local.ps1`](../scripts/start-local.ps1)。
