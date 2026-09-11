# 测试覆盖图

本文件区分“仓库当前已经检查”与“建议但尚未完成”的证据。自动回归不是真实 DeepSeek、QWeather 或 ESP-VoCat 验收的替代品。

## Existing coverage

| 用例 | 规则/预期 | 证据 | 状态 |
|---|---|---|---|
| 输入与聊天幂等 | 相同 event/correlation 不重复回合；冲突返回错误 | `apps/deskbot-service/test/input.test.mjs`、`persistence-restart.test.mjs` | existing |
| 喵呜提示词 | seed/profile/反应节拍/边界字段进入 prompt | `chat-orchestrator.test.mjs`、`persistent-world.test.mjs` | existing |
| 旧世界迁移 | `ember-001`/旧名迁移到 canonical ID/喵呜且保留历史 | `persistent-world-migration.test.mjs` | existing |
| 多源隔离 | 世界线、天气、用户偏好和设备事件按 route 分类，不自动播报 | `interaction-policy.test.mjs`、`multisource-prompt.test.mjs` | existing |
| 天气缓存 | TTL、force、观测时间单调、v7/v1 字段和错误不泄密 | `weather-connector.test.mjs`、`context-sources.test.mjs` | existing |
| LLM 错误 | 不回显 provider body/secret；缺配置拒绝启动 | `llm.test.mjs` | existing |
| 设备 outbox/ACK | 白名单命令、重复 ACK、冲突 ACK 和失败可解释 | `output-router*.test.mjs`、`device-*.test.mjs` | existing |
| WebSocket/音频协议 | hello、能力协商、序列、hash、重连和播放边界 | `websocket-bridge.test.mjs`、`app-websocket.test.mjs`、`protocol-regression.test.mjs` | existing |
| 研究场景 | 固定场景隔离、可回放、无虚构 L1b 距离 | `research-scenarios.test.mjs`、`research-sessions.test.mjs` | existing |
| voice sidecar contract | ASR/TTS/cancel、超时、格式和错误 envelope | `voice-sidecar/tests/*`、`voice-sidecar-client.test.mjs` | existing |
| CI | Node service test workflow | `.github/workflows/service-test.yml` | existing/configured |

最近一次 Node 服务回归为 `119/119`；新增 `llm-http-error.test.mjs` 验证聊天上游失败返回安全、可诊断的 `502`。Python sidecar 回归为 `16/16`（以本地记录为准，未把 provider 网络调用算作自动通过）。

2026-09-11 运行态检查：`4311/health` 与 `4322/health` 均通过；服务实际加载 `openai-compatible-v0.1`。本次 PowerShell 对 `api.deepseek.com:443` 的直接连接被 Windows socket 权限策略拒绝，真实聊天因此返回 `502 llm_transport_error`；这不是 DeepSeek HTTP 错误，需在用户普通 PowerShell/网络策略允许的环境重新做 live smoke。未加载 QWeather 环境文件时，天气状态明确为 `open-meteo / disabled`，不能把历史天气快照记为当前连接成功。

## Proposed tests

| 用例 | 类型 | 通过条件 | 状态 |
|---|---|---|---|
| 九类喵呜真实 DeepSeek 样本 | guarded live + manual review | utility/character/grounding/presence/variety 五项全 1 | proposed |
| 正式 QWeather v7/v1 刷新 | guarded live integration | 真实观测/预报、TTL、失败旧快照均可解释 | proposed |
| 认证和局域网暴露 | automated integration + security review | 未认证请求拒绝，Origin/速率/设备密钥有效 | proposed |
| CosyVoice/真实 ASR | guarded live + hardware | 20 回合一次且仅一次、延迟和播放失败可回放 | proposed |
| ESP-VoCat 真机 | hardware integration | hello、speak、expression、ACK、断线恢复 | proposed |
| 纵向角色变化 | manual longitudinal study | P2-P4 evidence/revision/阶段档案可完整回放 | proposed |

## Gaps

- **高风险：** 当前无认证/授权/速率限制测试；禁止把 `0.0.0.0` 当作生产配置。
- **高风险：** 当前真实 DeepSeek/天气/语音出站受运行环境影响，未形成稳定 live evidence。
- **高风险：** 固件 agent 尚未提供真实设备 ACK、播放和断线证据。
- **中风险：** `expression_intent` 尚未驱动真实屏幕/TTS 三端一致性。
- **中风险：** P2-P4 角色方向状态机和长期关系记忆尚未实现。

## Merge gate

合并到 `main` 至少要求：Node CI 通过、无密钥/SQLite/音频/临时输出、接口变化附迁移说明；角色表达变化还需附真实模型人工记录，硬件协议变化需通知固件 agent。
