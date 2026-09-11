# ESP-VoCat v1.2 固件审计 `v0.1`

核对日期：2026-08-21

## 结论先行

喵伴已经组装完成；按你提供的刷机信息，当前刷入的 ESP-Brookesia Coze 固件可以作为**硬件 bring-up 基线**，具体版本仍应以设备串口日志或 Launchpad 记录为准。截图中的 OpenAI 条目也确实对应一个可下载的合并镜像，但它不是 `release/v0.6/products/speaker` 的可复现源码产物，而且使用旧的 OpenAI Realtime Beta WebRTC 信令。截至本次核对，不应把它作为毕设主线。

毕设主线仍保持：

```text
PC/云端 DeskBot Service（唯一编排与状态真相）
          -> 输出路由 / 设备协议桥接
          -> ESP-CLAW + VoCat（薄设备执行层）
```

RisuAI 只提供“文本 -> 情绪标签 -> 立绘”的机制参考，SillyTavern 只提供“条件触发 -> prompt 选择性注入”的机制参考；两者都不是运行依赖。设备端固件不拥有角色状态、evidence ledger 或外壳身份权威。

## 1. 截图中的两个 Launchpad 条目

截图显示 Launchpad 使用的是外部清单，而不是 `esp-brookesia` 官方页面的默认清单：

- 清单：<https://lzw655.github.io/launchpad_test/launchpad.toml>
- 镜像基址：<https://dl.espressif.com/AE/esp-dev-kits/>

清单当前列出的前两个条目为：

| 条目 | 含义 | 实测镜像 | SHA-256 |
|---|---|---:|---|
| `speaker_0_12_5_ctm_esp_vocat_1_2` | Coze，硬件 v1.2，软件 v0.12.5 | 13,550,588 B | `85d37aabce72d8e1d02e4c49108328485f32abb7c8e24f0686c66b8ee99c28ac` |
| `speaker_openai_0_2_3_ctm_esp_vocat_1_2` | OpenAI，硬件 v1.2，软件 v0.2.3 | 12,985,762 B | `8b764fd73b2fe9484ad065962fcf57fb4ea9acb24d2d97c2b593357ba9e3bddb` |

两个 URL 在 2026-08-21 均返回 HTTP 200。`launchpad_test` 仓库保存的是 TOML 清单，不保存 `.bin`；所以在 GitHub 源码或该清单仓库里找不到镜像本身，并不代表镜像不存在。

## 2. 为什么 GitHub 源码里没有对应 OpenAI Speaker 工程

`esp-brookesia` 的 `release/v0.6/products/speaker` 目录只包含 Coze 方案：

- `main/Kconfig.projbuild` 只有 `EXAMPLE_COZE_AGENT_*` 配置；
- `main/CMakeLists.txt` 只处理 Coze 相关资源；
- 官方 README 只描述 VoCat + Coze；
- `release/v0.6` 根目录没有 `service/agent/brookesia_agent_openai`。

该分支的 Launchpad/CI 工作流构建的是 `products/speaker`，将构建结果合并成镜像后发布到外部下载站，不把生成的二进制提交到源码仓库。后来的 `release/v0.7`/`master` 才出现独立的 OpenAI agent 组件和 `examples/agent/chatbot`。因此需要区分：

1. **OpenAI `.bin` 已被公开托管**：成立；
2. **可以从 v0.6 Speaker 源码复现这个 `.bin`**：不成立；
3. **固件所用的 OpenAI 接口仍可用**：不能据此成立。

## 3. OpenAI 镜像的实际协议与过时风险

对镜像做静态字符串核对可见：

- `/sdcard/openai_setting.json`；
- 配置字段主要是 `model`、`api_key`；
- `https://api.openai.com/v1/realtime?model=%s`；
- WebRTC SDP、DTLS/SRTP、DataChannel；
- Opus 音频和 Realtime 事件。

这不是普通的 `/v1/chat/completions` 或可改 `base_url` 的 OpenAI-compatible 客户端。

更重要的是，Espressif [issue #104](https://github.com/espressif/esp-brookesia/issues/104) 记录了旧 Beta 信令在 2026-05-07 关闭后的实机结果：旧的 SDP POST 会收到 `400 beta_api_shape_disabled`，随后 agent 进入约 30 秒重启循环。迁移到 GA 需要 ephemeral token、`/v1/realtime/calls` multipart SDP/session 流程，不能只替换 API 地址。当前 Launchpad 的 `0.2.3` 镜像仍包含旧 endpoint 字符串，因此不应把它当作稳定的 OpenAI 固件。

另外，公开 issue #86 曾报告该 OpenAI 版本无音频输出。即使以后只做验证，也要把它视为未经当前硬件批次和当前 API 验证的实验镜像。

## 4. 两个镜像不能直接互换的原因

两者都是 ESP32-S3 合并镜像，但分区布局不同：

- Coze：包含 `model` 分区，应用从约 `0xB0000` 开始；
- OpenAI：没有同样的 `model` 分区，`factory` 从约 `0x10000` 开始；
- 两者的资源分区和应用版本也不同。

因此不要把单个 app bin、分区表或旧的 NVS 文件混搭。任何刷写前都要保存完整 flash 备份、当前串口日志和 SD 卡内容。

## 5. 对毕设的决策

### 当前 Coze 固件：保留，但只做基线

用于验证：

- 屏幕、触摸、麦克风、扬声器、电池和 Wi-Fi；
- 喵伴原厂语音交互是否稳定；
- 外壳拆装前的声学、温升、续航和姿态基准。

它不承担 DeskBot 的角色状态或 LLM 编排，也不应成为论文中的唯一软件架构。

### OpenAI `0.2.3` 固件：不刷入主机

它可以作为协议研究和固件取证样本，但不作为：

- DeskBot 的设备接入方案；
- DeskBot Service 的后端；
- 论文演示的稳定依赖；
- 可复现构建基线。

### 若必须验证设备端 OpenAI

优先研究 `release/v0.7/examples/agent/chatbot` + `esp_vocat_board_v1_2` 的源码构建，并确认其 OpenAI agent 已迁移到 GA Realtime API。即使验证成功，它仍只是设备端语音 agent 参考，不替代 DeskBot Service 的角色与状态主线。

### 推荐的最终设备路线

在完成完整备份后，优先评估 ESP-CLAW 的 VoCat v1.2 board runtime/Lua 适配。它更适合作为薄设备执行层：由 DeskBot Service 在电脑或云端完成 LLM、ASR、TTS 和角色状态，VoCat 只负责采集、表情、播放、转向和可记录的执行反馈。若 ESP-CLAW 实机刷写或音频能力暂时受阻，先用当前 Coze 固件完成硬件测量，再用假设备/PC 音频完成 G1，不让旧 OpenAI 镜像阻塞研究。

## 6. 刷写前记录清单

- 记录当前固件名称、版本、刷写时间和 Launchpad 清单 URL；
- 保存完整 flash dump，至少保存分区表、NVS 和应用镜像；
- 备份 SD 卡文件及设备序列号，尤其是任何 `openai_setting.json` 或设备配置；
- 保存 30 分钟基线测试：开机、Wi-Fi、触摸、录音、播放、屏幕和重启；
- 任何新镜像先在独立实验记录中写入 SHA-256，再刷写并记录回滚方式；
- 不把含 API key 的配置、串口日志或完整 flash dump提交到公开仓库。

## 参考链接

- [ESP-Brookesia release/v0.6 Speaker](https://github.com/espressif/esp-brookesia/tree/release/v0.6/products/speaker)
- [v0.6 Speaker Kconfig](https://github.com/espressif/esp-brookesia/blob/release/v0.6/products/speaker/main/Kconfig.projbuild)
- [ESP-Brookesia release/v0.7 chatbot](https://github.com/espressif/esp-brookesia/tree/release/v0.7/examples/agent/chatbot)
- [OpenAI agent API migration issue #104](https://github.com/espressif/esp-brookesia/issues/104)
- [外部 Launchpad 清单](https://lzw655.github.io/launchpad_test/launchpad.toml)
