# 配置与密钥

所有变量按“谁读取、是否敏感、默认值和部署边界”记录。密钥不得进入浏览器、SQLite、事件 payload、日志、Git 或屏幕。

| 变量 | 使用者 | 作用域 | 敏感性/来源 | 轮换与上线要求 |
|---|---|---|---|---|
| `DESKBOT_LLM_PROVIDER` | Node | server | 非敏感；env | 显式 `deepseek`/`openai-compatible`，默认 fake |
| `DESKBOT_LLM_CONFIG` | Node | server | 路径敏感；本地 JSON | 文件 ACL 仅用户可读；换 key 后重启 |
| `DESKBOT_LLM_API_KEY` | Node | server | 高敏感；env | 不打印；provider 轮换后重启 |
| `DESKBOT_LLM_BASE_URL` / `DESKBOT_LLM_MODEL` | Node | server | 非密钥配置 | 与 provider smoke 一起锁定 |
| `DESKBOT_WEATHER_TOKEN` | Node weather connector | server | 高敏感；env | QWeather key 轮换；状态只显示布尔值 |
| `DESKBOT_WEATHER_*`（URL、位置、TTL、auth mode） | Node weather connector | server | 位置为上下文数据；URL/TTL 非密钥 | v7/v1 与 `api-key/bearer` 必须和账号匹配 |
| `DESKBOT_HOST` / `DESKBOT_PORT` / `DESKBOT_DB_PATH` / `DESKBOT_WS_PATH` | Node | server | 非敏感，但影响暴露面 | 默认回环；改变 host 需安全评审 |
| `DESKBOT_VOICE_SIDECAR_URL`、`*_ASR_PATH`、`*_TTS_PATH`、`*_TIMEOUT_MS` | Node | server | 非密钥 endpoint/运行参数 | 只连可信本地 sidecar |
| `DESKBOT_WEB_HOST` / `DESKBOT_WEB_PORT` / `DESKBOT_SERVICE_ORIGIN` | Web | server | 非敏感；影响代理边界 | 默认回环；Origin 不应长期为 `*` |

## 配置优先级与启动脚本

推荐从仓库根目录运行 `scripts/start-local.ps1 -StartWeb`。LLM 配置优先级是：

1. `-LlmConfigPath` 显式传入的本地 JSON；
2. 仓库内 `config/llm_config.json`；
3. 当前工作站兼容回退路径 `DeskBotClaude/foundry-bench/llm_config.json`；
4. 没有可用文件则拒绝启动。

公开 clone 只应使用第 1 或第 2 项。脚本会设置 `DESKBOT_LLM_PROVIDER=deepseek` 和 `DESKBOT_LLM_CONFIG`，但不会把 `api_key` 复制到环境变量或命令行参数。

天气配置不会从旧路径回退：必须用 `-WeatherEnvFile` 显式传入本地 `weather.env`，且该文件只能定义 `DESKBOT_WEATHER_*` 变量。token 只进入服务子进程环境，不进入网页、事件或日志。不传天气文件时 connector 明确为 `disabled`，不能把历史 SQLite 快照当作实时连接成功。

```powershell
.\scripts\start-local.ps1 -StartWeb -LlmConfigPath (Resolve-Path config\llm_config.json) -WeatherEnvFile (Resolve-Path config\weather.env)
```

脚本在服务/Web 真正就绪前不返回成功，并检查本次 PID 是否持有监听端口；停止使用 `scripts/stop-local.ps1`。配置模板见 `config/README.md`。

聊天 provider 错误的公开字段是 `error`、`message`、`retryable` 和安全的 `provider_status`。网络未收到 HTTP 响应时 `provider_status=null`；不把上游响应 body、Authorization 或 API key 放进错误。

## 预上线检查

- [ ] `llm_config.json`、`.env`、QWeather token 不在 Git tracked files。
- [ ] `/api/connectors/weather` 只返回 `credential_configured`，不返回 token。
- [ ] provider/sidecar 错误不包含响应 body、Authorization 或 API key。
- [ ] 服务和 Web 仍绑定回环，或已有 TLS、认证、设备密钥、速率限制和 Origin allowlist。
- [ ] 轮换一次 DeepSeek/QWeather key 后完成 health、真实请求和失败路径验证。
