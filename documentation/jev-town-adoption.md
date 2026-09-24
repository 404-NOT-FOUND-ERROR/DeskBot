# Jev Town 接入记录

## 目的

DeskBot 采用 CeciliaW888/jev-town 作为世界体验客户端的 3D 视觉与交互基线。它把小镇地图、地点标记、NPC 面板和可观察的行动交互迁移到 DeskBot 的持续世界中。它不是第二套世界状态；DeskBot service 仍是唯一事实源。

## 来源与授权

- 上游仓库：[CeciliaW888/jev-town](https://github.com/CeciliaW888/jev-town)
- 本地基线验证提交：`40f82dd1c6e4916b8be0c0932c42eaaaf56f569c`
- 2026-09-24，项目所有者报告已从该项目开发者处获得直接确认，可修改并再发布源代码，以及项目随附的 3D 模型、纹理、字体、图标、音乐和其他第三方素材。

本文件记录项目所有者报告的授权事实，不是开发者签署的许可证，也不自动改变依赖项的许可证。公开发布前必须：

1. 将开发者书面确认或可核验链接随发布物保存；
2. 保留上游版权、作者归属和原始 notices；
3. 对 npm 依赖、字体、音乐、图标和模型逐项建立许可证和来源清单；
4. 让最终仓库的 LICENSE 与实际授权范围一致。

授权记录副本见 [apps/jev-town-client/AUTHORIZATION.md](../apps/jev-town-client/AUTHORIZATION.md)。

## 当前架构

```text
Jev Town 3D client :5173
  |  GET /api/world/map
  |  GET /api/life/world
  |  POST /api/event (npc_action)
  v
DeskBot service :4311
  |  canonical world / revision
  |  schema + adjacency + stale-state validation
  |  SQLite persistence + mutation ledger
  +-- DeepSeek / QWeather / world-life / role evolution

DeskBot web :4322 remains available as the research and general chat client.
```

`apps/jev-town-client` 的 `?mode=deskbot` 入口读取 DeskBot 地图和当前生活 Scene。确认 NPC 行动前会重新读取 revision、NPC 位置和邻接地点；只有服务端验证通过，行动才会写入普通 `npc_action` 事件。客户端不会因为模型文本或按钮点击直接声称行动已经发生。

## 本地运行

先准备 `config/llm_config.json`；天气是可选的 `config/weather.env`。从仓库根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\start-local.ps1 `
  -StartWeb -StartWorld `
  -WeatherEnvFile (Resolve-Path .\config\weather.env)
```

访问：

- 通用 DeskBot：<http://127.0.0.1:4322/>
- Jev Town 世界客户端：<http://127.0.0.1:5173/?mode=deskbot&deskbotUrl=http://127.0.0.1:4311>

也可以只启动 Jev Town 客户端（服务必须已经在 `4311` 运行）：

```powershell
Set-Location apps\jev-town-client
npm.cmd run dev:deskbot
```

停止服务：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1`。启动脚本会检查 `4311`、`4322` 和 `5173`，不会把已存在的旧进程当成新版本。

## 验证门槛

```powershell
Set-Location apps\jev-town-client
npm.cmd run typecheck
npm.cmd exec vitest run tests/deskbotBridge.test.ts
npm.cmd run build
```

主仓库发布前还要运行根目录测试、`git diff --check`、敏感文件检查和源码打包。真实世界行动验收应使用临时 DeskBot 数据库，不要改写用户当前 SQLite 存档。

## 后续边界

当前接入先解决“可观察的世界地图 + NPC 相遇 + 合法行动”闭环。后续可在不破坏 canonical 边界的前提下增加地点抵达反馈、NPC 关系面板、世界事件叙事和主动生活节奏。角色方向、Soul、天气和多源输入继续由 DeskBot service 管理；Jev Town 不能自行生成世界事实、角色阶段或外壳状态。
