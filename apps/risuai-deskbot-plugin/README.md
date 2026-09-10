# DeskBot Bridge 插件

这是 RisuAI API v3 的机制对照适配器，不属于最终系统的主运行链：

- 在 RisuAI 动作区注册“DeskBot 健康检查”；
- 监听用户输入和最终助手回复，异步 POST 到 DeskBot Service 的 `/api/chat`；
- 在请求模型前读取 DeskBot 的临时 `[DESKBOT_STATE]` 上下文，追加为 system message；
- 使用 `Risuai.nativeFetch`，网络失败时只记录警告，不阻塞 RisuAI 生成；
- 不在插件内分析情绪、不计算 CAPS、不提交长期角色状态、不直接控制硬件；
- 不保存 API key 或聊天记录。

## 导入

1. 在 DeskBot Service 目录启动服务：`npm start`。
2. 在 RisuAI Desktop 的插件设置中导入 `deskbot-bridge.js`。
3. 若插件参数可编辑，`service_url` 保持 `http://127.0.0.1:4311`。
4. 点击动作区的“DeskBot 健康检查”。

成功标准：按钮变为“DeskBot 已连接 0.1.0”，并在控制台看到 `Chat event accepted`。事件可在 `GET /api/events` 回放。

此适配器保留用于核对 RisuAI 原生情绪机制；DeskBot Chat/LLM Gateway 才是研究主线。不要以它作为 G1 的必经运行时。
