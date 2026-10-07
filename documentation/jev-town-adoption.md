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
  |  POST /api/life/npc-interactions
  |  POST /api/event (npc_action)
  v
DeskBot service :4311
  |  canonical world / revision
  |  schema + adjacency + stale-state validation
  |  SQLite persistence + mutation ledger
  +-- bounded DeepSeek / weather + news / life + memory / role stages

DeskBot web :4322 remains available as the research and general chat client.
```

`apps/jev-town-client` 的 `?mode=deskbot` 入口读取 DeskBot 地图、当前生活 Scene、同地点相遇和最近共同经历。当前相遇的 NPC 可以进行观察、问候、聊天、交换想法、搭手帮忙或尝试同行；远处 NPC 只能查看档案。客户端用稳定互动 ID 请求 `/api/life/npc-interactions`，NPC 台词、关系变化、共同经历和角色方向线索均采用服务端 canonical 结果，网络重试不会重复累计。

确认 NPC 行程候选前，客户端会重新读取 revision、NPC 位置和邻接地点；只有服务端验证通过，行动才会写入普通 `npc_action` 事件。Scene 的 `opportunity` 和 NPC 行程候选均标为尚未发生。

当前产品基线为 v0.5 角色发展第六阶段。客户端读取同一服务的十三位角色、设施资源、任务、约定、项目、长期记忆与角色发展状态。角色方向已从观察进一步接通有依据愿望、真实试做、纯预览、明确采用与回退；阶段形态和职业分轴，地图与 3D 使用服务输出的当前外观投影。当前荷叶青蛙、工坊学徒和灶边厨师是有限作者造型，虚拟改变与实体外壳单独记录。见 [角色阶段规则](../research/world/role-stages-v1.md)。

当前互动闭环为：

```text
Scene / 同地点相遇
  -> 用户选择互动
  -> DeskBot 校验并生成 NPC 当面回应
  -> canonical npc_interaction
  -> SQLite 共同经历与关系
  -> 后续 Scene、生活选择、记忆与发展依据
```

## 本地运行

先准备 `config/llm_config.json` 并安装本客户端依赖；天气可使用 `config/weather.local.env` 或显式指定的天气配置。从仓库根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\start-local.ps1 `
  -StartWeb -StartWorld
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

当前客户端已连接持续生活、资源与社会事务、任务驱动动作、天气昼夜、长期记忆、兴趣、愿望、实际试做及可逆角色阶段。原 Jev Town 模式保留；DeskBot 模式读取服务，不自行结算世界事实、身份或外壳状态。

后续重点是中文真实声音、实机身体协议与校准、正式世界长期观察，再根据结果扩展地图、职业和造型。界面预览与受控回放不能代替自然运行或硬件实测。当前能力总览见 [项目介绍](../README.md)，下一阶段安排见 [v0.5 路线图](../research/development-roadmap-v0.5.md)。
