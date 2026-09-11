# DeskBot 关键流程

本文件只描述跨越数据完整性、外部副作用、隐私或设备安全边界的流程，不是功能 PRD。

## 文字对话

**Actor：** Web/固件用户。**前提：** Node 可用，`event_id` 唯一。**成功：** 返回 `chat-turn.v0.1`，写入输入、世界投影、状态、证据、回复和 outbox。

1. 客户端 `POST /api/chat`，浏览器到 Node 是不可信边界；服务校验 JSON 大小、消息、身份和事件时间。
2. `input-store` 计算 fingerprint 并按 `event_id` 幂等保存；冲突复用返回 409，不产生第二回合。
3. `persistent-world` 只接受白名单 world mutation；LLM 回复没有 world 写权限。
4. `state-engine` 和 `interaction-policy` 分别计算短状态、情境路由和主动候选；多源事件不自动变成播报。
5. `prompt-composer` 注入角色种子、角色档案、canonical world、实时服务器时钟和有来源上下文。
6. LLM provider 收到提示；失败时返回结构化 500，不回显 provider body 或 secret。
7. assistant reply 作为 audit-only 事件保存；output router 将允许的 `speak`/expression 命令写入幂等 outbox。
8. Web/设备读取结果；设备 ACK 可重复提交，重复 ACK 不重复播放。

## 明确请求最新天气/预报

1. 对话识别“最新/实时/刷新”或“小时/每日预报”。
2. connector 按 kind 检查 TTL；明确请求才 `force` 绕过缓存。
3. server -> QWeather 使用 `X-QW-Api-Key` 或明确的 bearer 模式；token 不进入 payload、日志或状态接口。
4. provider 响应通过结构校验、观测时间和字段范围检查。
5. 当前天气作为 `world.mutation/update_weather` 进入同一事件入口；预报保存在独立只读缓存，不覆盖当前观测。
6. LLM 获得带时间、来源和“预报/观测”区别的上下文，自然回答；失败时保留旧快照并说明不可刷新。

## 语音回合

1. 设备或 sidecar 提交 ASR partial/final；transport 事件只读。
2. 只有 final transcript 进入 `conversation.input`，同一 correlation 只计一次用户回合。
3. 文字流程生成回复；若 voice sidecar 已配置，TTS 生成音频工件并写入服务端 artifact store。
4. output router 发出 `audio.play`，设备验证 hash/格式后 ACK；断线、重复命令和失败均保留可解释状态。

## WebSocket 设备连接

1. 设备连接 `/ws`，第一条控制消息必须是 `device.hello`。
2. bridge 校验协议版本、character binding、能力和帧大小；不满足条件即关闭或返回结构化错误。
3. 服务注册/更新设备，协商音频格式，发送允许的待执行命令。
4. 二进制音频帧按 UUID、sequence、长度和格式校验；结束消息生成一次 ASR/回合。
5. 命令 ACK 只能由绑定设备确认；冲突 ACK 不覆盖已有结果。

## 拒绝路径

- 未知路由：404 JSON。
- 无效 JSON/超大 payload/未知 world action：4xx，不写入部分状态。
- 重复 `event_id` 且 fingerprint 不同：409。
- 未配置 provider：503，不发起网络请求。
- provider/sidecar 超时或 HTTP 错误：结构化可重试错误，不泄露响应体。
- 无认证的局域网暴露：当前不被视为可上线状态。
