# 权限与信任边界

当前原型没有用户登录或多租户角色。权限主要由绑定地址、代码路径、事件 schema、设备绑定和白名单 mutation 实现，而不是 token/数据库 row-level security。该限制必须在局域网/公网部署前解决。

| 资源/操作 | Web 本机 | 已绑定设备 | 外部 provider | LLM/sidecar | 备注 |
|---|---|---|---|---|---|
| 读取 world/context/state | 允许 | 不直接读取 | 无 | 只读 prompt | HTTP 路由目前无认证 |
| 写入 conversation.input | 允许 | 允许 | 不允许 | 不允许 | schema、大小、event_id 幂等 |
| 写入 world mutation | 允许通过 API | 仅设备事实路径 | connector 通过服务 | 不允许 | action 白名单和字段范围 |
| 写入 role/world 永久身份 | 不允许直接 | 不允许 | 不允许 | 不允许 | 当前尚未实现长期 role-state 提交 |
| 读取/刷新天气 | 允许请求 | 可由对话触发 | provider 仅被服务调用 | 获得已筛选上下文 | token 仅 server env |
| 生成 LLM 回复 | 允许触发 | 可经设备回合触发 | provider 执行 | provider 执行 | provider 不能写 world |
| 生成/读取音频工件 | 允许通过服务 | 设备消费 | 无 | sidecar 返回候选音频 | 需 hash/格式校验 |
| ACK device command | 不允许冒充设备 | 仅相同 device_id | 不允许 | 不允许 | bridge 校验绑定和幂等 |

## 当前未实现的上线权限

- 用户身份、会话、CSRF、设备注册密钥和设备撤销。
- API scope/role（研究员、设备、只读展示）。
- Origin allowlist、反向代理 TLS、请求速率限制和审计登录。
- 独立数据库账号/文件 ACL 分层。

因此 `DESKBOT_HOST=0.0.0.0` 或 Web/服务端口转发只能在补齐上述控制并完成负向测试后使用。
