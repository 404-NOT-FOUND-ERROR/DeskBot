# 本地配置

这里放只在本机使用的配置。`*.json` 中的真实 `api_key`、`*.env` 中的 token 和运行数据库都被 `.gitignore` 排除，不得提交到公开仓库。

## DeepSeek

首次 clone 后，在仓库根目录执行：

```powershell
Copy-Item config\llm_config.example.json config\llm_config.json
notepad config\llm_config.json
```

只填写自己的 DeepSeek key；`base_url` 和 `model` 按账号实际可用值填写。启动脚本默认优先读取 `config\llm_config.json`，也兼容当前工作站旧的 `DeskBotClaude\foundry-bench\llm_config.json`。

## 和风天气

如需国内实时天气：

```powershell
Copy-Item config\weather.env.example config\weather.env
notepad config\weather.env
```

将 `DESKBOT_WEATHER_URL` 的 `YOUR_API_HOST` 换成和风控制台提供的 API Host，并填入 token。启动时显式传入：

```powershell
.\scripts\start-local.ps1 -StartWeb -WeatherEnvFile (Resolve-Path config\weather.env)
```

不传 `-WeatherEnvFile` 时天气 connector 会安全地保持 `disabled`；数据库里的历史快照不代表当前 provider 已连接。

## 语音 sidecar

语音 sidecar 当前是无模型 fake 基线，不需要额外密钥。真实 ASR/TTS 接入时只通过 `DESKBOT_VOICE_SIDECAR_URL` 等服务端变量配置，详见 `documentation/variables.md` 和 `voice-sidecar/README.md`。
