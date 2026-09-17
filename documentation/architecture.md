# DeskBot 软件架构

DeskBot 是一个绑定本机回环地址的小型持续世界服务。Node `deskbot-service` 是唯一的 canonical world、事件、短状态、证据、LLM 回合和设备 outbox 状态源；Web 只展示并调用它；Python voice-sidecar 只提供无状态 ASR/TTS 边界；ESP-VoCat 通过版本化协议接入。

## 运行结构

```text
Web / 固件 / RisuAI 对照适配器
          |
          v
Node deskbot-service :4311
  input -> world/state/evidence -> prompt -> LLM
  canonical world    -> derived map -> validated travel mutation
  weather connector  -> canonical mutation
  output router      -> idempotent device outbox
  WebSocket /ws      -> device hello, audio, ACK
          |
          +--> SQLite WAL (唯一持久状态)
          +--> DeepSeek / OpenAI-compatible provider
          +--> QWeather (可选、服务端凭据)
          +--> Python voice-sidecar (可选、无状态)
```

技术栈：Node.js 24+、内置 `node:sqlite`、HTTP/自实现受限 WebSocket bridge、原生静态 Web、Python 3.10+ 标准库 sidecar。默认服务绑定 `127.0.0.1`；`DESKBOT_HOST` 或 `DESKBOT_WEB_HOST` 改成局域网地址前必须先补认证、设备认证和网络隔离。

## 信任边界

- 浏览器/固件 -> Node：输入是不可信事件；服务端做 schema、大小、幂等、设备绑定和世界 mutation 校验。
- Node -> LLM：提示文本和允许的上下文会离开本机；API key 只从服务端本地配置/环境变量读取。
- Node -> 天气 provider：只发送位置、查询和服务端 header；token 不进入网页、事件或日志。
- Node -> voice-sidecar：文本/音频通过本地 HTTP 发送；sidecar 不拥有世界写权限。
- Node -> 设备：只发送白名单命令和版本化状态；设备回 ACK，不能直接写角色 trait 或 canonical world。
- SQLite：应用服务可写，Web 不直接访问文件；WAL 文件属于运行数据，不提交 Git。

## 已知风险 / 假设

- 当前没有用户认证、会话、设备密钥或速率限制；只适合本机研究，不适合直接暴露公网或未经隔离的局域网。
- Web 代理响应头目前允许 `access-control-allow-origin: *`；在非回环部署前应收窄来源。
- DeepSeek 出站可用性取决于运行 PowerShell/网络策略。聊天上游失败会返回结构化 `502`：`llm_transport_error` 表示没有收到 provider 响应，`llm_http_error` 表示收到 HTTP 错误；响应只包含错误码、可重试性和安全的 provider 状态，不回显响应体或密钥。
- `scripts/start-local.ps1` 启动前检查端口，启动后要求本次 PID 持有监听端口并通过 `/health`；旧进程不能作为新代码的验收证据。
- 天气 connector 的实时观测与 minutely/hourly/daily 预报使用独立缓存和 TTL。未显式加载 `DESKBOT_WEATHER_*` 时，当前状态是 disabled；历史 SQLite 快照不等于 provider 当前可用。
- DeepSeek 出站可用性取决于运行 PowerShell/网络策略；`fetch failed` 不代表角色规则失败。
- 当前 voice-sidecar 是 fake/model-free baseline，不代表真实中文 ASR/TTS 性能。
- 角色演化的 fantasy-pull、提案和有限试行已在 P2-P4 接入；当前仍不是长期 `role-state.v1`，也不会自动换壳。

## 持续世界地图与旅行

地图不是第二套世界状态。`persistent-world` 保存地点、坐标、邻接路线、路程、NPC 位置和喵呜当前位置；`GET /api/world/map` 每次从这份 canonical snapshot 派生一个只读地图模型。Web 只负责绘制与选择，不拥有地点、路线或旅行结果。

`POST /api/world/travel` 会把出发请求转换成标准 `world.mutation / move_protagonist`，再走现有 input、world、evidence 和 ledger 管线。服务端校验：目的地存在、与当前位置相邻、当前世界事件没有阻断旅行、事件 ID 幂等。成功后一次性写入当前位置、抵达状态和旅行耗时；失败不改地点和逻辑时间。LLM 回复仍是只读输出，文本里声称“去了某地”不能移动角色。

当前 P1 地图只有五个固定地点，是为了验证第一人称旅行与世界空间感，不是完整开放世界。下一步应由世界事件/NPC 计划改变地点的可见状态、在地生活切片和可用行动；不要把静态地点说明无限堆进 prompt，也不要让用户点击直接重写地图规则。

## 世界体验客户端与叙事分层

默认客户端采用“世界优先”布局：地图是全屏背景；左上浮窗承载喵呜的第一人称故事和对话；底部输入框始终可达；地点、角色状态、世界事件、天气、形态与现实输入通过游戏化工具栏按需展开。研究台、原始字段、mutation 和证据仍在第二层，不能挤占普通用户的第一屏。

叙事上下文按 Character.AI 类方法拆成三层，但仍服从 DeskBot canonical state：

- Character / Soul：长期始终相关的动机、爱憎、声音、习惯和行为边界，每轮都约束表达。
- Lorebook：地点、NPC、物品、派系和世界规则等“有时相关”的资料；按当前位置、话题或事件键检索，不把整本设定塞入每轮 prompt。
- Scene：此刻的地点、可观察动作、感官线索、参与者、限制与自然出现的选择。Scene 描述处境，不替喵呜规定情绪或决定。

地点 `scene.possible_beats` 只是尚未发生的场景机会。只有经过 world mutation 的结果才可被叙述为既成事实；这样既保留 Character.AI 式即兴沉浸，也保持 WorldOS 式世界状态可追溯和可联动。

设计方法来源（用于结构原则，不复制其角色或世界素材）：

- Character.AI Lorebooks：https://support.character.ai/hc/en-us/articles/52739596326811-Lorebooks
- Character.AI Scene Creation：https://support.character.ai/hc/en-us/articles/41918454359451-Scene-Creation-Quickstart-Guide
- Character.AI Creator Guide：https://support.character.ai/hc/en-us/articles/50608794517915-1-Welcome-to-the-Creator-Guide

对应关系是：Creator Guide 约束长期 Character/Soul，Lorebooks 指导按相关性检索地点与世界知识，Scene 指导“此时、此地、可观察事实和自然选择”的构造。三者都只进入叙事上下文；世界事实仍由 canonical mutation 决定。

## Related Documents

- `documentation/flows.md`：关键数据流和副作用顺序。
- `documentation/permissions.md`：当前权限模型与上线前缺口。
- `documentation/variables.md`：配置、密钥和作用域。
- `documentation/automation.md`：LLM、天气、语音和设备自动化边界。
- `documentation/tests.md`：已有覆盖、计划测试和缺口。
- `research/聚形域-角色与世界决策记录_2026-09-09.md`：角色与世界设计决策。
- `research/development-roadmap-v0.3.md`：P1-P8 开发路线。
- `research/protocol/interaction-contract-v0.1.md`：固件桥接合同。
