# DeskBot / 聚形域软件端

这是《聚形域》桌宠实验装置的软件工作区。当前目标不是做一个通用聊天产品，而是跑通并记录以下可审计链路：

```text
多源输入
  -> Node 持续世界与角色状态
  -> DeepSeek 文本生成
  -> 文字 / 表情 / TTS 表达意图
  -> Web 与 ESP-VoCat 客户端
```

## 目录

- `apps/deskbot-service`：唯一在线状态源、SQLite 持久化、世界逻辑、LLM 编排、天气连接器和设备桥。
- `apps/deskbot-web`：研究与体验界面，只读取和调用服务端 API，不保存第二份世界状态。
- `voice-sidecar`：无状态 ASR/TTS 边界；当前基线不代表真实中文模型性能。
- `research`：研究协议、实验设计与接口说明。
- `tmp`：源码审阅副本、下载和临时产物，不进入 Git。

角色当前阶段名为“喵呜”。“聚形域”是它的持续世界背景，不是每句话都必须使用的修辞。用户输入可以影响角色方向，但不能用一句话直接改写角色、外壳或世界事实。

## 当前执行基线

- 工程架构与交接索引：[`documentation/architecture.md`](documentation/architecture.md)
- 当前路线图：[`research/development-roadmap-v0.3.md`](research/development-roadmap-v0.3.md)
- 角色与世界决策记录：[`research/聚形域-角色与世界决策记录_2026-09-09.md`](research/聚形域-角色与世界决策记录_2026-09-09.md)
- 喵呜角色验收：[`research/miaowu-expression-acceptance-v0.1.md`](research/miaowu-expression-acceptance-v0.1.md)
- 喵呜角色表演：[`research/miaowu-roleplay-bible-v0.1.md`](research/miaowu-roleplay-bible-v0.1.md)
- 喵呜 Soul 人格基线：[`research/soul/miaowu-soul-v0.1.md`](research/soul/miaowu-soul-v0.1.md)
- GitHub P1 里程碑：[`research/milestones/software-baseline-p1.md`](research/milestones/software-baseline-p1.md)
- P2 奇幻吸引里程碑：[`research/milestones/p2-fantasy-pull-v0.1.md`](research/milestones/p2-fantasy-pull-v0.1.md)
- 服务与固件接口：[`research/protocol/interaction-contract-v0.1.md`](research/protocol/interaction-contract-v0.1.md)

`research/development-roadmap-v0.1.md` 与 `research/development-roadmap-v0.2.md` 是历史计划，不再作为当前排期依据。角色提示词或状态结构变更只有在自动测试和真实模型人工验收都通过后，才算完成。

## 首次配置

需要 Node.js 24 或更高版本；只有运行 voice-sidecar 测试或启动 sidecar 时才需要 Python 3.10+。

从公开仓库 clone 后，在仓库根目录创建本机配置副本：

```powershell
Copy-Item config\llm_config.example.json config\llm_config.json
notepad config\llm_config.json
```

只在 `config\llm_config.json` 填写自己的 DeepSeek key。真实配置文件已被 Git 忽略，不能提交。

需要和风天气时再创建：

```powershell
Copy-Item config\weather.env.example config\weather.env
notepad config\weather.env
```

将 `DESKBOT_WEATHER_URL` 的 `YOUR_API_HOST` 换成和风控制台提供的 API Host，并把 token 填入本机文件。天气文件只允许 `DESKBOT_WEATHER_*` 变量，启动时通过 `-WeatherEnvFile` 显式加载。配置字段、优先级和 v7/v1 选择见 [`config/README.md`](config/README.md) 与 [`documentation/variables.md`](documentation/variables.md)。

启动前不需要设置 `setx`，也不要把 key 放进网页、事件 JSON、命令行 URL 或日志。`scripts/start-local.ps1` 优先读取仓库内 `config\llm_config.json`；仅为兼容当前工作站，才回退到 `DeskBotClaude\foundry-bench\llm_config.json`。公开 clone 不应依赖这个旧路径。

## 本地运行

先启动服务：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\Jeremy\DeskBot'
.\scripts\start-local.ps1 -StartWeb
```

脚本会从本地 `llm_config.json` 启用 DeepSeek，检查 `4311/4322` 端口，启动后确认两个进程各自持有监听端口并通过 `/health`。需要天气时使用：

```powershell
.\scripts\start-local.ps1 -StartWeb -WeatherEnvFile (Resolve-Path config\weather.env)
```

若端口已占用会直接失败，不会把旧进程误认成新版本。也可以分别启动服务和 Web：
## 本地运行

需要 Node.js 24 或更高版本。先启动服务：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\Jeremy\DeskBot\apps\deskbot-service'
npm.cmd start

```

再启动 Web 页面：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\Jeremy\DeskBot\apps\deskbot-web'
npm.cmd start
```

浏览器访问 <http://127.0.0.1:4322/>。DeepSeek、QWeather 和语音模型均需由本机环境变量或本地配置显式启用；密钥不得写入源码、网页、日志或 Git。

运行检查：`GET /health` 只证明 Node 服务已就绪；`GET /api/connectors/weather` 以本次进程的配置为准。若聊天返回 `502` 且 `error=llm_transport_error`，表示请求没有拿到 DeepSeek HTTP 响应，通常是当前 PowerShell 的网络/TLS/代理策略；这不是角色提示词或世界状态错误。若天气显示 `provider=open-meteo`、`status=disabled`，表示本次进程没有加载 QWeather 环境文件，不代表旧 SQLite 快照仍可当作实时数据。带 QWeather 配置启动：

```powershell
.\scripts\start-local.ps1 -StartWeb -WeatherEnvFile 'C:\path\to\weather.env'
```

`weather.env` 只能包含 `DESKBOT_WEATHER_*` 变量；脚本和状态接口都不会打印 token。

停止本次本地服务：

```powershell
.\scripts\stop-local.ps1
```

## 测试与公开打包

在提交或打包前，从仓库根目录执行：

```powershell
Set-Location apps\deskbot-service
npm.cmd test
Set-Location ..\..\voice-sidecar
python -m unittest discover -s tests -v
Set-Location ..
git diff --check
git check-ignore -v config\llm_config.json config\weather.env apps\deskbot-service\data\deskbot.sqlite
```

生成公开源码包（不包含 `.git`、`tmp`、依赖、SQLite/WAL、日志、音频、模型、真实配置和 `dist`）：

```powershell
.\scripts\package-source.ps1
```

默认输出到 `dist\DeskBot-source-<UTC 时间>.zip`。可用 `-OutputDirectory` 和 `-ArchiveName` 指定位置/文件名；脚本在压缩前会再次按路径规则过滤敏感和运行时文件，并输出包含文件数量和 SHA-256 的 manifest。`dist/` 本身被 Git 忽略，源码包需通过 GitHub Release 或其他制品渠道单独发布。

## GitHub 交付边界

仓库公开基线只包含可审阅源码、接口合同、研究文档、配置模板、测试和启动脚本。真实 key、SQLite、音频/模型缓存、下载的第三方源码、固件产物和本机日志不属于公开包。CI 会在涉及服务、sidecar、配置模板、文档或脚本时运行对应回归；当前 workflow 不调用 DeepSeek、QWeather 或真实硬件。

## 提交门槛

每次服务端修改至少执行：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\Jeremy\DeskBot\apps\deskbot-service'
npm.cmd test
```

涉及用户体验时，还要在真实 DeepSeek 下检查任务、事实、陪伴、玩笑与边界场景。自动测试只能证明合同没有破坏，不能替代角色效果验收。

## GitHub 使用边界

建议把本工作区作为软件仓库根目录。提交 `apps`、`voice-sidecar`、`research` 和必要的非敏感接口文档；不提交 SQLite、音频、模型缓存、密钥、本地配置、下载副本或生成式硬件产物。固件由独立 agent 维护，双方只通过版本化接口合同对齐。

仓库启用分支保护后，合并条件至少包括 `DeskBot service tests` 通过、无密钥变更、接口变更附迁移说明，以及用户可见行为附人工验收记录。
