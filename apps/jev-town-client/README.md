# DeskBot 3D 生活客户端 · 聚形域

当前基线为 **v0.5 角色发展第 6 阶段（2026-10-07）**。本客户端把 DeskBot 的持续世界表现为低多边形小镇：喵呜与十二位光粒居民按现实时间生活，实际任务、设施、资源、约定和角色成长共同呈现在同一地图上。

客户端基于 [CeciliaW888/jev-town](https://github.com/CeciliaW888/jev-town) 的场景与交互基线制作。DeskBot 的维护入口是 `?mode=deskbot`；原 Town Crier 模式保留作上游参考。来源、授权及继承范围见 [AUTHORIZATION.md](AUTHORIZATION.md) 和 [接入记录](../../documentation/jev-town-adoption.md)。

## 当前能力

- **持续生活看得见。** 喵呜与十二位居民共十三个生活角色，当前位置、旅行进度、正在进行的活动及预计结束时间读取真实服务状态，动作跟随任务。
- **地图与设施有实际后果。** 苗圃、厨房、水岸、育苗架和零件设施显示苗况、水位、有限库存、锅气与工作状态。采收、携带、烹饪、交接、照料和项目阶段都由服务核验。
- **现实环境折射。** 上海时间、天气与风雨影响昼夜、环境和生活选择；傍晚及夜间灯火随时段与运作状态渐变。NASA Science 消息和区域空气参考保留来源，不冒充角色亲历。
- **居民有关系和事务。** 喵呜、居民、约定、记录四个视图展示独立生活、共同经历、项目、邀请、合作与延期；同地互动经过服务端生成并保存，远处居民可查看档案。
- **角色选择接到实际生活。** 接触、主动继续、受邀实践、具体配方能力及规则自评分开呈现。有依据愿望进入实际试做，可暂停、调整、继续或退出；跨日主要成果达标后才提供采用预览。
- **形态与职业可以组合。** 荷叶青蛙、工坊学徒和灶边厨师采用有限制作的 3D 造型，保留种子眼、梨形体、胸前光核与光粒。预览不修改当前角色，确认后地图读取正式版本；形态或职业可分别回退，另一轴与实际经历保留。

`deskbot-service` 是唯一世界事实源。浏览器不自行结算资源、任务完成、关系或角色阶段，动画、候选和模型台词也不能直接修改存档。具体规则见 [当前架构](../../documentation/architecture.md)、[第 6 阶段验收](../../research/milestones/role-development-stage6.md) 与 [角色阶段规则](../../research/world/role-stages-v1.md)。

## 运行 DeskBot

整个项目需要 **Node.js 24+**。从仓库根目录准备 [本地配置](../../config/README.md)，安装客户端依赖，再启动三个本地服务：

```powershell
Set-Location apps\jev-town-client
npm.cmd ci
Set-Location ..\..
.\scripts\start-local.ps1 -StartWeb -StartWorld
```

生活世界：<http://127.0.0.1:5173/?mode=deskbot&deskbotUrl=http://127.0.0.1:4311>。

研究与通用对话：<http://127.0.0.1:4322/>。世界服务为 `127.0.0.1:4311`。启动脚本加载服务端 DeepSeek 与可选天气配置，新闻及区域空气连接器默认开启；公开 clone 需自行填写模型密钥、城市等配置，不包含本机真实配置。密钥不得放在客户端代码或浏览器 URL 中。

从仓库根目录停止本次服务：

```powershell
.\scripts\stop-local.ps1
```

只开发前端时，先保持 DeskBot 服务运行，再在本目录执行：

```powershell
npm.cmd run dev:deskbot
```

继续打开带 `mode=deskbot` 和 `deskbotUrl` 的生活入口。裸 `/` 仍是原 Town Crier 模式；本客户端的上游 Express 服务 `8787` 不负责 DeskBot 世界状态，运行 DeskBot 入口不需要 Jev API key。

## 独立样例与验收入口

以下页面使用只读预览、隔离规则样本或独立身体软件回合，不写入正式存档，不代表正式个体已经经历了样本中的全部生活：

| 地址 | 内容 |
| --- | --- |
| `/development-review.html?sample=stages` | 当前第 6 阶段：试做、纯预览、采用、形态与职业组合、重启、分轴回退 |
| `/development-review.html?sample=trials` | 第 5 阶段实际试做、暂停、调整、受阻与跨日成果 |
| `/development-review.html?sample=wishes` | 第 4 阶段愿望前提、支持、暂缓、拒绝和重提 |
| `/development-review.html?sample=facets` | 接触、主动继续、实际配方与条件困难的分维度依据 |
| `/development-review.html` | 共同经历与发展结果根，需独立 `4314` 样本服务 |
| `/scene-review.html` | 居民近景、动作、昼夜、风雨与场景美术预览 |
| `/life-review.html` | 持续生活、设施、协作与约定规则回放 |
| `/life-review.html?sample=supply` | 有限光果来源、烹饪、送餐与多人供给 |
| `/life-review.html?sample=inputs` | 现实输入折射与来源记录 |
| `/life-review.html?sample=memory` | 长期记忆与有限模型选择，使用标注的测试模型 |
| `/body-review.html` | 独立 `4313` 身体软件回合；正式状态仅可读取，模拟回执不代表实机验证 |

当前阶段样本通过仓库根目录的 `node scripts/review-role-stages.mjs` 重新生成；生成器使用隔离 SQLite、受控条件与实际任务执行器，不导入正式世界。持续现实观察与受控回放的结论分别记录。

第 1 阶段及身体页面还需分别运行 `node scripts/review-development-evidence.mjs`、`node scripts/review-body-perception.mjs` 的独立样本服务；两个脚本均从仓库根目录启动。第 3–6 阶段页面直接读取随客户端保存的静态样本。

## 前端开发与验证

在本目录运行：

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build:deskbot
```

`build:deskbot` 生成 Vite 客户端页面；`typecheck` 单独核验类型。`npm.cmd run build` 同时构建继承的上游 Express 服务，仍供兼容与完整回归使用。`build:vercel`、上游部署与访客 key 流程是历史 Town Crier 路径，不是当前 DeskBot 公网部署方案。

主要目录：

- `src/deskbot/`：服务读模型、生活侧栏、角色发展、阶段控制与 DeskBot 接入。
- `src/three/`：小镇、光粒造型、设施状态、任务动作与环境表现。
- `public/` 与各 `*-review.html`：无凭据的独立验收数据和页面入口。
- `tests/`：DeskBot reader、状态边界、组件、阶段组合与上游兼容测试。
- `server/`、`shared/` 和原 `src/App.tsx`：继承的 Town Crier 路径，当前世界事实不由其管理。

## 当前边界与来源

采用阶段改变的是虚拟外观和有限生活倾向，不代表换了实体外壳、增加自由度、获得现实职业资格或测得主观喜欢。当前形象是作者定义的闭集几何与配件；开放造型生成尚未交付。

正式中文 ASR/TTS 尚未启用，小智固件尚未适配 DeskBot 身体协议。当前阶段的组件、几何与构建已验证，浏览器自动化初始化失败，尚未完成第 6 阶段截图验收。自然愿望形成、长期人物体验和连续 7–14 天现实生活仍需后续观察。开发进度见 [v0.5 路线图](../../research/development-roadmap-v0.5.md)。

保留原作者与依赖归属，授权记录不自动改变第三方依赖许可证。原完整 README 已原样保存在 [UPSTREAM-README.md](UPSTREAM-README.md)，其中外部网站、上游 API key 和自动部署断言仅供历史参考；本项目当前能力、入口和配置以本文及 [主仓库介绍](../../README.md) 为准。[ARCHITECTURE.md](ARCHITECTURE.md) 继续保留上游设计资料，DeskBot 当前架构见 [主仓库架构说明](../../documentation/architecture.md)。
