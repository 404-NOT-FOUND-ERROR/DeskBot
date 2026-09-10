# DeskBot 软件架构

DeskBot 是一个绑定本机回环地址的小型持续世界服务。Node `deskbot-service` 是唯一的 canonical world、事件、短状态、证据、LLM 回合和设备 outbox 状态源；Web 只展示并调用它；Python voice-sidecar 只提供无状态 ASR/TTS 边界；ESP-VoCat 通过版本化协议接入。

## 运行结构

```text
Web / 固件 / RisuAI 对照适配器
          |
          v
Node deskbot-service :4311
  input -> world/state/evidence -> prompt -> LLM
  weather connector  -> canonical mutation
  output router      -> idempotent device outbox
  WebSocket /ws      -> device hello, audio, ACK
          |
          +--> SQLite WAL (唯一持久状态)
          +--> DeepSeek / OpenAI-compatible provider
          +--> QWeather (可选、服务端凭据)
          +--> Python voice-sidecar (可选、无状态)
```

技术栈：Node.js 24+、内置 `node:sqlite`、HTTP/自实现受限 WebSocket bridge、原生静态 Web、Python 3.10+ 标准库 sidecar。默认服务绑定 `127.0.0.1`；`DESKBOT_HOST` 或 `DESKBOT_WEB_HOST` 改成局域网地址前必须先补认证、设备认证和网络隔离。

## 信任边界

- 浏览器/固件 -> Node：输入是不可信事件；服务端做 schema、大小、幂等、设备绑定和世界 mutation 校验。
- Node -> LLM：提示文本和允许的上下文会离开本机；API key 只从服务端本地配置/环境变量读取。
- Node -> 天气 provider：只发送位置、查询和服务端 header；token 不进入网页、事件或日志。
- Node -> voice-sidecar：文本/音频通过本地 HTTP 发送；sidecar 不拥有世界写权限。
- Node -> 设备：只发送白名单命令和版本化状态；设备回 ACK，不能直接写角色 trait 或 canonical world。
- SQLite：应用服务可写，Web 不直接访问文件；WAL 文件属于运行数据，不提交 Git。

## 已知风险 / 假设

- 当前没有用户认证、会话、设备密钥或速率限制；只适合本机研究，不适合直接暴露公网或未经隔离的局域网。
- Web 代理响应头目前允许 `access-control-allow-origin: *`；在非回环部署前应收窄来源。
- DeepSeek 出站可用性取决于运行 PowerShell/网络策略；`fetch failed` 不代表角色规则失败。
- 当前 voice-sidecar 是 fake/model-free baseline，不代表真实中文 ASR/TTS 性能。
- 角色演化仍是 P2-P4 计划；当前 `miaowu-expression-v2` 是表达基线，不是长期 `role-state.v1`。

## Related Documents

- `documentation/flows.md`：关键数据流和副作用顺序。
- `documentation/permissions.md`：当前权限模型与上线前缺口。
- `documentation/variables.md`：配置、密钥和作用域。
- `documentation/automation.md`：LLM、天气、语音和设备自动化边界。
- `documentation/tests.md`：已有覆盖、计划测试和缺口。
- `research/聚形域-角色与世界决策记录_2026-09-09.md`：角色与世界设计决策。
- `research/development-roadmap-v0.3.md`：P1-P8 开发路线。
- `research/protocol/interaction-contract-v0.1.md`：固件桥接合同。
