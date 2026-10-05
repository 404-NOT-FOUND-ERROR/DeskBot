# 第九步身体协议审计 v0.1

核对日期：2026-10-05。服务端核对起点为 `d5a422c` 的 `embodiment-staging` 快照；本文件记录的是实现前的协议边界，不是实机接通报告。本轮只读取源码、公开硬件资料及串口名称，不打开串口、不刷机、不操作电机、不读取设备配置、生产数据库或私密日志。

## 结论

用户现有硬件是 ESP-VoCat v1.2 本体与单轴旋转底座。适配应使用真实的头部触摸、触控屏、双麦声源方向和底座磁传感，不假设摄像头、行走、俯仰或额外 NFC 模块。官方说明确认本体有圆形触控屏、原生触摸、双麦及声源定位；磁吸接口提供 UART 与电源。[ESP-VoCat v1.2 官方硬件指南](https://docs.espressif.com/projects/esp-dev-kits/zh_CN/latest/esp32s3/esp-vocat/user_guide_v1.2.html)

本地已经有比 `research/hardware/vocat-firmware-audit-v0.1.md` 的 ESP-CLAW 计划更具体的小智本体固件、底座机械归位和磁场识别实现，但它们尚未成为当前 DeskBot Service 的兼容设备端。新的服务端身体层与桥协议，即使通过测试，也不能据此宣称已刷入、连接或验证了真实喵伴。

## 本地可复核源码

本体 checkout 根目录：

```text
D:/502 Bad Gateway/Codex Project/DeskBot/tmp/remote-esp-vocat
HEAD 46d427255756fe2a148777ea3f256b615b52e160
工程 examples/xiaozhi-esp32
板级 main/boards/esp_vocat
```

底座 checkout 根目录：

```text
D:/502 Bad Gateway/Codex Project/DeskBot/.tmp-esp-vocat-base
HEAD 1a9ca16d4710394755f841f94b7de8c2dd476fb1
工程 software/esp_vocat_rotating_base
共享组件 software/common_components/control_serial
```

这些 checkout 含有本地适配，因此 HEAD 不是完整的修改版本证明。本次读取的关键源文件 SHA-256 如下；它们也不证明设备正在运行相同镜像。

| 相对文件 | SHA-256 |
| --- | --- |
| 本体 `examples/xiaozhi-esp32/main/boards/esp_vocat/magnetic_shell_manager.cc` | `c60e9b9bba5279e154353f2279352be45445060d3b653422669a9101a558f618` |
| 本体 `examples/xiaozhi-esp32/main/boards/esp_vocat/base_event_mapper.cc` | `91921be63cafa12366907c295d742b8557014aac41c3b7b6c500b003bf97df43` |
| 本体 `examples/xiaozhi-esp32/main/protocols/websocket_protocol.cc` | `2cf55d9186fda1066f9de1ffff2a447cd5119fffff1a601241b0dccebf50bfa3` |
| 底座 `software/common_components/control_serial/control_serial.c` | `dedc2bb2e9804abf9ed3b404b3d2ef85763517708f61d5124b010fdc4869bf24` |

## 起点版本服务端实际具备的能力

`apps/deskbot-service/src/websocket-bridge.mjs` 已提供 `/ws`、`deskbot.bridge.v0.1` 协商、设备注册与绑定、事件接收、音频分帧、输出投递、命令 ACK、断线后队列重试。上行默认 PCM s16le 16 kHz 单声道或 G.711 A-law 8 kHz；下行默认 Opus 或 PCM 16 kHz。设备音频进入现有语音 sidecar 与统一对话入口。

服务端 JSON 首帧必须是 `deskbot.device-hello.v0.1` / `device.hello`，带设备 ID、协议列表、能力、音频格式和绑定信息。之后事件使用 `deskbot.device-event.v0.1` / `device.event`，携带 `event_id`、`event_type`、时间、关联 ID 与 payload。

实现前默认感知白名单包括 `sensor.touch`、`sensor.microphone_direction`、`shell.install.detected` 与 `sensor.imu`。`input-refraction.mjs` 能将 head/screen 触摸解释为注意，合法声音角解释为身体信息，合法壳标识解释为当前壳观测；方向不会成为用户身份，外壳不会成为角色身份。它尚没有持续身体状态、稳定的感知质量/新鲜度模型或感知到实际电机执行的闭环。

实现前的 WebSocket 下行白名单只有 `render.expression`、`audio.play`、`audio.stop` 和 `device.set_volume`。`orient` 会被明确拒绝；旧文档列出 `orient`、`presence`、`nfc.scan` 不等于它们已有实现。`expression-intent.mjs` 统一文本、表情、语音表现，但没有电机消费者。`fake-device.mjs` 的模拟完成回执也不是传感器或实际角度。

当前 `device.hello` 中的能力是客户端声明；原桥 `requireBinding` 默认 false。`app.mjs` 把绑定到主角的协议 peer 上报当作设备类别，并没有由此提供硬件身份认证。公共 `/api/event` 自报 `source_kind=device`、能力、shell_id 或 provenance 不能被当成可信实机证据。实际接入需要明确受信设备、连接会话与上报来源；软件模拟与实机必须有不同来源标记。

## 小智本体的实际软件结构

下面列的是本地 checkout 中可复用的代码与调用关系。它描述源码，不能证明 USB 接上的设备正在运行这些本地修改。

| 层 | 主要文件 | 现有职责与适配位置 |
| --- | --- | --- |
| 应用生命周期 | `main/application.cc` | `Application::Start()` 初始化板卡音频、主事件循环、网络、资产/OTA 配置后，选择 `MqttProtocol` 或 `WebsocketProtocol`。应用已经有 idle/listening/speaking 等状态；新身体动作应服从这个状态机。 |
| 传输协议 | `main/protocols/websocket_protocol.cc`、`mqtt_protocol.cc` | 小智 hello、音频通道、Opus 数据与 JSON 控制。应用消费 `tts`、`stt`、`llm.emotion`、`mcp` 等消息，不消费 DeskBot `device.command`。 |
| 板级硬件 | `main/boards/esp_vocat/esp_vocat.cc` | 初始化电源、I²C、SPI、ST77916 显示、CST816S 屏幕触控、头摸、底座控制、音频分析和 DevTools；显示、音频编解码器与接口可继续复用。 |
| 触摸与 UI | `touch_sensor.cc`、`ui_bridge.cc` 及显示组件 | 头部触摸当前参与唤醒；CST816S 注册到 LVGL 并接 UI 手势处理。要新增身体事件出口，同时保留本地 UI 手势和唤醒，避免一次触摸被多层重复上报。 |
| 麦克风方向 | `audio_analysis.cc` | 双通道音频分析包含 DOA/VAD 与节拍，DOA 目前直接调用绝对角接口。应先统一坐标，再将原始观测送入身体事件，避免“本地跟随”与“服务端转头”同时争抢电机。 |
| 底座接入与证据 | `base_control.cc`、`base_event_mapper.cc`、`base_event_journal.*` | 接收 UART 帧，保存机械状态、磁原始数据与事件；磁样本进入独立队列/任务。新网络上报应从这条链生成，不让 UART 回调阻塞等待网络。 |
| 外壳识别 | `magnetic_shell_manager.*` | 消费磁样本，维护设备档案、稳定识别和换壳事件。设备档案与世界外壳目录保持显式对应，unknown/no_data/detached 分开处理。 |
| 工具接口 | `dev_tools.cc`、`main/mcp_server.*` | 已有读取证据与手动调试工具；可以用于调试和校准，不是每次身体感知的实时上报替代品。 |

当前路径可以概括为：板级传感器 → 本地 UI / AudioAnalysis / BaseControl → 本地状态与 MCP；语音走 Application → 小智 Protocol → 现有服务器。DeskBot 身体层位于另一端，需要新增受控连接和事件适配，才能把这两条链真正连接。

## 本体与底座可直接利用的能力

底座通信为 UART 115200，帧格式：

```text
AA 55 LEN_H LEN_L CMD DATA... CHECKSUM
LEN = 1 + DATA 字节数，双字节大端
CHECKSUM = (CMD + 全部 DATA 字节之和) & 0xFF
```

必须支持拆包、粘包、长度上限和校验失败重同步；不能把日志文本当二进制有效帧。以下是本地修改源码的协议，不能全部写成官方原版已具备的能力。

| 命令 | 本地实现及可复用边界 |
| --- | --- |
| `0x00` | 心跳，值 `0x0001`；它仅证明链路消息，不证明归位或位置。 |
| `0x01` | 绝对目标角 0..180；软件记录估计角，没有位置编码器。 |
| `0x02` | 预设动作；完成上报同命令、值 `0x0010`。没有服务端 `command_id`，需薄适配器关联在途动作。 |
| `0x03` | 磁滑块/配件事件及校准通知；鱼、冰淇淋、甜甜圈、滑动、放回/取下等是原始事件类别，不能自动等同任意外壳 ID。 |
| `0x04` | 本地新增机械重新归位请求；只有明确操作才触发。 |
| `0x05` | 本地新增机械状态：homing=0、ready=1、failed=2；未 ready 时电机指令被底座拒绝。 |
| `0x06` | 本地新增原始磁数据：sensor kind + 三个 int16 大端；数字磁力计为 XYZ，单轴霍尔数据另有语义。它不是已经识别出的 shell_id。 |
| `0x07` | 本地新增相对声源 bearing，90 为正前；单次最大 ±30°，总估计位置约束 30..150°，1.2 秒节流、近正前死区。 |

本体 `BaseEventJournal` 与 `base_event_mapper.cc` 已记录底座事件序号、单调时间、原始帧、机械状态和派生断线。派生事件保留 synthetic 标记且没有虚构原始帧；这是服务端证据链的可复用基础，但当前只在本体页面、日志和 MCP 查询中可见。

`MagneticShellManager` 可学习至多六组磁场档案，每组采集 24 个样本；有窗口稳定性、容差距离、置信度、连续确认及冷却。已有 attached、changed、unknown、detached 事件。其 profile ID、名字、XYZ 与 confidence 是设备观测，需要映射到服务端已登记外壳，不能据名字直接修改角色。失去数据、unknown 和真正取下也应分开表达；“没有样本”不能自动证明“没有壳”。

本体 MCP 工具已经实现：

- 只读 `self.echo_base.events`：底座链路、机械状态和带原始帧的最近事件。
- 只读 `self.shell.identify`、`self.shell.list`、`self.shell.events`：磁场识别、档案和事件；现有返回主要为描述文本，需要结构化转换。
- 有副作用 `self.shell.learn`、`self.shell.manage`：学习/改名/删除档案；不得当作普通感知读取自动执行。
- 有副作用 `self.echo_base.set_action`、`self.echo_base.set_audio_mode`：动作、声源跟随/节拍模式或禁用。

这些工具依赖小智现有 MCP 会话，DeskBot 当前没有对应客户端，不能因为工具名字存在就说能直接调用真实设备。

## 已发现的兼容缺口

1. 小智固件 `WebsocketProtocol::GetHelloMessage()` 发 `type=hello`、整数 version、`transport=websocket`、`audio_params=opus/16000/1` 和 `features.mcp`。DeskBot 要求上述 `device.hello` envelope，二进制音频封装和服务端 hello 也不同。把小智服务器 URL 改到 DeskBot `/ws` 不能完成接入。
2. 本体磁壳/底座事件尚无 DeskBot 标准事件主动上行。头摸代码主要把三次 PRESS_DOWN 变成本地唤醒；屏幕触摸主要用于本地 UI。它们不是已经进入伴生世界的实机触摸流。
3. 本体 `audio_analysis.cc` 的 DOA callback 仍调用 `vocat_base_control_set_angle(angle)`；读取到的 managed component 发送 `0x01` 绝对角。底座新增 `0x07` 才是相对 bearing。当前这份源码的两端角度语义不一致，不能宣称新跟随链已打通。
4. `0x01` 虽验证 0..180，但不具备 `0x07` 同样的 30..150 保守范围。服务端/设备适配必须有已测机械限位、坐标转换、冷却和互斥，不直接转发模型随意角度。
5. UART 写入成功、动作完成通知、服务端 ACK 都不能证明绝对物理位置。没有位置传感时，只显示“已请求/已执行步数，位置为估计”；不生成 actual measured yaw。

## 可落实的接入合同

推荐先维持 DeskBot 作为唯一角色/世界状态，建立薄设备适配，不让硬件代理直接改世界任务或人格。可以在本体实现 DeskBot 协议客户端，或单独建立小智兼容网关；两条路线必须选定一个实际可复现产物，避免把两种 hello 混用。

最小上行应有稳定 device_id、每次开机 boot_id、递增 sequence、原始观测时间/单调时间、来源 real/simulated、感知质量与能力，并映射为触摸、声源、壳观测和设备/底座状态。事件 ID 用 device+boot+sequence 保证重传幂等。重放旧观测可供审计，但不能重新启动动作；断线和过期会使现时身体信息失效。

声音方向统一明确相对坐标和单位，保留 confidence 与是否在语音活动期；方向不识别人，也不自动获得虚拟地图位置信息。磁壳上报应保留 matched/unknown/no_data/detached、profile_id 和置信度，服务端单独注册磁档案到外壳的映射；不以一次 noisy 原始磁值确认换壳。

最小下行保留现有表情/音频链，再加能力约束的单轴朝向指令：服务端命令 ID、来源事件、有效期、相对/绝对坐标、目标限幅、节流和归中策略。设备侧归位 gate、动作互斥与 command_id 去重不可依赖 LLM。ACK 只结算命令状态；实际身体位置只能由明确遥测、测量类型与新鲜度更新。

## 后续固件优化的具体步骤

1. **先固定可复核版本。** 确认本体和底座源码/镜像、板卡型号、组件依赖及已有磁档案的保留方法；清点本地修改并形成独立补丁。当前只有源码读取结果，尚未确认在设备上刷入的版本。保持固件操作和密钥配置在后续明确的工作范围内。
2. **先解决运动语义。** 将原始 DOA 定义为相对当前麦阵的方向，底座估计朝向定义为归位正前参考。明确使用现有 `0x07` 相对跟随还是 `0x01` 绝对目标；归位未 ready、参考丢失或旧协议不匹配时不转动。切换本地跟随与服务端控制时指定唯一电机所有者，检查保守角度范围和超时。
3. **新增事件队列与身体适配器。** 从 TouchSensor、UI 手势、AudioAnalysis、BaseControl / MagneticShellManager 提取结构化事件，统一 boot/sequence、观测时间、置信度和真实来源。使用有界异步队列、合并高频 DOA、触摸去抖、断网重传和固定 event_id；不在音频/UART/UI 回调内执行阻塞网络请求。
4. **以独立协议接入保持可切换。** 推荐保留现有小智 protocol，新增可选择的 `DeskBotProtocol` 或独立传输适配器，复用 Board、AudioService、Display。实现 DeskBot hello / event / command / ACK 的完整 envelope，再明确 PCM / Opus 与 DBA1 的适配；不要通过仅替换服务器 URL 冒充兼容。若先做小智网关，则同样需要可运行的握手/音频转换产物，不能只有命名映射。
5. **将输出落实到真实设备。** `render.expression` 映射到可用表情资源与 UI 线程；单轴指令在设备侧检查校准、在途动作、限位、到期和 command_id 去重。底座只报告步数完成时发送 `reported` / `measured:false`；无编码器设备不声明 `sensor.yaw_feedback`。换壳档案与服务端 calibration/catalog 显式绑定，未知样本不上报任意已知壳。
6. **再做分层实机验收。** 顺序验证连接/版本 → 单次触摸 → 原始方向 → 地磁 matched/unknown → 表情 → 归位后小角度动作 → 失败、断线、重复命令和过期重放。第一批只验事件与表情，确认运动契约后再进行电机测试。保存去除聊天和密钥的协议证据，并保持正式世界时间为真实时间。

上述是后续工作建议。本轮没有修改、构建、刷入或打开这些固件的串口。

## 本轮新增软件层的已验证边界

`body-perception.mjs` 与 `GET /api/life/body` 已在 staging 接入持续身体读模型。集成使用独立临时 SQLite 和本地 WebSocket 软件客户端，`test/body-perception-http.test.mjs` 共 8 项通过；它不是物理喵伴的验收。

- 无设备时角度、当前外壳和注意均未知；GET 不修改存档或追加变更。
- 公共 HTTP 的 sensor / 内部 body ACK / provenance 声明不能成为身体证据。匿名 hello 可显示连接，但不能靠自报 commissioning 取得感知/输出资格。
- 软件 profile 许可、设备能力、当前绑定与连接共同约束动作。声源须声明 `coordinate_frame:calibrated_forward` 才进入绝对 yaw 输出；当前小智相对 DOA 不满足此条件。
- 普通旋转完成回执只写 `reported_degrees` / `open_loop_report`，`actual_degrees` 保持 null。只有另外许可的 `sensor.yaw_feedback` 和 `measured:true` 才能写 measured；该路径在软件 fixture 中验证，现有硬件没有据此获得编码器。
- 模拟回执始终标 simulated，不写实际或上报硬件角度；失败保留失败原因，不改写此前测得的角度。
- 地磁读取需服务端登记校准及外壳目录；无校准、不匹配或未知 code 不猜壳。合法换壳不重写角色身份、物品或世界任务。
- 重复输入、完成后的 ACK 重传、SQLite 重启重连后的 ACK 重传均保留第一次持久结果，不产生第二次动作或新测量。

## 本轮验证边界

软件集成可验证：无设备时字段为未知；不可信 HTTP 不能产生 actual 身体数据；重复输入不重复动作；断线/过期不冒充在场；无姿态能力不下发转向；换壳不换人格；世界时钟、实际任务和库存不会被感知事件改写。

实机还需要确认刷入镜像版本、USB/网络身份、本体与底座两端协议版本、麦克风方向坐标、磁档案/外壳映射、归位限位、触摸单次上报、断线恢复和真实执行反馈。首次仅枚举到 `COM3/COM5/COM6/COM7/COM8/COM10/COM11`；用户表示 USB 已连接后，注册表只读枚举增加 `COM4`（`\\Device\\USBSER001`），原 `COM8` 为 `\\Device\\USBSER000`，其余是 BthModem 映射。Windows 友好名称/设备查询受当前权限限制，不能据 COM 名称确定本体或底座身份。用户随后明确目前为小智固件、先审阅结构，因此停止进一步硬件探测。未选择、打开或操作任何端口，也没有采集 USB 日志。

`research/shell-interface-v1.md` 中 NFC 区域、尺寸和运动包络仍是待实测的设计草案；不能用 Ditto/C5、摄像头或多轴云台资料替代本次 VoCat/单轴底座的接口。原 G0 表格是用户原厂自测基线，未归档镜像/日志的部分仍不等于新 DeskBot 桥接验证。
