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
  world-life engine  -> timed Scene + bounded NPC actions
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
- 角色演化的 fantasy-pull、提案、有限试行和 accepted `role-state.v1` 阶段档案已在 P2-P4 接入。accepted 阶段会进入普通对话的生活倾向和 `expression-intent.v1`，但仍不会自动换壳；外壳变化要等独立的视觉语义、机械约束和用户确认闭环。

## 持续世界地图与旅行

地图不是第二套世界状态。`persistent-world` 保存地点、坐标、邻接路线、路程、NPC 位置和喵呜当前位置；`GET /api/world/map` 每次从这份 canonical snapshot 派生一个只读地图模型。Web 只负责绘制与选择，不拥有地点、路线或旅行结果。

`POST /api/world/travel` 会把出发请求转换成标准 `world.mutation / move_protagonist`，再走现有 input、world、evidence 和 ledger 管线。服务端校验：目的地存在、与当前位置相邻、当前世界事件没有阻断旅行、事件 ID 幂等。成功后一次性写入当前位置、抵达状态和旅行耗时；失败不改地点和逻辑时间。LLM 回复仍是只读输出，文本里声称“去了某地”不能移动角色。

当前地图只有五个固定地点，是为了验证第一人称旅行与世界空间感，不是完整开放世界。每个地点同时有摆件区域、材质、代表性物件、可见动作和可继续选择；这些字段既供地图读模型做视觉语义，也供 Lorebook/Scene 只按相关性召回。世界生活 V1 已让世界事件、天气、逻辑时间段和当前位置从有限目录中选择在地生活切片，并让同地 NPC 留下当前行动；不要把静态地点说明无限堆进 prompt，也不要让用户点击直接重写地图规则。

## 世界自动生活与 NPC 相遇

`world-life.mjs` 是 canonical world 之上的有限、确定、可回放调度器，不是第二个世界状态源。正式服务启动时播种有档案的首发 NPC，并立即生成当前地点 Scene；之后每分钟检查，默认以 30 分钟真实时间槽选择生活片段。Scene 选择只读取当前位置、逻辑时间段、最新世界线和天气，结果必须通过 `set_life_scene` mutation 写回 canonical world。相同事件跨槽时使用 `continue_life_scene` 延长同一个 Scene，不重复制造旁白；同地点最近两个模板进入冷却，只有时段约束没有可用替代时才继续当前事件。当前 Scene、最近 12 个已结束 Scene、NPC 当前行动、共同经历和互动关系都能在 SQLite 重启后恢复。

首版用户与 NPC 的互动只开放 `observe/greet/suggest/help/invite` 五种意图。`suggest` 可以携带最多 500 字想法，但服务端决定 NPC 的回应；NPC 必须与喵呜同地，远方 NPC 不能互动。每次互动带幂等 ID，通过 `npc_interaction` mutation 增加有限的熟悉度、信任和相遇次数，并在 `life.recent_experiences` 留下一条可归因共同经历。`suggest/help/invite` 可附带由 NPC 身份规则决定的低置信角色方向提示；它只进入多源证据聚合的 `observing` 阶段，仍需跨来源、重复证据才能成为候选，不能直接修改 Soul、身份或外壳。

NPC 自动日程与作者目标共用 `npc-goals.mjs`。目标备选行动可带 `location_id`，但 canonical world 强制 NPC 每次只能走一个相邻地点；世界生活引擎每两小时最多为内置 NPC 安排一个有限日程，手工创建且尚未结束的目标优先。目标决策先持久化再执行，NPC 抵达或离开会改变同地点 encounters 和 Scene 参与者；用户对话、LLM 文本和人物面板按钮都不能直接移动 NPC。

`GET /api/life/world` 是只读相遇视图，不会因为刷新网页推进世界；`POST /api/life/npc-interactions` 是唯一普通用户 NPC 互动入口。Web 在故事窗显示已发生 Scene，在“可以试试”前明确保留未发生语义；同地点 NPC 通过横排入口和人物面板出现，首次相遇每个浏览器会话只自动呼出一次。NPC 回应使用独立署名进入故事流，不伪装成喵呜发言。

这一版仍不是开放式自主世界：Scene 来自每地点三条有限模板，当前有三个内置 NPC，NPC 回应和两小时日程由有限角色规则确定。因果分支现在通过 `arc_id + outcome/status + cause_event_ids/cause_experience_ids` 选择 authored Scene；消费过的因果分支不会重复生成，普通地点生活仍作为 fallback。`npc-goals` 同时兼容旧的 ordered alternatives 与 `steps-v1`：多步目标每次 tick 最多推进一步，状态可为 `waiting/completed/missed/failed`，每一步持久化 `decision`、`step_history`、等待条件、截止时间和可选 missed/failed 反馈事件；NPC 移动仍由 canonical world 强制相邻跳转。自动经历不进入 `life.memories`，而从 `GET /api/life/experiences?query=` 和 `branchExperiences` 只读检索，提示词明确区分用户确认记忆与世界生活痕迹。当前已具备 accepted role-state 的普通表达投影，但仍缺跨天主动性校准、更多有关系的 NPC 族群、角色阶段对世界行动的稳定影响和角色方向到外壳的真实生成；这些不能用有限规则或一次好看的回复冒充完成。

### NPC Persona Agent（v0.1）

首发 NPC 现在有独立作者卡：`research/npcs/*.md` 是可读、可评审的创作层，`src/npc-personas.mjs` 是经过校验的运行时投影。人物卡不只描述职业，还固定了欲望、喜欢、厌恶、恐惧、关系、口癖、触发点、行为边界和示例台词。`POST /api/life/npc-interactions` 会把 Persona、当前地点、当前 Scene、关系和最近共同经历交给 LLM；LLM 只生成 NPC 当面说的正文，不能写 canonical world、移动 NPC、改天气、换外壳或改变人格。正文随后作为 `npc_interaction` mutation 的 `response` 保存，关系和共同经历仍由 Node 规则更新。

NPC Agent 是可降级的：未注册 Persona、无 LLM 或 provider 异常时使用 authored fallback；同一 `interaction_id` 直接重放已有回复，不重复调用模型或增加关系。它提升的是人物表演和沉浸感，不等于已经实现开放式自主 NPC；地点日程、世界后果和角色阶段仍由 Node 的白名单 mutation 控制。

NPC 当面回复采用统一可读性合同：默认 `60-180` 个中文字符、`1-2` 个短段落，允许“一句具体动作描写 + 当面对白”，但必须同时包含直接回应、一个眼前物件或动作、人物自己的判断和一个可接住的小选择。过短、过长、超过两段、客服式、连续抽象设定或缺少上述要素的首稿会触发一次 grounding rewrite；二稿仍不合格则丢弃模型草稿并使用 authored fallback。长度约束服务于日常互动，不截断事实型长任务；NPC 世界写权限始终不变。

## 世界体验客户端与叙事分层

默认客户端采用“世界优先”布局：地图是全屏背景；左上浮窗承载喵呜的第一人称故事和对话；底部输入框始终可达；地点、角色状态、世界事件、天气、形态与现实输入通过游戏化工具栏按需展开。研究台、原始字段、mutation 和证据仍在第二层，不能挤占普通用户的第一屏。

视觉和文案的当前约束是“桌面潮玩生活”，不是抽象世界观控制台：地点表现为桌面上的小屋、湿路标、会自己挪位的摊位、旧光林地和保管悄悄话的水岸；Scene 写具体小动作、物件和欲望，聚形域规则不作为用户需要理解的说明。地图读模型提供 `prop_icon`，Web 将五类地点分别画成小屋、路标、摊位、叶丛和水盘，仍保留当前/可达/远方三种状态及抵达反馈；移动端 NPC 卡改为底部抽屉，研究字段仍只在研究模式出现。

视觉 token v0.2 已固定为可执行的实现约束：背景采用木桌/软垫/半透明彩胶的暖色底，正文保持深青灰高对比，紫色和珊瑚色只作方向或关系强调；标题、正文、辅助信息和 HUD 使用明确字号层级；间距统一采用 `4/8/12/18/24px`；游玩层卡片保持轻边框、低阴影、8px 左右圆角，研究层才允许更密集的网格和等宽字段。每个地点至少要有一个摆件语义、一个具体动作和一个可继续选择；“光粒、能量、凝聚”等抽象词不能单独承担世界表达。完整 token 见 `research/visual-language-v0.1.md`。

叙事上下文按 Character.AI 类方法拆成三层，但仍服从 DeskBot canonical state：

- Character / Soul：长期始终相关的动机、爱憎、声音、习惯和行为边界，每轮都约束表达。
- Lorebook：地点、NPC、物品、派系和世界规则等“有时相关”的资料；按当前位置、话题或事件键检索，不把整本设定塞入每轮 prompt。
- Scene：此刻的地点、可观察动作、感官线索、参与者、限制与自然出现的选择。Scene 描述处境，不替喵呜规定情绪或决定。

地点 `scene.possible_beats` 和生活 Scene 的 `opportunity` 只是尚未发生的场景机会。只有经过 world mutation 的结果才可被叙述为既成事实；这样既保留 Character.AI 式即兴沉浸，也保持 WorldOS 式世界状态可追溯和可联动。

设计方法来源（用于结构原则，不复制其角色或世界素材）：

- Character.AI Lorebooks：https://support.character.ai/hc/en-us/articles/52739596326811-Lorebooks
- Character.AI Scene Creation：https://support.character.ai/hc/en-us/articles/41918454359451-Scene-Creation-Quickstart-Guide
- Character.AI Creator Guide：https://support.character.ai/hc/en-us/articles/50608794517915-1-Welcome-to-the-Creator-Guide

对应关系是：Creator Guide 约束长期 Character/Soul，Lorebooks 指导按相关性检索地点与世界知识，Scene 指导“此时、此地、可观察事实和自然选择”的构造。三者都只进入叙事上下文；世界事实仍由 canonical mutation 决定。

## Related Documents

- `research/visual-language-v0.1.md`：桌面潮玩、Marathon/GCORE/CSRC 信息设计与 Character.AI/Labubu 方法的迁移边界。

- `documentation/flows.md`：关键数据流和副作用顺序。
- `documentation/permissions.md`：当前权限模型与上线前缺口。
- `documentation/variables.md`：配置、密钥和作用域。
- `documentation/automation.md`：LLM、天气、语音和设备自动化边界。
- `documentation/tests.md`：已有覆盖、计划测试和缺口。
- `research/聚形域-角色与世界决策记录_2026-09-09.md`：角色与世界设计决策。
- `research/development-roadmap-v0.3.md`：P1-P8 开发路线。
- `research/protocol/interaction-contract-v0.1.md`：固件桥接合同。
