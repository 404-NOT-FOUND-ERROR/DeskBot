# 设计定义与实现对照

**版本：** v0.2
**更新日期：** 2026-09-15

这份文件把《聚形域》的体验设计定义和软件当前实现放在同一张可审计的对照表中。设计定义是产品与论文讨论的约束；实现状态只根据仓库源码、测试和当前运行检查填写，不能把计划或旧日志当成已完成能力。

## 核心定义

| 设计定义 | 当前软件落点 | 状态与边界 |
|---|---|---|
| 聚形域是持续世界背景与演化机制，不是每句话都故弄玄虚 | `world-definition.mjs`、world context、角色提示词 | 已实现基础框架；实际表达仍由 LLM 生成，需用真实 DeepSeek 做人工验收 |
| 当前第一角色叫“喵呜”，猫型潮玩外壳只是阶段形态，不是永久身份 | canonical `protagonist`、`miaowu-expression-seed-v2`、角色圣经 | 已写入角色/世界决策文档；长期角色阶段状态机仍属 P4 |
| 喵呜是会主动选择奇幻生活方式的潮玩生命体 | `research/soul/miaowu-soul-v0.1.md`、`character-seed.mjs`、`fantasy-pull.mjs`、`role-proposals.mjs`、`prompt-composer.mjs` | Soul v0.1、幻想吸引聚合、角色提案、有限试行和活动方向的临时表达覆盖已实现；长期 role-state 与真实换壳仍未实现 |
| 功能信息必须内生于角色的日常嘴皮子，不能先中性回答再追加人设 | `prompt-composer.mjs`、`miaowu-expression-seed-v4`、角色圣经 v0.2 | 已实现融合式话语编译与禁止后台汇报规则；真实 DeepSeek 仍需人工验证连续体感 |
| 持续世界要以“今日影响 / 眼前机会 / 未解钩子”进入生活，而非只存标题摘要 | world-line canonical event、interaction policy、Web 世界线编辑器、`DESKBOT_LIVED_WORLD` | 已实现可选字段、持久化、展示、编辑和 prompt 生活切片；现存旧事件需人工追加这些字段后才有强体感 |
| 多源输入只能影响角色方向候选，不能由单句命令或角色自己的回复直接改人格、外壳或世界事实 | evidence ledger、`fantasy-pull.v0.2`、interaction policy、state engine、`/api/roles/*` | 已过滤 assistant/voice/transport/device output；历史污染提案保留审计，新候选实时按 v0.2 重算；接受方向仍不自动换壳 |
| 世界环境由世界规则和明确 mutation 改变，不由 LLM 正文直接写入 | persistent world、mutation ledger、world matches | 已实现 canonical world 和只追加 ledger；复杂世界线事件仍是后续能力 |
| 时间、天气、外部事件、用户偏好、关系事件和设备状态是不同来源 | `/api/context`、weather connector、event/evidence stores | 已有来源状态和天气连接器；外部新闻、稳定偏好、关系记忆仍未接入完整闭环 |
| 外部天气应缓存慢更新，用户明确要求“最新/实时”时才强制刷新 | weather connector TTL、`/api/connectors/weather/refresh`、聊天天气意图 | 已实现当前天气及短临/小时/每日预报缓存；实际 provider 是否可用取决于服务端 token/Host |
| 文字、屏幕和未来 TTS 必须共享同一个表达意图 | `expression-intent.mjs`、`expression_intent` / output plan、device outbox 合同 | 已有版本化意图及 text/screen/TTS consumer 字段；真实 TTS、屏幕和固件 ACK 闭环尚未验收 |
| 固件只负责采集、播放和显示，不持有世界、人格或 API key | `interaction-contract-v0.1`、WebSocket bridge、outbox | 合同和桥接已实现；真实固件由独立 agent 维护，不能据此宣称真机闭环 |

## 当前可验证状态

- Node 服务默认绑定 `127.0.0.1:4311`，Web 默认绑定 `127.0.0.1:4322`。
- 直接执行 `npm.cmd start` 时，若没有 `DESKBOT_LLM_*`，LLM 会合法地退回 `fake-llm-v0.1`；这不是 DeepSeek 失败响应。
- DeepSeek 可从 `DESKBOT_LLM_CONFIG` 指向的本地 JSON 读取；API key 不得进入源码、网页、日志或 Git。
- QWeather 只有在 `DESKBOT_WEATHER_ENABLED=true`、经纬度、有效 Host 和 `DESKBOT_WEATHER_TOKEN` 同时存在时才算 configured。SQLite 中的旧快照只是历史数据，不等于本次实时连接成功。
- Web 是服务代理和展示层；它不保存第二份世界状态，也不能替服务端补充缺失的密钥。
- `voice-sidecar` 当前是可插拔边界/基线，不等于真实 ASR/TTS 已经运行。

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
- 新验收核心是“功能是否长在角色语言里”和“世界是否以具体生活而非状态摘要出现”。

## 本轮故障记录

2026-09-11 检查时 4311/4322 均无监听进程，当前 PowerShell、用户和机器环境均没有 `DESKBOT_*` 变量。因此直接启动会使用 Fake LLM、默认 Open-Meteo 且天气 disabled。DeepSeek 本地配置文件仍存在；QWeather token 未在当前环境中发现，不能宣称天气已连接。统一启动脚本见 [`scripts/start-local.ps1`](../scripts/start-local.ps1)。
