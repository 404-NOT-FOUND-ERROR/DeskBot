# 配置与密钥 · v0.5 第六阶段

所有变量按“谁读取、是否敏感、默认值和部署边界”记录。密钥不得进入浏览器、SQLite、事件 payload、日志、Git 或屏幕。

生产入口默认 `DESKBOT_TIME_MODE=realtime`、`DESKBOT_TIME_ZONE=Asia/Shanghai`。研究运行必须通过 `DESKBOT_DB_PATH` 或脚本自己的存档路径选择独立数据库；普通快进回放显式使用 `simulation`。角色实际试做与阶段实验仍需验证 `real_time` 合同，由独立脚本提供可控时钟，不改变正式存档的时间。已有 `real_time` 存档不会因切换环境变量退回模拟；其时区在迁移时确定，避免改变日历及任务历史。

| 变量 | 使用者 | 作用域 | 敏感性/来源 | 轮换与上线要求 |
|---|---|---|---|---|
| `DESKBOT_TIME_MODE` | Node | server | 非敏感；默认 `realtime` | `simulation` 只用于独立研究存档 |
| `DESKBOT_TIME_ZONE` | Node | server | 非敏感；默认 `Asia/Shanghai` | UTC 持久时间按当地日期与昼夜显示；有效 IANA 时区 |
| `DESKBOT_LLM_PROVIDER` | Node | server | 非敏感；env | 直接启动默认 fake；组合脚本设置 `deepseek`；也支持 `openai-compatible` |
| `DESKBOT_LLM_CONFIG` | Node | server | 路径敏感；本地 JSON | DeepSeek 模式每次调用重读文件；更改环境变量或配置路径后重启 |
| `DESKBOT_LLM_API_KEY` | Node | server | 高敏感；env | 不打印；provider 轮换后重启 |
| `DESKBOT_LLM_BASE_URL` / `DESKBOT_LLM_MODEL` | Node | server | 非密钥配置 | 与 provider smoke 一起锁定 |
| `DESKBOT_WEATHER_TOKEN` | Node weather connector | server | 高敏感；env | QWeather key 轮换；状态只显示布尔值 |
| `DESKBOT_WEATHER_*`（provider、URL、位置、TTL、auth mode） | Node weather connector | server | 位置为上下文数据；URL/TTL 非密钥 | 支持 Open-Meteo 无密钥来源；QWeather endpoint 和认证模式按账号配置 |
| `DESKBOT_NEWS_ENABLED` / `DESKBOT_AIR_ENABLED` | Node external connectors | server | 非敏感；env | 组合脚本默认 `1`；直接启动仅 `1` 开启，`0` 关闭；无需额外密钥 |
| `DESKBOT_BODY_DEVICES_CONFIG` | Node device bridge | server | 本地调试登记路径；默认 `config/body_devices.json` | 需明确实机能力与调试状态，USB 连接不等于已适配 |
| `DESKBOT_HOST` / `DESKBOT_PORT` / `DESKBOT_DB_PATH` / `DESKBOT_WS_PATH` | Node | server | 非敏感，但影响暴露面 | 默认回环；改变 host 需安全评审 |
| `DESKBOT_VOICE_SIDECAR_URL`、`*_ASR_PATH`、`*_TTS_PATH`、`*_TIMEOUT_MS` | Node | server | 非密钥 endpoint/运行参数 | 只连可信本地 sidecar |
| `DESKBOT_WEB_HOST` / `DESKBOT_WEB_PORT` / `DESKBOT_SERVICE_ORIGIN` | Web | server | 非敏感；影响代理边界 | 默认回环；Origin 不应长期为 `*` |

## 配置优先级与启动脚本

推荐从仓库根目录运行 `scripts/start-local.ps1 -StartWeb -StartWorld`，启动服务、文字研究页和 3D 世界。首次使用需安装 `apps/jev-town-client` 的依赖。启动脚本选择 LLM 配置文件的顺序是：

1. `-LlmConfigPath` 显式传入的本地 JSON；
2. 仓库内 `config/llm_config.json`；
3. 脚本保留的旧工作站 `DeskBotClaude/foundry-bench/llm_config.json` 兼容路径（仅在仓库文件缺失时检查，不是新 clone 的配置方式）；
4. 没有可用文件则拒绝启动。

公开 clone 使用第 1 或第 2 项。脚本会设置 `DESKBOT_LLM_PROVIDER=deepseek` 和 `DESKBOT_LLM_CONFIG`，但不会把 `api_key` 复制到环境变量或命令行参数。服务读取配置时，已有 `DESKBOT_LLM_BASE_URL`、`DESKBOT_LLM_API_KEY`、`DESKBOT_LLM_MODEL` 分别优先于 JSON 中的同名值；旧环境变量可能覆盖刚保存的文件配置。

DeepSeek 模式会在调用与状态读取时重新加载当前文件；更换文件中的密钥、模型或端点后保存即可，连通状态需以新调用为准。环境变量、provider 类型和配置路径变更仍需重启。兼容 provider 的直接启动按其配置入口初始化，不能把 DeepSeek 文件重读行为当作所有模式的保证。

天气文件选择顺序是：

1. `-WeatherEnvFile` 显式指定的本地文件；
2. 未传参数时，仓库已有的 `config/weather.local.env`；
3. 没有文件则保持当前进程中已有的天气环境变量；新 clone 的未配置环境默认关闭天气。

天气文件只能定义 `DESKBOT_WEATHER_*` 变量，加载后覆盖同名进程环境值。天气不再回退旧工作站路径，`config/weather.env` 需要显式传入。token 只进入服务子进程环境，不进入网页、事件或日志。Open-Meteo 不需要 token；QWeather 需要相应凭据。历史 SQLite 快照不代表当前实时连接成功。

```powershell
.\scripts\start-local.ps1 -StartWeb -StartWorld

# 显式选择另一份本地天气配置，例如和风天气
.\scripts\start-local.ps1 -StartWeb -StartWorld -WeatherEnvFile (Resolve-Path config\weather.env)
```

以上两条是不同配置的启动示例，选择一条使用；不要在已有服务占用端口时重复启动。脚本在服务/Web/3D 客户端真正就绪前不返回成功，并检查本次 PID 是否持有监听端口；停止使用 `scripts/stop-local.ps1`。配置模板见 `config/README.md`。

组合脚本默认启用 NASA Science RSS 新闻和 Open-Meteo/CAMS 区域空气资料，已有 `DESKBOT_NEWS_ENABLED` / `DESKBOT_AIR_ENABLED` 不被覆盖。设为 `0` 可关闭。空气资料使用天气配置坐标；没有坐标时当前入口回退上海城区坐标，不能把它解释为设备位置或传感器实测。

如已有 `HTTP_PROXY` / `HTTPS_PROXY`，组合脚本保留它们；都没有时会探测本机 `127.0.0.1:7897`，可用才设置代理，并启用 Node 环境代理。代理属于本机网络配置，公开仓库不保存访问凭据。

聊天 provider 错误的公开字段是 `error`、`message`、`retryable` 和安全的 `provider_status`。网络未收到 HTTP 响应时 `provider_status=null`；不把上游响应 body、Authorization 或 API key 放进错误。

## 预上线检查

- [ ] `llm_config.json`、`.env`、QWeather token 不在 Git tracked files。
- [ ] `/api/connectors/weather` 只返回 `credential_configured`，不返回 token。
- [ ] provider/sidecar 错误不包含响应 body、Authorization 或 API key。
- [ ] 服务和 Web 仍绑定回环，或已有 TLS、认证、设备密钥、速率限制和 Origin allowlist。
- [ ] 轮换一次 DeepSeek/QWeather key 后完成 health、真实请求和失败路径验证。
