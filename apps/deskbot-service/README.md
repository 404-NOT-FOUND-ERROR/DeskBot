# DeskBot Service

本地研究服务，是最终系统唯一的输入收口、状态真相、LLM 和输出编排核心。RisuAI 只提供“文本 -> 情绪标签 -> 立绘”参考，SillyTavern 只提供“条件触发 -> prompt 选择性注入”参考；两者均为可选对照，不是运行依赖、主入口或回复来源。

当前 `v0.1.0` 包含健康检查、统一输入层、词典情绪分析、带 TTL 的世界条件匹配、短时 CAPS-inspired 状态、evidence ledger、prompt 组合、Fake/显式 OpenAI-compatible LLM、受白名单约束的小型持续世界、运行时上下文源、幂等设备 outbox、音频工件存储、语音 sidecar 边界、服务端 WebSocket bridge，以及 SQLite 启动恢复。它仍未实现长期 `role-state.v1` 演化和真实 VoCat 固件联调；语音 sidecar 当前是可替换的 fake/model-free baseline，不代表真实中文 ASR/TTS 能力。默认启动使用 Fake LLM，只有显式本地配置才会调用外部模型；DeepSeek provider 已完成本机真实 API 和完整 `/api/chat` smoke。

## 运行

需要 Node.js 24 或更高版本。

```powershell
npm start
```

浏览器访问 <http://127.0.0.1:4311/health>，应返回 `status: "ok"`。

默认使用 `4311`，因为本机的 `4310` 已由 QQ 使用。需要改端口时可设置 `DESKBOT_PORT` 环境变量。

正式启动时，服务默认把事件、短时状态、世界条件、证据、设备、聊天回合和 outbox/ACK 写入 `data/deskbot.sqlite`。可用 `DESKBOT_DB_PATH` 指向另一份 SQLite 文件：

```powershell
$env:DESKBOT_DB_PATH = 'D:\deskbot-data\deskbot.sqlite'
npm start
```

同一 `event_id` 在服务重启后仍保持幂等；已完成的聊天回合不会再次调用 LLM。SQLite 是当前“小型持续世界”的运行事实源，不等同于尚未实现的长期 `role-state.v1` 演化提交。

## 测试

```powershell
npm test
```

当前 Node 回归测试为 `118/118`，另有独立协议边界回归 `7/7`；Python sidecar 测试为 `16/16`。服务默认绑定 `127.0.0.1`；需要让局域网设备访问时可显式设置 `DESKBOT_HOST`，并先按设备合同完成网络隔离和认证配置。使用 `src/index.mjs` 正式启动时数据写入本地 SQLite；测试和直接调用 `createDeskBotServer()` 时若不注入 persistence，仍使用隔离的内存模式。默认 Fake LLM 不上传数据；启用 `DESKBOT_LLM_PROVIDER=deepseek` 或 `openai-compatible` 后，提示文本会发送到你配置的端点，密钥只从本地配置/环境变量读取，不写入响应或日志。

## 语音 sidecar

先启动仓库内的 Python sidecar（它只负责 ASR/TTS 协议，不持有 canonical world）：

```powershell
cd C:\Users\Administrator\Desktop\Jeremy\DeskBot\voice-sidecar
python -m voice_sidecar --host 127.0.0.1 --port 4321
```

再启动 Node 服务并显式指向 sidecar：

```powershell
$env:DESKBOT_VOICE_SIDECAR_URL = 'http://127.0.0.1:4321'
$env:DESKBOT_VOICE_TIMEOUT_MS = '15000' # 可选，1–120000
npm start
```

可选路径覆盖：`DESKBOT_VOICE_ASR_PATH` 和 `DESKBOT_VOICE_TTS_PATH`。Node 暴露 `GET /api/voice/health`、`GET /api/voice/capabilities`、`POST /api/voice/transcribe`、`POST /api/voice/asr`、`POST /api/voice/tts` 和 `POST /api/voice/cancel`。ASR partial/final 事件会保留为只读传输观察；只有 final 且 `clean_utterance` 非空时才生成一个聊天回合，同一 `correlation_id` 只计一次。空 final 仍入账为 observation，但不会调用 LLM。`raw_utterance` 保留 sidecar 原文，`clean_utterance` 才是送入聊天的清理文本。

TTS 音频先写入 Node 的 `/api/audio/:audio_id` 工件存储，输出命令只携带 `audio_ref`、格式、字节数和 SHA-256，不携带原始音频文本。`src/fake-device.mjs` 可用来联调 outbox；它会对 `audio.play` 工件执行同源 URL、字节数、格式、ID 和 SHA-256 校验。确定性的工件/协议错误会记录并发送 `failed` ACK，临时 HTTP/传输错误则不 ACK、保留 queued 以便重试，不会伪造已完成播放。该联调器不等同于真实固件；真实设备必须按 `DeskBotClaude\固件桥接接口合同_v0.1.md` 完成 WebSocket、半双工和 ACK 验收。

当前 sidecar 使用标准库 fake/model-free ASR/TTS：音频输入只返回明确的 `[fake-audio:...]` 标记，不能据此宣称语音识别质量或端到端延迟。真实 FunASR/Paraformer 与 sherpa-onnx/CosyVoice 等引擎需在目标机单独安装和实测。

## 输入层烟雾测试

`POST /api/chat` 是主线聊天入口，`POST /api/event` 接收时间、传感器、设备、世界条件和外部事件。两者都会被规范化为 `foundry.event.v0.1`，并用 `event_id` 去重。角色的日常回复默认是自然中文：任务先给结果或步骤，事实先给可核实答案，情绪支持先回应感受；聚形域词汇只在用户主动讨论背景、形态演变或世界事件时使用。

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4311/api/chat `
  -ContentType 'application/json' `
  -Body '{"event_id":"evt-demo-001","character_id":"shaping-001","message":"今天有点累","source":"deskbot-web"}'
```

The canonical continuous-world identity is `shaping-001`; its current role-stage
name is `喵呜`, while the persistent identity remains separate from any one role or
shell. The setting source is `聚形域世界观设定_v2.1.md`. The legacy `ember-001`
identifier remains accepted when replaying older events and device records, but new
requests should omit `character_id` or use `shaping-001`.

`GET /api/events` 可回放当前进程收到的事件，并支持 `layer`、`source_kind`、`type`、`limit` 筛选；`GET /api/evidence` 可查看证据资格、情绪分析和世界规则命中；`GET /api/world/matches` 可查看规则命中日志。`GET /api/world/schema` 返回七类输入、mutation action、元数据和不变量契约。`GET /api/world`（或 `/api/world/state`）读取 canonical 小世界快照，`GET /api/world/mutations`（或 `/api/world/ledger`）读取只追加 mutation ledger；这些接口只读。

`GET /api/context`（别名 `GET /api/connections`）返回可审计的运行时上下文。当前内置 `Asia/Shanghai` 服务器时钟为唯一 `active` 数据源；天气、外部事件和自定义连接以 `not_configured` 状态显式显示。它们是后续 provider/plugin 的接入槽，不代表网页已经能保存 URL、OAuth 或密钥。对“现在几点了”“今天几号”等问题，服务直接使用这个服务器时钟回答，不以叙事逻辑时间替代真实时间。

天气 connector v0.1 使用 Open-Meteo 的公开 current forecast 接口作为首个无密钥 provider。正式启动前可显式配置（经纬度和地点不要写入日志）：

```powershell
$env:DESKBOT_WEATHER_ENABLED = 'true'
$env:DESKBOT_WEATHER_LATITUDE = '31.2304'
$env:DESKBOT_WEATHER_LONGITUDE = '121.4737'
$env:DESKBOT_WEATHER_LOCATION = '上海'
$env:DESKBOT_WEATHER_TIMEZONE = 'Asia/Shanghai'
npm start
```

国内实时天气可切换到和风天气。官方文档的城市实时天气 v7 路径是 `GET /v7/weather/now`，使用 API 凭据和 `location=经度,纬度`；普通控制台 `API KEY` 凭据使用 `X-QW-Api-Key` 请求头，JWT 凭据才使用 `Authorization: Bearer`。官方同时标注 v7 即将弃用，推荐使用实时天气 v1，因此 `DESKBOT_WEATHER_URL` 应按账号实际 API Host 配置为 v7 或 v1 地址。密钥只放服务端环境变量，不要填入网页或日志：

```powershell
$env:DESKBOT_WEATHER_ENABLED = 'true'
$env:DESKBOT_WEATHER_PROVIDER = 'qweather'
$env:DESKBOT_WEATHER_TOKEN = '<和风天气 API KEY 原文，不要加 Bearer 前缀>'
$env:DESKBOT_WEATHER_AUTH_MODE = 'api-key'
$env:DESKBOT_WEATHER_URL = 'https://<你的 API Host>/v7/weather/now'
$env:DESKBOT_WEATHER_LATITUDE = '31.2304'
$env:DESKBOT_WEATHER_LONGITUDE = '121.4737'
$env:DESKBOT_WEATHER_LOCATION = '上海'
$env:DESKBOT_WEATHER_TIMEZONE = 'Asia/Shanghai'
npm start
```

`DESKBOT_WEATHER_URL` 也接受控制台里的裸 API Host（例如 `example.re.qweatherapi.com`），服务会按 v7 自动补成 `https://<host>/v7/weather/now`；使用 v1 时请填写包含 `/weather/v1/current` 的完整路径。

和风天气 v7 返回 `now.temp`、`now.text`、`now.humidity` 和 `now.windSpeed`（公里/小时），服务会转换为 canonical weather 的摄氏度、0–1 湿度和 m/s 风速；实时天气 v1 返回 `temperature.value`、`condition.text`、`humidity` 和 `wind.speed.value`，服务也支持该结构。`GET /api/connectors/weather` 只显示 `credential_configured` 布尔值，不显示 token。

普通控制台凭据类型为 `API KEY` 时，`DESKBOT_WEATHER_AUTH_MODE=api-key`（默认）会发送 `X-QW-Api-Key` 请求头；只有账号发放 JWT 时才使用 `DESKBOT_WEATHER_AUTH_MODE=bearer`。`query` 模式仅为兼容旧实现，会把 key 放入查询参数，不建议生产使用。

`GET /api/connectors/weather` 只返回 connector 状态、来源、时间、新鲜度和错误摘要；`POST /api/connectors/weather/refresh` 默认遵守 TTL，发送 `{ "force": true }` 才会在用户明确要求最新天气时绕过有效缓存发起一次 provider 请求。结果会作为带 `provider`、`source_kind`、`observed_at`、`fetched_at`、`ttl_ms`、`confidence` 和 `provenance` 的 `weather` mutation 写入同一事件入口。过期或失败状态可回读，旧观测不会覆盖较新的 canonical 快照。connector 不能直接生成角色回复；显著天气最多进入 `proactive_candidate`。对话中明确出现“最新/实时/刷新天气”也会走一次强制刷新，再把结果交给 LLM 自然回答。

天气预报使用独立的只读缓存，不覆盖 canonical 的当前天气观测：

- `POST /api/connectors/weather/forecast/refresh`：可传 `{ "kinds": ["minutely", "hourly", "daily"], "force": true }`；不传 `force` 时分别遵守短临 10 分钟、小时 30 分钟、每日 6 小时 TTL。
- `GET /api/connectors/weather/forecast`：读取已缓存的短临、小时和每日预报，不会发起 provider 请求。
- 和风天气 v7 会派生 `/v7/minutely/5m`、`/v7/weather/24h`、`/v7/weather/7d`；当前 v1 实时 endpoint 仍可用于实时观测，但不能自动派生预报路径，需将天气 Host 配置为 v7。
- 对话中的“短临/分钟、未来几小时、明天/每日/一周预报”会按需读取对应 kind；这类预报进入提示词作为环境材料，不会被角色逐字播报，也不会把预测当成已经发生的事实。
- 可用环境变量覆盖预报 TTL：`DESKBOT_WEATHER_MINUTELY_TTL_MS`、`DESKBOT_WEATHER_HOURLY_TTL_MS`、`DESKBOT_WEATHER_DAILY_TTL_MS`。密钥仍只从服务端环境变量读取。

`interaction-policy.v0.1` 是多源输入进入角色表达前的情境决策层。它把每个规范化事件分为四条路由：`reply_context`（进入当前用户回合）、`proactive_candidate`（可在自然相关时提起，但不会自动打断）、`record_only`（只记录）和 `suppress`（助手输出/语音传输仅作审计，不能再次驱动角色）。世界线、外部事件和显著天气默认只能产生主动候选；设备状态、日历推进和未稳定的用户偏好只记录。`GET /api/interaction/decisions` 可按 `character_id`、`route` 和 `limit` 回读决策及其理由、候选、TTL 和冷却时间。候选会在聊天编排时以 `[DESKBOT_INTERACTION_DECISION]` 上下文提供给 LLM；没有自然关联时必须保持安静，不能把候选当成通知清单。

`POST /api/devices/hello` 注册设备的硬件、固件和能力清单；`GET /api/devices` 查看最近上线设备。`GET /api/outbox` 可领取待执行的 `foundry.device-command.v0.1`，`GET /api/outbox/:command_id` 查看单条命令，`POST /api/outbox/:command_id/ack` 提交 `completed` 或 `failed`。命令 ID 由源事件和动作稳定生成，重复 ACK 返回原结果；正式运行时这些记录会跨服务重启恢复。服务端 bridge 默认监听同一 HTTP 端口的 `ws://127.0.0.1:4311/ws`，执行 `device.hello`、格式协商、设备事件、DBA1 音频帧和命令 ACK；协议字段以 `DeskBotClaude\固件桥接接口合同_v0.1.md` 为准。长期 `role-state.v1` 提交仍是后续工作。

`src/fake-device.mjs` 提供无硬件联调器：`hello()`、`pollOnce()` 和 `executed()` 对应设备职责的最小模拟；`test/app-websocket.test.mjs` 覆盖服务端 bridge 的应用级链路，另已用独立 `src/index.mjs` 进程完成一次 HTTP + WebSocket smoke。它们只模拟或验证服务端，不代表真实固件已经接入。

`GET /api/state/:character_id` 返回当前短时状态和可注入 DeskBot LLM 的 `[DESKBOT_STATE]` 上下文。该上下文是临时交互状态，不是 `role-state.v1` 的长期提交。

## P3 研究会话采集

P3 使用研究会话把真实聊天回合和固定 L1b 探针组合成可回读的采集单元。会话只保存元数据、回合引用和探针 observation ID；原始输入/回复仍由既有 chat ledger 与 probe observation ledger 保存，不会写入 canonical world，也不会自动改变角色状态。

```powershell
$session = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4311/api/research/sessions `
  -ContentType 'application/json' `
  -Body '{"session_id":"p3-001","label":"四类表达首轮","scenario_id":"p3-real-multiturn-v0.1"}'

# 先通过 /api/chat 完成一轮，再把返回的 turn_id 挂入固定类别
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4311/api/research/sessions/p3-001/turns `
  -ContentType 'application/json' -Body '{"turn_id":"<chat-turn-id>","category":"emotion_support"}'

# P4/P6 探针通过 /api/research/probe-observations 记录后再挂入会话
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4311/api/research/sessions/p3-001/probes `
  -ContentType 'application/json' -Body '{"observation_id":"<probe-observation-id>"}'

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4311/api/research/sessions/p3-001/complete `
  -ContentType 'application/json' -Body '{}'
```

固定类别为 `direct_task`、`fact_qa`、`emotion_support`、`world_discussion` 和 `probe`。会话完成后通过 `GET /api/research/sessions/:session_id` 回读，列表通过 `GET /api/research/sessions` 获取；契约见 `GET /api/research/session-contract`。
