# 自动化与模型边界

## DeskBot LLM 编排

- **触发：** 用户 `POST /api/chat`、最终 ASR 或设备回合；默认不主动打断。
- **所有者：** Node `chat-orchestrator`。
- **可读输入：** 当前用户事件、有限最近对话、canonical world、短状态、情境决策、天气/预报快照、角色种子和角色档案。
- **可调用 API：** 配置的 OpenAI-compatible `/chat/completions`；无 tool-calling 权限。
- **硬约束：** LLM 只能返回文本/trace；不能直接写 SQLite world、role-state、shell 或设备身份。
- **应用副作用：** 服务验证回复、写 assistant audit event、生成 output plan/outbox；失败不写假动作。
- **控制：** event/correlation 幂等、prompt 版本、结构化 provider 错误和事件审计。当前无 token 级速率限制和人工审批。

## 天气 connector

- **触发：** TTL 到期的读取、用户明确最新/预报请求或显式 refresh API。
- **可读/可写：** 读取服务端天气配置和缓存；成功的当前观测通过 canonical mutation 写入世界，预报只写独立缓存。
- **外部 API：** QWeather v7/v1，认证 header 只在服务端组装。
- **硬约束：** 字段范围、观测时间单调、TTL、provider code 和 token 不泄露。
- **控制：** 当前观测 30 分钟默认 TTL，短临/小时/每日分别缓存；失败保留旧快照。

## Voice sidecar

- **触发：** 配置 `DESKBOT_VOICE_SIDECAR_URL` 后由 Node 调用；无配置时明确 503。
- **可调用 API：** `/v1/asr`、`/v1/tts`、health/capabilities/cancel。
- **硬约束：** sidecar 无 canonical world 写权限；final ASR 才计一次用户回合；音频工件 hash/格式必须验证。
- **当前状态：** checked-in worker 是 fake/model-free；CosyVoice/真实 ASR 尚未通过真机验收。

## Device output router / WebSocket bridge

- **触发：** 已接受的聊天/语音回合输出计划。
- **可调用能力：** 白名单 `speak`、`render.expression`、`orient`、`presence`、`device.sync` 等，取决于 `device.hello` 能力。
- **硬约束：** `command_id`、设备绑定、role revision、过期时间、ACK 幂等、帧长度/sequence 校验。
- **设备边界：** 设备执行并报告结果，不能自行改变角色或世界。
- **控制：** outbox 可查询、失败可重试、断线不重复执行；当前仍缺设备认证密钥。
