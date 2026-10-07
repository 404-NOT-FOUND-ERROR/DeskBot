# 本地配置

## 身体设备调试登记

`body_devices.example.json` 提供模板，真实副本 `body_devices.json` 被 Git 忽略。未配置或 `commissioned:false` 时不授予身体感知/动作权限；USB 接上小智固件不代表已经完成 DeskBot 协议适配。完成后续实机归位、方向、能力和换壳校准后再登记。服务也支持 `DESKBOT_BODY_DEVICES_CONFIG` 指定文件。字段与证明边界见 [身体协议](../research/protocol/body-perception-v1.md)。隔离模拟从独立脚本启动，不写入正式配置。

这里放只在本机使用的配置。`*.json` 中的真实 `api_key`、`*.env` 中的 token 和运行数据库都被 `.gitignore` 排除，不得提交到公开仓库。

## DeepSeek

首次 clone 后，在仓库根目录执行：

```powershell
Copy-Item config\llm_config.example.json config\llm_config.json
notepad config\llm_config.json
```

只填写自己的 DeepSeek key；`base_url` 和 `model` 按账号实际可用值填写。启动脚本默认优先读取 `config\llm_config.json`，也兼容当前工作站旧的 `DeskBotClaude\foundry-bench\llm_config.json`。

## 天气与城市

服务支持 Open-Meteo 与和风天气。新下载仓库没有本机城市配置；可以创建 `config/weather.local.env`，以下是上海 Open-Meteo 的无密钥配置示例：

```dotenv
DESKBOT_WEATHER_ENABLED=true
DESKBOT_WEATHER_PROVIDER=open-meteo
DESKBOT_WEATHER_LATITUDE=31.2304
DESKBOT_WEATHER_LONGITUDE=121.4737
DESKBOT_WEATHER_LOCATION=上海
DESKBOT_WEATHER_TIMEZONE=Asia/Shanghai
```

启动脚本会加载已有的 `config/weather.local.env`。替换城市时同时更新坐标和名称。世界生活使用上海日历时区；天气来源与有效时间在界面分别显示。

### 和风天气

如需国内实时天气：

```powershell
Copy-Item config\weather.env.example config\weather.env
notepad config\weather.env
```

将 `DESKBOT_WEATHER_URL` 的 `YOUR_API_HOST` 换成和风控制台提供的 API Host，并填入 token。启动时显式传入：

```powershell
.\scripts\start-local.ps1 -StartWeb -WeatherEnvFile (Resolve-Path config\weather.env)
```

不传 `-WeatherEnvFile` 时，启动脚本会读取已有的 `config\weather.local.env`；没有本地配置文件时保留已有天气环境变量，新下载且未配置的环境默认关闭天气。显式参数优先于该默认文件；数据库里的历史快照不代表当前 provider 已连接。

本工作站按用户指定城市配置了上海 Open-Meteo 天气，保存在忽略提交的 `config\weather.local.env`，不需要天气密钥。城市中心坐标只用于天气请求，不读取设备精确位置。

## 新闻与区域空气质量

`scripts/start-local.ps1` 默认开启 NASA Science RSS 新闻和 Open-Meteo/CAMS 区域空气质量连接器，均不需要额外密钥。新闻是有来源和时效的科学消息，空气质量是区域资料，不能替代桌边传感器实测。它们进入有限输入折射与生活候选，不直接改写角色或世界事实。可用服务端变量 `DESKBOT_NEWS_ENABLED=0`、`DESKBOT_AIR_ENABLED=0` 关闭；配置细节见 [变量参考](../documentation/variables.md)。

## 语音 sidecar

语音 sidecar 当前是无模型 fake 基线，不需要额外密钥。真实中文 ASR/TTS 尚未接通；第六阶段的虚拟角色采用不会启用真实声音。接入时通过 `DESKBOT_VOICE_SIDECAR_URL` 等服务端变量配置，详见 [变量参考](../documentation/variables.md) 和 [语音接口基线](../voice-sidecar/README.md)。
