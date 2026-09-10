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
- 服务与固件接口：[`research/protocol/interaction-contract-v0.1.md`](research/protocol/interaction-contract-v0.1.md)

`research/development-roadmap-v0.1.md` 与 `research/development-roadmap-v0.2.md` 是历史计划，不再作为当前排期依据。角色提示词或状态结构变更只有在自动测试和真实模型人工验收都通过后，才算完成。

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
