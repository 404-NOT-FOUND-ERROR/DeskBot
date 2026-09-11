# `interaction-contract.v0.1` 软件—硬件交互契约

**状态：** 草案。用于第一轮 DeskBot Service + 假设备 + ESP-CLAW/ESP-VoCat 联调；RisuAI/SillyTavern 只作为可选机制对照。

> 当前连续世界身份：`shaping-001`（聚形域）。旧 `ember-001` 仅作为历史设备/事件的兼容别名；新事件和命令示例使用 `shaping-001`。

## 1. 目的与边界

本契约把旅程图中的软件事件转译为实体桌宠可以执行的反馈，并把实体端的安装、连接和传感事件回传到 DeskBot Service。它连接以下三个已有文档：

- `role-state-v1.md`：DeskBot Service 的权威角色状态和证据交换格式。
- `shell-interface-v1.md`：固定内核与可替换外壳的机械边界。
- 本文档：输入、角色状态和输出命令如何跨 DeskBot Service、桥接层和设备运行时流动。

本契约不负责：

- 在 ESP32 上运行完整大模型、角色记忆或演化规则。
- 用提示词代替可追溯的多源证据和权重记录。
- 把摄像头、触摸屏、四足行走或复杂端侧感知设为必需能力。
- 规定最终外壳的造型参数；外壳生成只消费 `visual_semantics`。

## 2. 系统分层与权责

```text
DeskBot Chat / Web App
  - 用户输入和状态展示；不保存权威状态
             |
             v
DeskBot Service（唯一编排与状态真相）
  - /api/chat、/api/event、情绪映射、世界条件、CAPS-inspired 融合
  - prompt、LLM、evidence ledger、role revision、shell registry、输出计划
             |
             v
输出路由 / 具身交互桥接层
  - 事件规范化、能力协商、命令翻译、确认/重试、日志
             |
             v
ESP-CLAW 设备运行时 / ESP-VoCat v1.2 薄设备适配层
  - 音频、表情、朝向、NFC 读取和设备状态
             |
             v
固定内核 + 可替换打印外壳
```

| 组件 | 权威数据 | 可以做的事 | 不应做的事 |
|---|---|---|---|
| DeskBot Chat/Web App | 用户输入、界面临时状态 | 展示对话、地图、档案和打印流程 | 保存权威状态或绕过证据链换壳 |
| DeskBot Service | 对话上下文、世界条件、`role-state.v1`、证据、规则版本、壳历史 | 统一收口输入，编排情绪/条件/CAPS/LLM，提交状态并生成输出计划 | 把模型黑箱结果当作唯一证据 |
| RisuAI/SillyTavern 对照适配器 | 情绪标签/立绘或条件命中/注入的对照结果 | 按需异步上报可观察结果 | 作为必需运行时、回复来源、状态真相或硬件控制器 |
| 交互桥接层 | 传输序列、设备能力、命令确认 | 把状态翻译为设备命令，处理超时和幂等 | 自行改变角色身份 |
| 设备运行时 | 当前设备状态、传感事件、执行结果 | 播放声音、显示表情、转动、读取 NFC | 自行修改 `traits` 或永久保存身份真相 |
| Shell registry | `shell_id`、打印版本、安装历史 | 校验外壳、归档旧壳 | 用外壳 ID 覆盖角色记忆 |

研究主线只通过 DeskBot Service 编排输入、状态、prompt、LLM 回复和设备输出；`role-state.v1` 也只由该服务提交和版本化。RisuAI/SillyTavern 对照信号只能作为普通事件进入，不能成为主入口或回复来源。

### 可选开源对照适配器

- RisuAI 仅参考或对照“文本 -> 情绪标签 -> 立绘”的映射。
- SillyTavern 仅参考或对照“条件触发 -> prompt 选择性注入”的 World Info 机制。
- 两者都不是依赖，不负责主线 LLM/TTS，不直接写 `role-state.v1`，也不直接控制设备。

这些适配器只负责采集和转发，不在客户端内部计算最终 trait、身份阈值或外壳批准状态。

## 3. 身份与版本标识

每个事件和命令尽量携带以下标识：

| 字段 | 含义 | 稳定性 |
|---|---|---|
| `character_id` | 同一角色的长期身份 | 换壳不变 |
| `device_id` | 固定电子内核的身份 | 换壳不变 |
| `shell_id` | 当前实体外壳的身份 | 每个外壳唯一 |
| `role_revision` | `role-state.v1` 的提交版本 | 单调递增 |
| `shell_revision` | 外壳设计/打印版本 | 同一 `shell_id` 可修订 |
| `event_id` | 单个事实或事件的唯一 ID | 不重复 |
| `command_id` | 单个设备命令的唯一 ID | 可重试但不重复执行 |
| `correlation_id` | 将一次对话、状态变更和设备反馈串起来 | 一次交互保持不变 |

`character_id` 和 `device_id` 的关系必须独立保存。更换外壳只改变 `shell_id`，不能创建一个新角色或清空 DeskBot 记忆。

## 4. 事件信封

所有跨层事件采用同一信封，业务字段放在 `payload` 中：

```json
{
  "schema": "foundry.event.v0.1",
  "event_id": "evt-000042",
  "type": "conversation.input",
  "source": "device",
  "occurred_at": "2026-08-14T10:00:00+08:00",
  "character_id": "shaping-001",
  "device_id": "vocat-001",
  "shell_id": "shell-001",
  "role_revision": 3,
  "correlation_id": "turn-000019",
  "payload": {
    "text": "我今天有点累",
    "audio_ref": "local://audio/turn-000019.wav",
    "confidence": 0.92
  }
}
```

### 第一版事件类型

| 类型 | 方向 | 说明 | 是否写入证据 |
|---|---|---|---|
| `conversation.input` | 设备/App -> 服务 | 用户语音、文字或明确操作 | 是，按规则筛选 |
| `conversation.reply` | DeskBot Service -> App/桥接层 | DeskBot LLM 的最终回复、语气和可选行为标签 | 否，除非形成可验证事件 |
| `role.state.updated` | 服务 -> 桥接层/App | 新的 `role-state.v1` revision | 是状态提交 |
| `shell.candidate.created` | 服务 -> App/桥接层 | 达到阈值的外壳候选 | 是 |
| `shell.requested` | 角色/App -> 服务 | 角色明确请求用户打印 | 是 |
| `shell.print.ready` | App -> 服务 | 用户确认打印件已完成 | 是安装流程记录 |
| `shell.install.detected` | 设备/NFC -> 服务 | 读取到 `shell_id` | 是设备事实 |
| `shell.install.confirmed` | 服务 -> App/设备 | 校验通过并提交新壳 | 是状态提交 |
| `device.hello` | 设备 -> 桥接层 | 设备身份、固件和能力清单 | 否，写设备日志 |
| `device.action.completed` | 设备 -> 桥接层 | 声音、表情、朝向等命令完成 | 否，写执行日志 |
| `device.error` | 设备 -> 桥接层 | 播放、运动、NFC 或连接失败 | 可转为系统证据 |

`conversation.reply` 不应直接覆盖角色状态。只有经过规则处理、带有证据 ID 的 `role.state.updated` 才能驱动身份变化或外壳候选。

## 5. 设备命令

桥接层向设备发送的命令采用独立信封：

```json
{
  "schema": "foundry.device-command.v0.1",
  "command_id": "cmd-000081",
  "type": "render.expression",
  "device_id": "vocat-001",
  "character_id": "shaping-001",
  "role_revision": 4,
  "correlation_id": "turn-000019",
  "priority": "normal",
  "expires_at": "2026-08-14T10:00:08+08:00",
  "payload": {
    "expression": "tired",
    "theme": "amber",
    "duration_ms": 1800,
    "show_text": false
  }
}
```

### 第一版命令类型

| 命令 | 最低硬件能力 | 说明 |
|---|---|---|
| `speak` | 扬声器 | 播放 `audio_ref` 或请求设备侧 TTS；不把 API 密钥放进设备 |
| `render.expression` | 小屏 | 只显示表情/状态，不显示长段对话文本 |
| `orient` | 一个 yaw 轴 | 以目标角度、速度和回中策略执行；适配层负责限幅 |
| `presence` | 屏幕/音频 | 上电、等待、离线、安装确认等短反馈 |
| `nfc.scan` | NFC 读写器 | 请求一次扫描或报告扫描结果 |
| `device.sync` | 网络连接 | 重新发送当前 revision 和 `shell_id` |

设备返回 `device.action.completed` 或 `device.error`。重复收到同一 `command_id` 时，设备应返回已有结果而不是重复触发声音或运动。

## 6. 能力协商

设备连接后先发送 `device.hello`。能力是可选的，软件不得假设所有设备都支持：

```json
{
  "schema": "foundry.device-hello.v0.1",
  "device_id": "vocat-001",
  "hardware": "esp-vocat-v1.2",
  "firmware": "esp-claw-adapter-0.1.0",
  "shell_interface": "shell-interface.v1",
  "capabilities": {
    "audio.capture": true,
    "audio.playback": true,
    "display.expression": true,
    "orientation.base_yaw": true,
    "orientation.head_yaw": false,
    "nfc.shell_id": false,
    "touch.input": false,
    "imu.input": true
  }
}
```

ESP-VoCat v1.2 的第一阶段适配预设为：音频、表情和网络必选；`orientation.base_yaw` 可先承担朝向反馈；`orientation.head_yaw` 不应在没有机械验证时宣称支持；NFC 需要外接模块并通过 I²C 或独立桥接器接入。`pitch_deg` 在设备不支持时由适配层忽略或裁剪。

## 7. 旅程图到设备的映射

| 阶段 | 软件触发 | 设备反馈 | 完成记录 |
|---|---|---|---|
| 开箱 | 建立 `character_id` 和初始 `shell_id` | 表情亮起、声音、朝向用户 | `device.hello` + 初始状态 |
| 日常相处 | DeskBot Service 完成一轮对话编排 | 播放语音、表情变化、必要时朝向 | `conversation.input`、执行日志 |
| 身份积累 | 证据累计达到规则条件 | 短时表情/语气变化，不自动换壳 | 新 `role_revision` |
| 外壳候选 | `shell.candidate.created` | 可选的含蓄提示 | 候选语义、证据 ID、参数版本 |
| 请求打印 | `shell.requested` | 角色明确提出请求 | 用户确认、STL 版本、打印任务 |
| 安装前 | `shell.print.ready` | 进入等待/安装状态 | 当前壳仍保持不变 |
| 安装确认 | `shell.install.detected` 且校验通过 | 短暂沉默、转动、表情和语音回应 | `shell.install.confirmed` |
| 新阶段 | 新壳与新 `role_revision` 生效 | 使用新身份对应的表情和语气 | 旧壳归档、历史可查看 |

硬件只负责让用户感到“它在这里”；DeskBot Web/App 负责地图、事件流、档案、文本交流和打印文件，所有状态仍由 DeskBot Service 管理。换壳请求必须是明确事件，不能由设备定时器自动启动。

## 8. 外壳状态机

这里描述的是 shell registry 中的制造/安装流程状态，与 `role-state.v1` 中用于判断是否生成候选的 `shell_trigger.status` 分开保存。

```text
stable
  -> candidate
  -> requested
  -> printing
  -> ready
  -> install_pending
  -> confirmed
  -> archived (旧壳)
```

允许从 `candidate` 进入 `deferred` 或 `rejected`，但不能跳过用户确认直接进入 `confirmed`。NFC 读取只证明“检测到某个壳”，还需要由服务校验 `shell_id`、角色归属、打印版本和当前 `role_revision`。

## 9. 可靠性与安全规则

1. 命令必须携带 `command_id` 和 `role_revision`，设备拒绝明显过期的状态命令。
2. 断线后设备保持最后一个安全表情和姿态；恢复连接后用 `device.sync` 请求当前状态。
3. NFC 事件在短时间内去重，避免一次贴合触发多次换壳。
4. 任何设备传感器只能产生事件，不能直接写入角色 trait。
5. 设备端不保存第三方模型密钥；语音和角色推理通过桥接服务完成。
6. 目标延迟先作为 E0 测量项，不在 v0.1 把未经实测的数值写成硬性承诺。

## 10. 最小联调顺序

1. 用网页假设备消费 `role-state.v1`，验证表情、语音和 yaw 命令。
2. 用 `fake-device` 完成 `device.hello`、命令轮询和 ACK 幂等，验证输出 outbox。
3. 在 DeskBot Service 内完成 Chat/LLM Gateway：输入、条件匹配、状态注入、回复和输出计划。
4. 仅在需要对照实验时接入 RisuAI/SillyTavern 适配器。
5. 用桥接层连接 ESP-CLAW/ESP-VoCat，先完成 `device.hello`、`speak`、`render.expression` 和 `orient`。
6. 打印无造型的中性载体，验证屏幕、麦克风、扬声器、USB 和旋转包络。
7. 接入 NFC，完成 `shell.install.detected` 到 `shell.install.confirmed` 的闭环。
8. 最后才把三组角色外壳和 `visual_semantics` 接入生成流程。

## 11. 尚待冻结的决定

- DeskBot Chat 与聚形域 Web App 是同一前端还是两个共享 API 的视图。
- TTS 在服务器生成音频，还是由设备运行时生成短文本语音。
- VoCat 的 `base_yaw` 是否在最终样机中升级为真正的 `head_yaw`。
- NFC 读写器型号、天线位置和外壳标签格式。
- ESP-VoCat v1.2 成品的实际固件、底座版本和 `shell-interface.v1` 实测尺寸。
- `shell-interface-v1` 从 Ditto 测量草案迁移为 VoCat 中性内核测量版的时间点。
