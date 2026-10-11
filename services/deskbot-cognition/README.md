# DeskBot 认知适配器

## 当前：v0.6，迁移第 1–5 阶段

个人感知/解释、目标与实际方法、跨轮记忆、反思、私人关系及明确共同事务已接通。连续调度支持十三名已登记人物、公平队列、睡眠与慢速整理；当前正式持续付费默认不启用。兴趣、机会与角色意愿回接既有 facets/rhythm/wishes/trials/stages，没有平行经验值或让模型直接改形态。

Node 保存唯一世界事实、原文归档、派生索引、预算与事务；短生命周期 Python 复用固定 Asamana。原始文件 52 个，均与 manifest 哈希一致，Apache-2.0 全文保留。热记忆与每轮依赖闭合的工作集有界，词项检索不等同语义 embedding。

实验脚本位于 `evaluations`：默认只准备虚构上下文；显式 `--real --config=<本机配置> --output=<隔离目录> --take=N` 才调用模型。必须事先授权数据范围和预算。`development-choice.mjs` 为十二组后续对照，`development-replay.mjs` 为零费用规则回放。`wish-recovery.mjs` 专用于已记录版本的缓存重放，拒绝未缓存调用。正式聊天与传感器记录没有包含在此次实验授权中。

第五阶段固定结果与剩余问题见 [验收](../../research/milestones/asamana-cognition-stage5-v1.md)。下方第二阶段和第一阶段部分是历史接口/实验说明，其中“待迁移”、24 文件、两元额度、mock-only 和旧规划上限不代表当前连续模式。


## 第二阶段连接补全

v3 上下文新增有来源的输入和未接收感知；`perceive` 独立于计划和反馈，直接复用上游 `Agent.perceive_step`。感知按实际收件范围进入个人事实，Node 校验逐字内容与来源，保存接收回执。忙于任务时可以接收，不增加实践或替换当前活动；普通事实感知不调用模型。消息、用户信息及设备观测保留不同认识类型，第三阶段继续完善语义折射和打断。

每轮恢复有方向的关系、已知人物与有限受阻尝试。实际收件可以增加接触次数；信任、关系标签和承诺仍需后续专用合同，不能由当前 worker 任意改变。感知原文、原始发生时间、接收时间分别保留。

任务采用绑定 claim 时冻结的对象、能力和收件人 ID，再核验当前条件。新活动结果与发展账本共用 `task:<task_id>`，来源和动机随任务保存；旧结果编号及未知动机不改写。观察和留言分别提供 `observe`、`social` 场景语义。收到用户消息不自动等于受邀劳动，动机依照本次来源与选择记录。

原文仍由 Node 保留，worker 每次取得最多 80 条、96,000 字符的相关记忆工作集，并同时保留所选洞见的来源；返回新增记忆和有限检索元数据增量，避免每次搬运全部人生。完整归档、语义检索对照、长期调度与关系整理按第四阶段继续。

临时失败记录复查时间，待反馈的实际结果保留控制权。新的调度不会让原规划器覆盖未处理的认知结果。旧 v2 提案仍兼容，新的 v3 提案增加 `perceive`、关系与元数据合同，由 Node 语义校验执行；不与下方第一阶段 JSON Schema 混用。

Node 保存世界、任务和认知原文，短生命周期 Python 进程运行固定版本 Asamana。当前已接通三角色的目标、意图、实际任务、个人事件、主观经历、后续与引用反思；工程接线和隔离实验完成，生活质量及真实长期稳定性尚未全面验收。

## 第二阶段当前能力

打开 `/cognitive-life-review.html` 查看为什么想做、当前任务、实际结果与后续。默认范围是隔离测试时钟；正式范围按现实时间，默认没有启用本轮付费人物。页面与生活观察页保留回到原世界和交流入口。

实际复用 `Agent.plan_step`、感知/Need/Goal、Decision、`begin_ongoing_step`、`finalize_ongoing_step`、MemorySystem 和 ReflectionEngine。当前 vendor 清单有 52 个未修改 Python 文件，固定提交及 Apache-2.0 同下方基线；适配器位于 vendor 外。AgentStore/VectorStore 用临时内存，上游磁盘存储仅作为导入依赖，不负责原文。

Python 提案由 Node 绑定到已有活动、观察、休息、现场留言或等待；位置、材料、占用、任务时长与实际后果由原执行器核验。正式认知保存在 `world.cognition`，与世界任务同事务；对话读同一状态。原文事实与结果独立验证，洞见引用已有个人来源。解释不增加资源、实践、技能或换形资格。share 不等于共同协商、关系或承诺成立。

第二阶段 v2 合同由代码中的字段、权限与语义校验实现，未冒充下方四份 v1 JSON Schema 的升级。上游步数映射为持久 epoch 起经过的整小时，任务及复查仍使用精确时间，测试时钟持久保存且不回退。每人首轮最多 4 次安排和 2 次手动反思。

真实调用需 `DESKBOT_LLM_PROVIDER=deepseek` 与本地 `DESKBOT_LLM_CONFIG`，模型 `deepseek-flash`。Node 持有密钥，浏览器与 Python 不读取。首轮 CNY 2、120 条调用记录，正式试运行与隔离共用一个账本；原聊天与旧 life-choice 另计。预算预留使用 SQLite 事务，跨连接共享，达到任一上限停止。网络失败不自动重发；语义合同仅允许一次明确计费的修复。未知用量保留预留，重启不重放旧 call ID。单次超时 45 秒，队列 1 个并发、12 个等待。

`data/cognition-stage2-budget.sqlite` 保存共享账本，`data/cognition-stage2-confirmation.sqlite` 保存当前确认轮；调试原型 `cognition-stage2-experiment.sqlite` 保留。正式世界仍使用原 `deskbot.sqlite`。费用按官方峰时价格保守估算，实际账单未知；检索采用本地词项与近期排序，256 维字符二元项频率向量明确不是语义 embedding，没有付费嵌入。

完整服务回归使用 `node --test`，Python 用 `python -m unittest discover -p 'test*.py'`。发布前已备份正式存档并验证哈希与完整性。启动修复为只加载历史 mutation 小索引、按需读取完整原文，避免将约 1.38 GB 历史快照全部反序列化；不删除旧历史。

真实隔离实验出现跨日“观察→下一窗口浇水→复查”，也暴露无依据居民发言和活动增量归因问题。已加强来源提示及前后记录，但不能宣称生成内容完全可靠。真实跨日、多源因果、奇幻规律、社会协作、全系统费用和旧发展账本联动仍待后续。

见 [第二阶段工程与实验记录](../../research/milestones/asamana-cognition-stage2-v1.md)。以下保留第一阶段接口说明；其中 mock、24 文件及尚未迁移的描述仅对应第一阶段。

## 运行

需要 Node 24+、Python 3.11+。第一阶段 Python 只使用标准库，不需要安装 Asamana 的整个依赖集。启动原有 DeskBot 服务和世界前端后，打开 `/cognition-review.html`。点击“运行三角色样例”时 Node 自动启动短生命周期 Python 工作进程；完成、出错或超时后回收进程。无需另外启动 TCP 服务。

可用 `DESKBOT_COGNITION_PYTHON` 指定 Python 可执行文件。默认优先寻找本机 Codex bundled Python，然后检查 `python3` / `python`。Windows 的 asyncio 会创建内部回环管道，受限沙箱可能阻塞；请在普通本机运行环境执行接口测试。

数据库默认位于 `apps/deskbot-service/data/cognition-stage1.sqlite`。它只接受实验命名空间，拒绝传入正式人生数据库。浏览器不能传入上下文、修改存档路径、开启真实提供者或发起任意动作。

## 上游及许可

源仓库：<https://github.com/dreamscroll-lab/asamana>，固定提交 `e9fc862642369ba8b177595d2f8e3f20c1636da4`，Apache-2.0。`vendor/asamana/LICENSE` 保留全文；该版本没有 NOTICE 文件。`vendor/manifest.json` 记录 24 个未修改源文件的 SHA-256、实际调用组件和仅作为传递依赖引入的模块。适配代码在 vendor 目录之外。

没有复制完整 engine、世界模型、官方场景、Gradio、模型提供者或有并发写入问题的 FileVectorStore。Goal、Need 等在此阶段仅作为身份模块的导入依赖，不表示目标生成、记忆排序与反思已迁移。

## 四份合同与提交边界

`contracts/*.v1.json` 是同一份严格 JSON Schema 子集，Node 与 Python 各自验证。新增字段必须升级合同，不能绕过 schema 偷渡库存、技能、换形或位置变更。

| 合同 | 生产方 → 消费方 | 当前映射与限制 |
| --- | --- | --- |
| context | Node → Python | protagonist / npc ID、身份、已有对象 ID；只取本人的经历和有权限看到的事件。认知序列用于追踪，真实时间另存。样例的事件与对象数值来自隔离 fixture |
| proposal | Python → Node | 主观解释、目标文字、已知 observe 意图、来源引用。Python 不保存角色、资源或世界结果 |
| result | Node → Python | 通过条件核验后的隔离观察；共同根由 Node 指定。它不是正式 world-task 实践，不增加 development evidence |
| memory-commit | Python → Node | 原文事实与个人解释分开；独立 personal group 绑定同一 shared root。Node 核对事实、来源、身份、时间后事务保存 |

采用前检查角色认知版本、相关对象版本与状态、有效期限和可见来源。全局时钟或无关 revision 不参与作废判断。采用、角色认知版本和个人原文记忆在同一个 SQLite 事务中保存。模型调用账本先预留；重复请求复用已有 run，不重复调用或提交。中断状态保留，恢复时不会自动重发。

已有正式世界的 autonomy / development / facets / trials / wishes / role stages 没有被迁移或改写。旧动机未知时继续保留未知；本阶段不会反推或补写旧心路历程。

## 提供者接口与费用

同一个 mock broker 提供 `complete` 与 `embed`，按用户交流、认知、反思、嵌入的优先级排队，最多一个并发、12 个等待、UTC 日 60 次模拟调用。预留、开始、结束、异常、中断、延迟、输入/输出/思考 token、缓存 token、费用、币种、价格版本与使用量来源都保存在实验账本。

mock 的 token 与费用确为零，提示字符数单独记录，不伪装为真实 token。real 模式无条件拒绝；第一阶段不读取密钥或调用付费 API。示例 embedding 是明确标记为非语义的哈希向量，只验证派生索引可重建。

正式对话继续使用原有提供者，不会在本阶段迁入这个实验队列。真实认知实验之前仍须确认模型、embedding / 检索方案、计费字段、价格版本和明确费用上限，届时才接入正式调用入口。

## 备份与恢复

实验 v0 存档升级前使用 SQLite `VACUUM INTO` 生成一致性备份，检查 `integrity_check` 后才改版本；旧记忆、共同根和未知解释保持原值。测试通过恢复到另一份独立数据库证明备份可读。正式人生数据库本阶段没有结构迁移，其迁移与正式恢复验收须在接入前单独执行。

记忆原文由 Node SQLite 持有。派生索引丢失后可重建；重建失败不会删除原文。schema 不匹配的旧记忆保留原件，不自动补写解释或作为可用上下文。

## 验证

在 `apps/deskbot-service` 运行 `node --test test/cognition-stage1.test.mjs`，在本目录运行 `python -m unittest discover -p test_contracts.py`。前端测试包含实验标记、能力边界和正式对话回入口。HTTP 集成与浏览器操作另见第一阶段验收记录。

下一阶段接入完整需要、目标、意图、实际任务结果与反思，再验证模型能否产生可执行的差异及跨日后续。本阶段的三份解释是 mock 程序设定，不能当作自发性、叙事质量或真实生活已经达标的证据。
