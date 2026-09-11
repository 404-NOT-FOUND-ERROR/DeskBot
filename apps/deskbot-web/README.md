# DeskBot Web v0.2

这是聚形域的最小文字体验页：它只调用 `apps/deskbot-service` 已有的 HTTP API，不持有世界状态、不读取密钥，也不修改固件或 `foundry-bench/`。

## 启动

先启动 Node 服务（默认 `http://127.0.0.1:4311`），再在另一个 PowerShell：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\Jeremy\DeskBot\apps\deskbot-web'
npm.cmd start
```

浏览器打开 <http://127.0.0.1:4322>。

可选环境变量：`DESKBOT_WEB_PORT`（默认 `4322`）、`DESKBOT_WEB_HOST`（默认 `127.0.0.1`）、`DESKBOT_SERVICE_ORIGIN`（默认 `http://127.0.0.1:4311`）。

## 当前边界

- 文字对话和状态读取是真实调用；主界面的“现在”显示 `Asia/Shanghai` 服务器真实时间、来源新鲜度和连接状态。叙事时间仅在“背景世界”中显示，不代替真实日期/时刻。页面会显示旧世界快照、服务不可达和语音未配置等边界，不把它们伪装成成功。
- 研究视图展示事件 ID、状态 revision、provider、`tts_style`、事件/证据记录，并提供由 `/api/world/schema` 驱动的多源事件研究台。世界线、外部事件、天气、日历、用户偏好和设备上下文都通过 `/api/event` 写入，结果从 canonical world 与 mutation ledger 回读；页面不维护第二份世界状态。
- “多源场景验证”提供世界线、外界大事件、天气、用户兴趣和设备在场五个固定场景。每次从相同初态在隔离内存中运行，返回 revision、逐事件字段路径和 L1b 待测记录，不改写生产 SQLite，也不把结构变化计数冒充情境剖面距离。
- 语音区只保留 `shaping-neutral` 与风格计划。真实 ASR/CosyVoice TTS 和固件播放接入后，替换服务端 voice sidecar，不需要重做页面结构。
- 当前连接区显示时钟与天气 provider 状态，天气预报区只读展示短临、小时和每日缓存；页面不提供天气更新按钮，明确的天气/预报对话才会触发服务端按需请求，平时读取仍遵守各自 TTL。外部事件和自定义连接仍显示为未配置；研究台的手工注入是实验输入，不等同于真实网络连接器。
