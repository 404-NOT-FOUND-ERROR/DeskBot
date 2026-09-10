# 输入—状态—输出架构 `v0.1`

这份架构用于冻结组件职责：DeskBot 自研后端是唯一运行主线；RisuAI 与 SillyTavern 只提供机制参考和可选对照，不直接控制喵伴。

```text
DeskBot Chat 对话文本 ─┐
时间/世界事件 ─────────┼─> DeskBot 输入层 (/api/chat, /api/event)
VoCat 原始传感信号 ────┘                 |
                                   v
                         情绪/意图分析层
                                   |
                          CAPS-inspired 短时状态
                         (state_revision)
                                   |
                 evidence + 规则达标后再提交
                          role-state.v1 revision
                        ┌──────────┴──────────┐
                        v                     v
                 影响下一轮回复             输出分发器
                 (状态注入 DeskBot LLM) (网页 + 假设备 + VoCat)
                                              |
                                              v
                              表情 / 立绘 / 说话 / 转向
```

## 组件边界

| 组件 | 负责 | 不负责 |
|---|---|---|
| DeskBot Chat/LLM Gateway | 对话 UI、角色卡、条件上下文、模型调用和最终回复 | 绕过 evidence ledger 直接修改长期状态 |
| RisuAI | 情绪识别、情绪立绘和角色卡机制参考/对照 | 最终状态真相、CAPS 权重、role revision、直接控制固件 |
| SillyTavern | World Info 关键词/条件触发与选择性注入参考/对照 | 最终状态真相、直接控制固件 |
| DeskBot 输入层 | 统一接收文本、时间、传感器和外部事件；事件 ID 去重 | 直接把一句话映射成永久 trait |
| 情绪/意图分析 | 从文本或传感器事件生成可解释的短时分析结果 | 覆盖角色长期身份 |
| CAPS/短时状态引擎 | 融合基础层与调节层，维护临时 `state_revision` | 把模型内部推理或助手回复当作长期证据 |
| 角色状态提交器（下一阶段） | 用 evidence、规则版本和 transition 提交 `role-state.v1` 的 `role_revision` | 直接把一句话或短时表情升级为身份变化 |
| 输出分发器 | 将已提交状态映射为网页、假设备和 VoCat 命令 | 自行改变角色状态 |
| VoCat 固件 | 执行录音、播放、显示、朝向和回传事件 | 运行完整 LLM、角色记忆或演化规则 |

## 开源项目与研究主线

为了利用开源项目能力并保持研究可解释性，分成三个层次：

1. **RisuAI 原生基线：** 使用 `emotionImages`、`viewScreen: emotion` 和内置 emotion processor，验证“回复文本 -> 情绪立绘”。它只作为快速基线和对照实验。
2. **SillyTavern 原生基线：** 使用 World Info 的 primary/secondary keywords、constant/selective、scan depth 和 selective logic，验证“条件 -> 情境注入”。它只作为机制参考和对照实验。
3. **研究主线：** DeskBot 将对话、时间、传感器和外部事件统一为事件，产生短时 `emotion_signal` 和条件命中，再由 CAPS-inspired 原型融合状态。DeskBot LLM 直接消费该状态和情境，网页与硬件消费同一输出。

RisuAI 回复中的 `{{emotion::name}}`/`<Emotion="name">` 和 SillyTavern World Info 命中都可以作为可观察的对照信号，但不能单独覆盖多源状态。这样可以比较“开源原生机制”与“DeskBot 多源融合”的差异。

## 当前实现位置

- `POST /api/chat`：DeskBot 主线文本入口；执行世界条件、短时状态、prompt、Fake LLM、回复事件和输出计划。
- `POST /api/event`：时间、传感器、设备和外部事件进入统一事件层。
- `GET /api/events`：回放输入事件，供后续状态引擎和实验复现使用。
- `GET /api/evidence`、`GET /api/world/matches`：查看证据资格、规则来源、优先级、有效期和命中记录。
- `GET /api/outbox`、`POST /api/outbox/:command_id/ack`：用幂等命令和确认模拟网页、假设备与 VoCat 输出。
- `src/fake-device.mjs`：在真实 VoCat 之前验证 hello、轮询、执行日志和 ACK 幂等。
- `GET /api/state/:character_id`：读取短时状态和待注入 DeskBot LLM 的上下文。
- RisuAI/SillyTavern 适配器若启用，只做异步对照信号上报。

## 后续顺序

1. 把内存事件、evidence 和 outbox 替换为 SQLite，并在服务重启后回放验证。
2. 增加长期 `role-state.v1` 提交：单独维护 `role_revision`，要求 transition、rule version 和 evidence IDs。
3. 把 Fake LLM 替换为 OpenAI-compatible Provider，并保留确定性回放夹具。
4. 增加外部 TTS，输出 `audio_ref`，再用同一设备协议替换假设备，接入 ESP-CLAW/VoCat。
5. 最后才做真实硬件延迟、音频链路和外壳装配测试。
