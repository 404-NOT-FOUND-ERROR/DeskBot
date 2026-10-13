# M6b-I4/I7：input-runtime 回放接缝验收记录

状态：`implemented / automated verified`（仅限受控本地 fixture；不等同于所有服务入口或真实 provider 已完成迁移）。

本项把 Asamana 的“来源刷新 → 规范化观察 → 运行记录 → 可恢复调度”机制接入 DeskBot 现有 `input-runtime`，不新增第二套来源状态机，也不允许外部正文直接获得世界写权限。

## 合同

| 字段 | 约束 |
| --- | --- |
| `item_id` | `M6b-I4/I7-input-runtime-replay` |
| 运行记录 | `foundry.input-runtime-run.v0.1`，稳定 `run_id`、`source_id`、request、状态、错误、结果事件 ID、trace |
| 私有 fixture | `deskbot.input-runtime-fixture-ref.v1`，仅位于本地 replay tape 的 provider registry；operation journal 只保留脱敏引用 |
| 捕获记录 | `deskbot.replay-capture-input-runtime.v1`，保存 run、请求摘要、operation 起止、结果摘要和 fixture 引用 |
| 原入口 | 回放调用 `inputRuntime.replayRun`，仍走已注册 source 的原 ingest callback；不 SQL 导入目标 namespace |
| 允许状态 | `completed`、`skipped`、`error`；网络等待发生在事务之外，失败分类保留在 run 中 |
| 幂等与恢复 | 同一 run 由 `run_id` 识别；source 事件仍由既有 canonical/domain 去重；回放支持 fresh、重启点和重复 source 结果 |
| 信任边界 | fixture 只接受本地受信 archive；HTTP、客户端、模型正文不能提交或读取 replay provider registry |

## 已实现

- 捕获 `input-runtime` run 与来源 provider fixture，fixture 只允许事件、连接器时钟和显式脱敏结果 envelope。
- `completed`、`skipped`、`error` 三类结果均可重放；错误不会变成占位成功故事。
- replay service record 按 operation 顺序执行 input run；由 input run 产生的 ingress 不会被再次单独执行。
- 重启时重新打开 SQLite，source/run 状态、TTL、失败退避和事件结果保持一致。
- provider 回放不调用真实网络，`provider_calls = 0`；未登记 source、缺失 fixture、篡改 fixture 在目标服务运行前或原入口处 fail closed。
- 运行 trace 的耗时字段在持久化时归一化，避免性能噪声破坏语义回放 hash；阶段顺序、状态、事件引用和规则版本仍必须一致。

## 自动化证据

专项测试：

```powershell
node --test apps/deskbot-service/test/input-runtime-replay.test.mjs
```

覆盖：

1. success、重复 source 事件、TTL skip；
2. replay fresh 与中途 restart；
3. error/backoff 记录；
4. provider calls 为零；
5. 缺失、篡改和未登记 source 的拒绝；
6. 私有 payload 不进入 operation journal。

同批回归还通过：

```text
input-runtime + replay-capture + operation-journal：30/30
```

## 仍未完成

- assistant/non-user chat 分支、直接 HTTP role/life/research route、worker/WebSocket/device ACK 尚未统一进入 M6b tape。
- 真实天气/新闻 provider 的长期连续回放和网络断线人工验收仍待 M8c；fixture 通过不能替代真实生活。
- 本项不改变 `persistentWorld.ingest`、角色阶段或世界候选的唯一写入口，也不自动生成世界事件。

## 回滚

关闭 replay capture 或回退 `input-runtime` 的 replay provider 注入即可恢复原来源刷新；canonical 世界、任务和角色历史不删除、不重写。
