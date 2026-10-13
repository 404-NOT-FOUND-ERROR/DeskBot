# Asamana 本地部署与源码评估

> M6b-R 增量（2026-10-14）：当前公开发布分支为 `codex/asamana-m6b-r-release-2026-10-14`；`codex/asamana-m6b-r-public-release` 为上一版 M6b-R 基线，`codex/asamana-m6b-v6-4-public-release` 为历史 v6.4 发布基线。下文保留 v6.3/v6.2 的历史数字时，按其原发布记录理解；未完成范围仍以迁移矩阵为准。

核对日期：2026-10-14。上游：[dreamscroll-lab/asamana](https://github.com/dreamscroll-lab/asamana)，核对版本 `e9fc862642369ba8b177595d2f8e3f20c1636da4`，许可证 Apache-2.0。源码、素材和示例部署在 `C:\Users\Administrator\Desktop\Jeremy\asamana-runtime`，与 DeskBot 的数据库、端口和模型配置隔离。DeskBot 当前公开发布分支为 `codex/asamana-m6b-r-release-2026-10-14`；`codex/asamana-m6b-r-public-release` 为上一版基线，`codex/asamana-m6b-v6-4-public-release`、`codex/asamana-m6b-v6-4-release`、v5/v6.2/v6.3 仅作为历史基线，逐项执行以 [迁移作业单](asamana-migration-runbook-v1.md) 为准。

## 架构实际做了什么

Asamana 是一个以主题构建人物和世界、让人物行动产生涌现叙事的引擎。它不是只把聊天串起来：先感知处境、判断需要和目标、生成行动计划，再通过执行器和仲裁确认后果，最后生成反馈、记忆与可回放快照。主角与背景人物都是有认知的 Agent；另有不调用模型、执行跑腿委托的 Npc 类型。这里的 Npc 不应与 DeskBot 的十二位完整居民混为一谈。

```text
React / Phaser：地图、人物、关系、故事流与历史回放
                        ↓ REST / WebSocket
interaction：世界目录、运行控制、读取快照与回放
                        ↓
world：地图选择 → 主题 → 人物设计 → 初始需要/关系/世界
engine：时钟、调度、消息、环境、行动仲裁与结果、事件
agent：Soul + State、感知、需要/目标、决策、记忆与反思
                        ↓ core 接口
providers：LLM、embedding、向量存储、人物存储、snapshot
```

`core` 抽象基础设施，业务通过明确接口取得模型与存储；前端只读取运行与回放结果，不决定人物是否实际抵达或行动是否成功。`engine/runtime.py` 控制阶段顺序，在共享快照上规划，经仲裁后提交，最后持久化人物状态和世界快照、发布同一序列的前端事件。

它有跨步存档和恢复能力，但 `NarrativeRuntime.run(total_steps=...)` 要求正整数步数，源码明确没有 run-forever 模式。每步可能有多次模型调用，世界步长也由配置决定。因此可称“有连续状态和恢复的叙事模拟”，不能直接等同于 DeskBot 的现实 1:1、长期无人操作持续生活服务。恢复也不是事务级续接：`world/initializer.py` 会把进行中的行动重置为 `IDLE`，中途移动者回到出发点。

`interaction/replayer.py` 的回放是读取历史 snapshot 并转换成 `StepEvent`，不是重新执行相同输入后验证结果一致。运行时先保存人物状态，再保存 snapshot，保存失败仍可能发布 live step；这些写入没有跨存储事务。中途终止也可能从上一 snapshot 重跑并重复记忆。DeskBot 应借鉴其观察回放界面，继续使用自身 SQLite、事件幂等与 mutation ledger 保证恢复；不能把上游 replay 的含义当成确定性重演。

## 2026-10-14 DeskBot 分支收口

历史代码基线为 `codex/asamana-shared-life-v5`，v6.2 是已发布的 M6b operation-journal 增量；当前公开发布分支为 `codex/asamana-m6b-r-release-2026-10-14`，仍不修改 `main`。`codex/asamana-m6b-r-public-release` 为上一版 M6b-R 基线，`codex/asamana-m6b-v6-4-public-release` 为历史 v6.4 基线。v6.2 的 857/857、M8 1/1、专项 27/27、7/7、19/19 和客户端/构建数字作为历史基线保留。v6.4 当前已通过受控 chat 用户 handler LLM fixture replay 10/10、input-runtime replay 2/2、服务端广套 861/861、客户端 typecheck/build、voice-sidecar 16/16 和 `git diff --check`；M6b 仍为 `partial`，独立 TTS fixture、assistant/provider 全分支和完整 chat replay 仍未完成。正式实时小镇实际页面再次核对，天气显示“等待新天气”，不把画面当作 provider fresh 验收。v4/v5 收紧了角色时空感知、慢认知来源计费、跨日目标续接和本地回放边界；v6.2/v6.3/v6.4 不引入第二套世界引擎。

新增跨日验收脚本默认零外部请求，三日受控样本已 `verified`：首日完整目标执行链成立，次日真实实践形成的原具体目标在第三日重启后的下一合法机会执行并完成，没有重置期限或补赠材料。真实 DeepSeek 模式已用 Clash 执行六次调用，Day2 缺少经历依据的目标被拒绝，结果仍为 `inconclusive_reflection_failed`。真实模型多日生活、完整阶段视觉、真实渲染 context loss 与长断线仍待验收。现有 replay tape 是隔离输入 fixture 的确定性重演，任意生产存档的完整捕获导出尚未接入；长期共同生活和全部迁移目标不能据此宣称完成。

## 本地如何体验和重启

前端入口为 <http://127.0.0.1:5174/>，后端为 <http://127.0.0.1:7860>。此前本地部署检查过两个端口的 HTTP 200，并在浏览器打开“谁是内鬼”示例，确认地图、七名人物、需要/目标、心声、行动结果和回放滑条正常显示；本次文档审计没有重新检查这些上游服务。进入世界后选择“回放”，拖动底部滑条查看不同步骤；“关系图谱”显示当前观察步骤的人际网络。

当前 `config/config.local-file-mock.yaml` 使用文件存储和 mock 模型，不导入 DeskBot 密钥。适合读示例和回放，不能代表真实模型的新世界生成、对话或自治效果。真实模拟需要另行配置 OpenAI-compatible LLM 与 embedding；上游示例中 6–8 名角色运行 35 步约有 900–1400 次模型调用，这是 README 的估计，不是本机测得的消耗。

服务停止后，在两个 PowerShell 窗口分别运行：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\Jeremy\asamana-runtime'
$env:CONFIG = 'config/config.local-file-mock.yaml'
.\.venv\Scripts\python.exe main.py web --host 127.0.0.1 --port 7860
```

```powershell
Set-Location 'C:\Users\Administrator\Desktop\Jeremy\asamana-runtime\frontend'
npm.cmd run dev -- --host 127.0.0.1 --port 5174
```

已运行的端口无需重复启动。上游 README 引用了 Docker `deploy/asamana.sh` 和后端 `tests/`，当前核对版本不包含这两个目录；本地部署采用 Windows 原生运行，并未声称执行 Docker 脚本或通过上游完整 Python 测试。

## 可迁移的源码与边界

下表是从实际源码到 DeskBot 的对应；“迁移”优先指在 Node/SQLite 体系中重写合同与算法，而不是同时运行两套引擎。

| Asamana 文件 | 有价值的实现 | DeskBot 对应与具体效果 | 当前取舍 |
| --- | --- | --- | --- |
| `engine/runtime.py`、`agent/agent.py`、`core/interfaces/trace.py` | 真实认知阶段、共享上下文、规划/执行/反馈分离、审计 trace | `life-choice` / `autonomous-life`；能解释一次选择依据与实际执行结果，区分模型调用成功、解析成功、实际采用 | 已接入真实阶段 trace、有限认知请求和执行反馈；继续扩展合法行动的丰富度 |
| `agent/personality.py` 的 `SoulLayer` / `StateLayer` | 稳定身份和动态情绪、需要、目标、位置、活动分开 | 保留喵呜的稳定个体，把当前形态/职业放在 `role_stages`，表达从体验包派生 | 学习分层；不复制固定 appearance 和人类年龄等产品字段 |
| `agent/memory.py`、`memory_types.py` | factual / experiential 双流，一个事件用 event group 关联；解释不替换事件事实 | `lived-memory` 三类记录的 stream、anchor 和来源事实投影；记得“发生什么”也记得“当时怎样理解” | 已接入只读召回和受控慢反思写入；原事实保留，理解不增加独立成长证据 |
| `agent/memory_ranking.py` | relevance/recency/importance 归一化，固定权重，衰减，MMR 和 diagnostics | `memory-ranking.mjs`；减少每次机械重复同一条往事，同时保留事实 grounding | 本轮已接入；先用词法检索，不引入向量服务依赖 |
| `engine/cognition_maintenance.py`、`agent/reflection.py` | decay → compression → reflection → goal revision → relation evolution；单人物失败隔离 | `slow-cognition.mjs`；只读 canonical facts，输出带来源的 personal interpretation、短期意图和主观关系视图 | 已实现并自动验证；不能让反思自己成为独立成长证据 |
| `engine/scheduler.py` | cold start、need、emotion、pressure、max idle 的认知节拍；正在做事的人不重新决策 | `cognition-cadence.mjs` / `life-choice.mjs`；主角/居民空闲上限和真实情绪来源门控新的模型请求 | 已实现并自动验证；情绪必须有 canonical source，不能硬编强度 |
| `engine/environment.py`、`agent/perception_layer.py`、`engine/message_system.py` | 按地点、消息、观察受众构建角色知道的事，而不是让每个人共享全知剧情 | 喵呜第一人称 Scene、同地居民与消息来源；世界观测面板可以更完整，角色叙述保留知识边界 | 继续扩展角色知识投影；不能把观察者看到的全镇快照直接当成亲历 |
| `engine/arbiter.py`、`execution_processor.py`、`executors/` | 计划、共同参与仲裁、正在执行、完成/失败、打断分别处理 | 复用已有真实任务、材料预留、设施容量、赴约和路线执行器 | 改进合同及多角色协作；不替换已有世界规则 |
| `engine/world_mutation.py`、`injection.py` | 为 SYSTEM / DIRECTOR 注入提供带权限的私有效应通道；落地时再次检查作者权限；每项变更必须有观察描述和受众 | 现有 `world-candidates` / `persistentWorld.ingest`；未来世界事件有真实后果且居民能察觉 | 保留 DeskBot preview/accept；不引入 director 任意传送/生杀权限。行动执行和反馈还有独立的合法状态写入路径，不能把该通道描述成所有世界事实的唯一入口 |
| `engine/event_seq.py`、`interaction/replayer.py`、snapshot provider | 单调序号、同一载荷用于 live/replay、存档后恢复序号 | `replay-tape.mjs`、canonical mutation ledger 与 life feed；fresh/restart/duplicate/preview 纯度和实际阶段回放 | 已实现并自动验证；基础历史面板已接入，长期浏览与人工体验仍待验收 |
| `frontend/src/api/ws.ts`、`hooks/useStepPlayer.ts` | 重连退避、重复步去重、等渲染完成再播放下一步 | `world-observer.mjs` 与客户端 `worldObserver.ts`；统一 map/Scene/NPC/feed/role snapshot、revision/sequence gate 和有界 render gate | 已接入 DeskBotApp；类型、回归、构建通过，浏览器基础地图/生活/故事同步呈现已检查，长期断线与历史浏览仍待体验验收 |
| `world/initializer.py`、`stored_config.py` | 每个世界冻结自己的地图、tileset 和人物资产 | 地图版本、路线与渲染坐标合同，阶段外观有版本、回放不会套用今天的新资产 | 借鉴资产版本合同，继续使用 Jev Town 3D 风格 |

## 对我们的价值

最值得学的是“角色先有自己的处境和欲望，行动真的产生后果，再对后果形成理解”。这比把角色台词写得更夸张更接近持续生活感。比如喵呜受到雨和主人做饭话题的影响，先关注水边食材，实际探索、试做、碰到困难，与居民产生共同经历，再对厨师或青蛙生活形成愿望；新形态和职业的表达必须读取已采用阶段。这条过程继续使用 DeskBot 的多源折射和实际试做管线。

Asamana 能让一个主题下的冲突更丰富，但开放行动和模型叙事的成本也更高。适合迁移其结构和工具，逐步扩展合法候选、居民项目和有限世界事件。直接替换整个 DeskBot 后端会丢掉现有现实输入、可信设备边界、资源执行、角色双轴阶段和 SQLite 幂等记录，收益不足以支持该替换。

建议把其“一世界一主题”改成聚形域中的阶段性地方故事：修复水泵、准备集市或一起探索水岸。故事有参与者、局部压力和时间窗口，但世界在故事结束后继续生活。稳定 Soul 保留喵呜的个体辨识度；兴趣、理解、职业、形态与表达包从经历和已采用阶段读取。上游固定外观和类人字段不能直接套用到会主动尝试新形态的桌面潮玩。

## 本轮实际交付与验证

- DeskBot v6.4 服务端广套本轮重新运行 861/861，原 chat handler LLM fixture replay 10/10，input-runtime replay 2/2，退出码 0；客户端 typecheck/build、生产构建（含 client/server）和 voice-sidecar 16/16 同轮通过。v6.2 的 operation-journal/replay/persistence 27/27、input-runtime 7/7、chat/replay-capture 19/19 与 Asamana 前端 140/140 是历史结果，本轮不重算；独立 TTS fixture、assistant/provider 全分支和 M6b 全服务 replay 仍待推进。
- Jev Town 客户端：生活 feed/刷新 race 9/9；typecheck 和生产 build 通过。构建通过不是长期沉浸体验完成。
- Asamana 前端：17 个测试文件、140/140 通过；本地 API 能读取长安和现代都市两种地图。
- M3/M4 与 M6a/M7 的模块能力已接入并自动验证，M8a 受控 fixture 已通过；这不等于 M6b 全服务归档或 M8b/M8c 已完成。进一步语义复核已收紧目标为具体合法 activity、NPC 候选输入脱敏、按查询时刻过滤来信、撤回邀请只保留不可行动的历史，并隔离非法来源时间戳；以上均有专项测试。v6.1 发布前已完成基础浏览器验收并保存 DeskBot/Asamana 画面证据；完整阶段像素验收、长断线与长期历史浏览、真实模型多日慢认知、生成式世界事件和真实中文 TTS 仍待验收。
- 隔离 M8 样本覆盖 288 条 ingress 事件，实际试做跨 2026-10-03、10-04 两个上海日期，经愿望、实践、采用、投影、世界候选与重启重复验收；样本不会写入正式存档。这些规则验证不等于正式世界已经自然生活多日。
- 正式存档当前统一 snapshot 返回 HTTP 200（约 459 KB）；显式加载和风天气配置后天气连接器可恢复为 `fresh`。新序列历史查询返回 200，旧真实迁移断层（例如序列 3952）仍严格返回 `409 history_unavailable`，不会跳过完整性校验或返回伪造的历史；前端长期历史浏览与人工长期回放仍待验收。
- v6.2/v6.3 发布分支只提交源码、测试、协议、文档、第三方归属和当时版本效果图；用户原有截图、数据库、密钥、测试输出和临时文件继续排除。v6.4 已记录受控 LLM/input-runtime fixture replay 与服务端回归证据；独立 TTS、assistant/provider 全分支和完整 M6b replay 仍不在通过范围内。

迁移标准及阶段验收见 [迁移标准](asamana-migration-standard-v1.md)、[迁移管线](asamana-migration-pipeline-v1.md)、[正式迁移矩阵](asamana-migration-matrix-v1.md) 和 [迁移作业单](asamana-migration-runbook-v1.md)。
