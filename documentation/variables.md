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

## 预上线检查

- [ ] `llm_config.json`、`.env`、QWeather token 不在 Git tracked files。
- [ ] `/api/connectors/weather` 只返回 `credential_configured`，不返回 token。
- [ ] provider/sidecar 错误不包含响应 body、Authorization 或 API key。
- [ ] 服务和 Web 仍绑定回环，或已有 TLS、认证、设备密钥、速率限制和 Origin allowlist。
- [ ] 轮换一次 DeepSeek/QWeather key 后完成 health、真实请求和失败路径验证。
