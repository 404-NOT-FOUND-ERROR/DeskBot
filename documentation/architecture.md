# DeskBot 软件架构

DeskBot 是一个绑定本机回环地址的小型持续世界服务。Node `deskbot-service` 是唯一的 canonical world、事件、短状态、证据、LLM 回合和设备 outbox 状态源；Web 只展示并调用它；Python voice-sidecar 只提供无状态 ASR/TTS 边界；ESP-VoCat 通过版本化协议接入。

## 运行结构

```text
DeskBot Web / Jev Town 3D client / 固件 / RisuAI 对照适配器
          |
          v
Node deskbot-service :4311
  input -> world/state/evidence -> prompt -> LLM
  input-runtime      -> source schedule/retry/cache recovery
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

`apps/jev-town-client` 是基于 CeciliaW888/jev-town 的独立 React/Three.js 投影客户端。它读取 `/api/world/map` 和 `/api/life/world`，并只通过标准事件入口提交 NPC 行动；地图 revision、合法移动、SQLite 和 mutation ledger 仍由 `deskbot-service` 管理。来源、授权记录和发布清单见 `documentation/jev-town-adoption.md`。

### 雾灯镇内容基线

雾灯镇（Morrowmere）是聚形域中的一个具体聚落，不替代聚形域世界观，也不创建第二个运行时世界。`world-content/settlements/morrowmere/` 是可评审的内容合同：它把聚落、地点 Lore key、Scene 起点、NPC 作者字段、有限日程和世界事件模板放在一起；运行时仍只读取/写入 `deskbot-service` 的 canonical world。内容包里的 `opportunity`、事件模板和日程路线都是候选或作者意图，必须经过 world-life 调度器和白名单 mutation 才能成为事实。

`src/content-packages.mjs` 是作者内容到运行时的只读编译层。它在加载时校验聚落/setting 归属、地点是否覆盖 canonical map、NPC 的 NevaMind 字段、日程路线、故事包版本和世界事件模板，并输出带 `source` 的编译对象；它不写 SQLite，也不允许客户端直接把 JSON 当成世界状态。`story-packages.mjs` 使用该编译结果生成有限故事计划，因此“雾灯镇第一天”可以回放，但每一步仍须通过 `shared-life`、`persistent-world` 和 mutation ledger 执行。

首版 NPC 继续采用 NevaMind 式结构化代理边界：身份、角色、欲望、日程、条件、状态与合法行动。它是作者层和运行时 Persona 的输入，不允许客户端、LLM 台词或内容包直接改写位置、关系、世界事件或喵呜的角色阶段。这样可以先复用 Jev Town 的中性小镇舞台，再逐步把聚形域的多源输入、世界线和角色选择接到同一个可审计的生活循环里。

## 信任边界

- 浏览器/固件 -> Node：输入是不可信事件；服务端做 schema、大小、幂等、设备绑定和世界 mutation 校验。
- Node -> LLM：提示文本和允许的上下文会离开本机；API key 只从服务端本地配置/环境变量读取。
- Node -> 天气 provider：只发送位置、查询和服务端 header；token 不进入网页、事件或日志。
- Node -> voice-sidecar：文本/音频通过本地 HTTP 发送；sidecar 不拥有世界写权限。
- Node -> 设备：只发送白名单命令和版本化状态；设备回 ACK，不能直接写角色 trait 或 canonical world。
- SQLite：应用服务可写，Web 不直接访问文件；WAL 文件属于运行数据，不提交 Git。

### P4-1 多源输入运行层

`input-runtime.mjs` 是 provider 采集和 canonical world 之间的运行层。它维护来源注册表、到期判断、成功/失败状态、指数退避和 `input-runtime.sources` 持久化；当前服务启动时注册天气实时观测，以及小实时、小时、每日三个相互独立的天气预报缓存来源，并通过 `GET /api/input-runtime` 暴露安全状态。默认每 5 分钟检查一次，实际请求仍由各 connector 的 TTL 决定；某一种预报失败不会拖垮其他预报或世界生活调度。

天气 connector 的实时快照和 minutely/hourly/daily 预报现在写入 SQLite `connector.weather/state`，进程重启可恢复缓存、时间、新鲜度和错误摘要。token 不进入状态、事件或日志。实时天气成功后仍必须由 `ingestNonChatEvent()` 进入 `input-store -> persistent-world`；预报来源只更新 connector 缓存，不覆盖 canonical 当前天气。重复事件依靠既有 event ID 幂等，旧观测仍只进入审计而不覆盖较新的世界快照。

输入运行层可以注册新闻、日历、设备等后续 adapter，但本阶段不把 observation 自动解释为世界事件；后续 provider 必须先规范化来源、时间、可信度和 provenance，再通过统一事件入口，P4-2 才负责把证据聚合成世界线候选或合法 mutation。

### P4-2 角色方向演化闭环

`role-evolution.mjs` 从已持久化且符合资格的多源事件中调用 `fantasy-pull.v0.3`，保存候选、运行记录和冷却状态；达到候选阈值时自动创建一条 `proposed` 提案。HTTP 事件入口、成功的用户聊天回合、服务启动和每分钟调度都会触发幂等同步。同步接口 `GET /api/roles/evolution` 提供候选、运行、提案、活动试行和 accepted 阶段；`POST /api/roles/evolution/sync` 返回本次新建的 `created` 列表。相同证据指纹会复用已有运行记录，不重复建提案；聊天重试和重复 event ID 不重复计入试行观察。

角色状态仍由 `role-proposals.mjs` 管理：候选只生成提案，用户必须明确选择 `try`，试行窗口完成后再明确接受、拒绝或延后。accepted 阶段通过普通提示词、`expression_intent` 和 `world-life` 的 Scene 决策上下文产生有限表达/生活倾向；`GET /api/life/world` 兼容保留 `role_stages`，并提供 `role_context.current_stage/stages`。该投影不是新的世界写权限：角色台词不能直接变更 canonical world，角色阶段也不会自动修改 Soul 或外壳。

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

`world-life.mjs` 是 canonical world 之上的有限、确定、可回放调度器，不是第二个世界状态源。正式服务启动时播种有档案的首发 NPC，并立即生成当前地点 Scene；之后每分钟检查世界时间，NPC 行动以作者定义的 120 分钟逻辑槽调度。Scene 选择只读取当前位置、逻辑时间段、最新世界线和天气，结果必须通过 `set_life_scene` mutation 写回 canonical world。相同事件跨槽时使用 `continue_life_scene` 延长同一个 Scene，不重复制造旁白；同地点最近两个模板进入冷却，只有时段约束没有可用替代时才继续当前事件。当前 Scene、最近 12 个已结束 Scene、NPC 当前行动、共同经历和互动关系都能在 SQLite 重启后恢复。

首版用户与 NPC 的互动只开放 `observe/greet/chat/suggest/help/invite` 六种意图。`suggest` 可以携带最多 500 字想法，但服务端决定 NPC 的回应；NPC 必须与喵呜同地，远方 NPC 不能互动。每次互动带幂等 ID，通过 `npc_interaction` mutation 增加有限的熟悉度、信任和相遇次数，并在 `life.recent_experiences` 留下一条可归因共同经历。`suggest/help/invite` 可附带由 NPC 身份规则决定的低置信角色方向提示；它只进入多源证据聚合的 `observing` 阶段，仍需跨来源、重复证据才能成为候选，不能直接修改 Soul、身份或外壳。

NPC 自动日程与作者目标共用 `npc-goals.mjs`。目标备选行动可带 `location_id`，但 canonical world 强制 NPC 每次只能走一个相邻地点；世界生活引擎每两小时最多为内置 NPC 安排一个有限日程，手工创建且尚未结束的目标优先。目标决策先持久化再执行，NPC 抵达或离开会改变同地点 encounters 和 Scene 参与者；用户对话、LLM 文本和人物面板按钮都不能直接移动 NPC。

### NevaMind 风格 NPC Agent Loop（v0.1）

`npc-agent-loop.mjs` 是日程与 NPC 行动之间的决策层：每个 NPC 每个逻辑两小时槽只生成一次决策，先从作者路线、当前地点邻接点、Scene 动作和原地观察中构造候选，再按优先级和稳定哈希选择一个候选。路线目标可以跨多个地点，但 Agent 只会取通往目标的一个相邻 hop；因此它借鉴 NevaMind 的“感知/候选/选择/执行”分层，同时不引入第二套世界事实。

决策记录写入 `life.npc-agent-decisions`，包含合法候选、选中动作、世界 revision、`planned/executed/failed` 状态、`selection_mode`、关联 goal ID 和执行事件 ID。决策日志保留最近 120 条，清理会同步删除 SQLite 记录。实际写入仍由 `npc-goals` 调度，并最终通过 `persistent-world.ingest()` 的白名单 `npc_action` mutation 验证；LLM 或外部 `decisionProvider` 只能返回候选 ID，非法返回会回退到确定性策略，不能移动 NPC 或写世界。无作者路线命中时，Agent 以低频稳定哈希脉冲从已验证的相邻地点中挑选一次探索；它不能生成传送、跨越邻接图或绕过 goal 验证。

创建 goal 后，决策会保存 `goal_id`；每次 goal tick 结束后统一 reconcile 持久化 goal。服务在“决策已保存、目标尚未执行”阶段中断并重启时，会先由 `npc-goals` 执行 canonical mutation，再把决策恢复为 `executed/failed`，避免 Agent 日志与世界事实分叉。

`GET /api/life/npc-agents` 是只读观测接口，可按 `npc_id` 和 `limit` 查看最近决策。旧的 `world-life-routine:*` 目标 ID 和 replay 语义保持兼容。当前版本仍是有限、可回放的 Agent Loop：没有自主生成无限目标、没有跨天人格成长，也不会因为一次选择自动改变聚形域、角色阶段或外壳。

`GET /api/life/world` 是只读相遇视图，不会因为刷新网页推进世界；`POST /api/life/npc-interactions` 是唯一普通用户 NPC 互动入口。Web 在故事窗显示已发生 Scene，在“可以试试”前明确保留未发生语义；同地点 NPC 通过横排入口和人物面板出现，首次相遇每个浏览器会话只自动呼出一次。NPC 回应使用独立署名进入故事流，不伪装成喵呜发言。

`GET /api/life/content-packages` 只暴露已编译内容包目录，浏览器不读取作者 JSON 文件。

### 真实墙钟与逻辑世界时间

canonical world 的 `logical_time` 仍是唯一可回放的世界时间；它不直接被浏览器时钟或 LLM 文本改写。使用 SQLite 持久化运行时，`persistent-world` 会在服务监听时和每分钟调度时读取服务端墙钟，并把已完成的整分钟转换为白名单 `advance_time` mutation。首次启动只建立 `canonical-world.wall-clock` 锚点，不凭空推进第一天；每次追赶最多处理 120 分钟，剩余区间在下次调度继续，秒级余数保留在 marker 中。

墙钟同步采用 marker-first 的可恢复步骤：先持久化待执行区间，再用稳定的 `world-clock:<world>:<from-ms>:<to-ms>` event ID 写入 canonical state/ledger，最后推进 marker。进程在第二步或第三步中断时，重启会重放同一 event 并依靠世界 mutation 幂等性避免重复推进。墙钟倒退不会回拨世界；没有 persistence 的单元测试/内存实例关闭该同步，以保持确定性。墙钟只负责时间推进，NPC 日程、Scene、关系和候选方向仍由各自调度器读取 canonical mutation，不能借墙钟绕过世界规则。

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
