# 身体感知与设备反馈 v1

2026-10-05。当前交付为服务端、客户端和隔离 WebSocket 模拟设备的软件回合。小智本体固件还没有 DeskBot 适配；本轮不刷机、不发送串口电机命令。固件核对见 [结构审计](../hardware/body-bridge-audit-v0.1.md)。

## 一次回合

绑定设备通过 `/ws` 协商 → 服务端核验本机调试登记、能力、连接会话、时间与重复序列 → 持久 `world.body` 感知 → 唯一输出队列 → 桥发送 → 设备 ACK → 持久反馈。感知、意图、发送和执行报告是不同阶段；模拟 ACK 永远标为模拟。网页读取不会生成感知或完成动作。

硬件合同仍是一个 yaw 轴、头部触摸、触控屏、双麦声源方向和地磁换壳。方向不识别人；外壳不改变持续身份；没有摄像头或物理行走能力。传感不能覆盖人格、角色位置或世界事实。

## 接入与登记

首帧使用现有 `deskbot.device-hello.v0.1`，协议 `deskbot.bridge.v0.1`，绑定 `shaping-001`，声明音频格式及实际能力。小智原有 WebSocket hello 不兼容此协议，需要后续固件适配。

`config/body_devices.example.json` 是模板。本机副本 `config/body_devices.json` 被 Git 忽略，也可由 `DESKBOT_BODY_DEVICES_CONFIG` 指定路径。没有配置时设备不会获得身体动作或生活输入权限。`commissioned: true` 是完成实际协议、归位、方向与安全限幅调试后的本机登记，不能通过事件或 hello 自报开启。它不是密码认证；服务默认只监听本机。模拟 profiles 只在隔离测试进程注入，正式配置不接受 `simulated: true`。

本机 capabilities 对 hello 能力取交集。转头额外要求 `output.orientation.base_yaw` 与 `device.command.orientation.base_yaw` 都为 true；声明底座存在不等于已有命令消费者。换壳要求校准绑定同一 device_id、calibration_id、`calibrated: true`、磁签名 mappings 和已登记 shellCatalog。未知签名、缺校准或裸 shell_id 保持不确定。

## 上行

事件 envelope 使用 `deskbot.device-event.v0.1` / `device.event`，包含唯一 event_id、设备 ID、occurred_at、correlation_id、event_type、payload。尽量携带本机 monotonic_ms；重连产生新的服务端会话，序列不会跨会话误认为设备重放。

| event_type | payload | 作用 |
| --- | --- | --- |
| `sensor.touch` | `{region:"head"或"screen",phase:"press"}` | 15 秒身体注意；保留 10 分钟可自主考虑的短招呼 |
| `sensor.microphone_direction` | `{angle_degrees:-45,coordinate_frame:"calibrated_forward",confidence:0.9}` | 留意方向；条件允许才生成单轴朝向意图 |
| `shell.install.detected` | `{magnetic_code:"已校准签名",calibration_id:"本机校准ID"}` | 识别已登记壳或保留未知，持续身份不变 |

身体来源最长 5 分钟；即时动作只采用 10 秒内读数。未来、乱序、重复、释放触摸、低置信度、冷却、忙碌、离线及未终结动作都不能叠加转头。回执超时表示未收到确认。

触摸不抢占现实或虚拟事务。主角手头空闲、基本需要允许时，新增原地观察 45 秒的候选，权重 44。自主规则/模型可以选择，也可以继续自己的事；选中一次消费邀请。此候选不移动现实身体或虚拟地图位置。

## 朝向坐标与下行

新增 wire command type `orientation.base_yaw`，payload `{yaw_degrees:-45}`。角度是相对**归位后校准正前**的目标 yaw，负值左、正值右，服务和桥均限幅 `[-60,60]`。它是固定参考系中的目标，不能把相对当前麦阵的 DOA 当成该目标。

本地底座 DOA 以 90 为正前，0x07 是相对角处理；旧本体仍调用发送 0x01 的绝对角函数。后续适配必须先核验符号、归位和当前姿态估计，再合成固定参考系方向，或单独定义并审核相对角命令。参考系未知时服务保留听到方向的报告，明确不支持转头。

下行表情沿用 `render.expression`。本轮身体回合不产生假语音：声音输入的 ASR/TTS 仍走已存在的 voice sidecar，未启用时不宣称听懂或播报中文。

命令有稳定 command_id、绑定 device_id、来源回合、期限和不可变 payload。设备应按 command_id 幂等执行，拒绝过期与越界命令，归位未就绪时返回失败。失败 ACK 必须附 error.code。身体命令的公共 HTTP ACK 被拒绝，必须由绑定 WebSocket peer 回传。

## 回执的证明范围

`completed` 是设备执行报告，模拟设备回传 `result.simulated:true`。实际设备可回传 `{yaw_degrees:-45,measured:false}`：这是设备报告的开环角度，只进入 reported_degrees，实际角度仍未知。当前底座没有编码器，不能宣称已测得最终角度。缺角度、越界或与请求偏差超过 5° 都不产生已核验朝向。

只有实际登记设备、明确 `sensor.yaw_feedback` 能力和 `result.measured:true` 的合法角度反馈才能填 measured actual_degrees。添加这项能力需要真实测量硬件，不能由升级软件获得。

`GET /api/life/body` 返回只读身体状态与当前 WebSocket 连接；历史 hello 不是在线证据。独立 `/body-review.html` 展示来源、感知、意图、发送与回执，默认接隔离 4313。`POST /api/life/body/review` 只存在于 `scripts/review-body-perception.mjs` 的独立进程，正式服务不提供模拟写入口。
