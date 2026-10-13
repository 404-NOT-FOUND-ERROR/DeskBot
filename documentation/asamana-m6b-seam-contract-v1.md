# M6b 服务操作接缝合同 v1

状态：`active migration contract`。本文把 M6b 从“有 operation journal 基础设施”推进到“逐入口接入、逐入口回放”的执行合同。它不把已有的 namespace digest 或单个 seam 测试写成全服务生产回放完成。

关联文档：

- [迁移标准](asamana-migration-standard-v1.md)
- [迁移管线](asamana-migration-pipeline-v1.md)
- [正式迁移矩阵](asamana-migration-matrix-v1.md)
- [v6.2 发布说明](asamana-replay-journal-v6-2.md)

## 1. 统一操作封套

每个会改变 SQLite namespace、调用 provider、投递设备输出或产生 canonical mutation 的服务操作，最终都必须落入同一个版本化封套：

```json
{
  "schema": "deskbot.service-operation.v1",
  "capture_id": "…",
  "index": 0,
  "transaction_id": "…",
  "operation_id": "chat:event-…",
  "operation_kind": "chat.request",
  "source": "http.chat",
  "request_hash": "sha256:…",
  "received_at": "…",
  "logic_time": "…",
  "rule_version": "…",
  "result_ref": {"schema": "deskbot.provider-result-ref.v1", "…": "…"},
  "writes": [{"namespace": "…", "record_id": "…", "op": "insert"}],
  "record_hash": "sha256:…"
}
```

合同约束：

1. `operation_id` 必须由规范化输入稳定生成；重试不得随机生成第二个业务操作。
2. `request_hash` 只保存可回放的请求摘要。聊天正文、密钥、原始音频和完整敏感 prompt 不进入公开 archive。
3. provider 只通过 `result_ref` 进入 journal；真实网络响应必须在捕获时脱敏、固定并登记为本地 fixture，回放不得再次联网。
4. `writes` 是同一提交边界的审计摘要，不是回放输入；回放必须调用原业务入口，不能 SQL 导入或覆盖目标状态。
5. 缺 envelope、未登记 namespace、未知规则/内容指纹、fixture 缺失或摘要篡改均 fail closed，且目标库不得留下部分业务结果。

## 2. 当前接缝状态

| 接缝 | 当前代码事实 | 状态 | 下一步完成证据 |
| --- | --- | --- | --- |
| `/api/chat` `role=user` | 先 `normalizeChat`，稳定 `event_id`；在 `chat:<event_id>` / `chat.request` / `http.chat` context 中运行；journal 只记录 request hash 和脱敏 provider/TTS reference | `implemented / contract verified` | 通过原 `/api/chat` handler 的 fresh/restart/duplicate replay；provider fixture 调用数为 0 |
| `/api/chat` assistant/非 user 分支 | 已进入公共 `chat.reply` / `event_ingress` operation scope；专用原 `/api/chat` handler replay 尚未验证 | `partial` | assistant path 的成功、provider failure、TTS failure 和输出 route 均可原入口重放 |
| `/api/event` | 已有 `ingestNonChatEvent` seam 的 ingress/operation 证据，但不是所有直接 HTTP 路由的统一封套 | `partial` | 通用 event、role/life/research route 逐一登记并在原 handler 重放 |
| provider result | 成功/失败/TTS 失败已保存 `deskbot.provider-result-ref.v1` 摘要，并可登记/导出本地 durable fixture；原业务入口消费式 fixture replay 尚未完成 | `partial` | fixture schema、脱敏策略、hash、provider/model/result/error 分支、缺失/篡改 fail closed |
| `input-runtime` | 已有 `foundry.input-runtime-run.v0.1`，SQLite 恢复、TTL、跳过、失败退避、结果 event IDs 和 trace；当前 `refreshSource` 已在 `input-runtime:<run_id>` scope 内运行，并写入脱敏 result reference | `partial / contract verified` | 补齐 fixture registry、原 runtime replay、重启/重复/篡改和 source/namespace 原子提交；I4–I7 仍未通过 |
| worker / WebSocket / device ACK | 仍存在不经统一 operation context 的旁路 | `gap` | scheduler tick、设备回执和失败分支均有可执行捕获与重放 |

## 3. Chat/provider 接缝验收门（M6b-C）

必须按顺序完成，不能以“journal 行数相等”替代：

### C0 规范化与归属

- 相同聊天请求得到相同 `event_id`、`operation_id` 和 request hash。
- 重复请求返回第一次业务结果，不新增 turn、evidence、world mutation 或 journal。
- assistant/device 输出不能成为角色证据或世界事实。

### C1 provider 结果引用

- success、provider error、解析失败和 TTS error 各有稳定结果引用及失败分类。
- 引用不含密钥、原始音频或公开不可回放正文；引用的 fixture hash 可校验。
- provider 网络等待不包在 SQLite transaction 内；业务 commit 只接受已取得的结果引用。

### C2 原业务回放

- archive 在隔离 SQLite 中再次调用原 `/api/chat` handler/orchestrator seam。
- replay 使用固定 provider fixture，`provider_calls = 0`；不读取源数据库，不直接导入 turn 或 world state。
- success、failure、TTS failure、duplicate、correlation 和中途重启的 namespace 顺序、状态与 semantic hash 一致。

### C3 负向完整性

- 删除或篡改 provider fixture、request hash、operation envelope、规则版本或 namespace 注册表时 fail closed。
- 回放过程中断在 provider 前后、业务 commit 前后，目标库均不留下半个聊天操作。
- 只带 assistant 文本而没有对应 canonical task/event 的输入，不能产生“已完成”或世界 mutation。

## 4. Input-runtime 接缝合同（M6b-I，下一阶段）

### 4.1 现有 run 合同

`input-runtime.mjs` 当前持久化 `foundry.input-runtime-run.v0.1`：

- `schema`、`rule_version`、`run_id`、`source_id`；
- `started_at`、`completed_at`、`status`、`error`；
- 去重后的 `result_event_ids`；
- 成功/跳过/失败 trace 与 replay metadata；
- source 的 TTL、`next_attempt_at`、连续失败数和 freshness。

这些字段证明调度状态可恢复；当前 operation scope 还只完成了 run/source/result-reference 接缝合同，不足以证明整个 source refresh 已可在隔离服务中原入口回放。

### 4.2 目标 operation 形状

每次 `refreshSource` 必须关联：

```text
operation_id  = input-runtime:<run_id>
operation_kind = input-runtime.refresh
source        = input-runtime:<source_id>
```

封套中的可回放摘要至少包含：

- 规范化 schedule 请求（`source_id`、`force`、provider、TTL）；
- source 状态的 before/after 摘要；
- 已归一化、已脱敏的 provider result reference；
- cache hit、TTL 计算、backoff/error 分类；
- ingest callback 关联的 `event_id` 列表；
- run 完成状态和前后 namespace digest。

provider 网络等待必须在 SQLite transaction 外完成；成功后以固定 result reference 进入同一业务操作的 commit 阶段。嵌套事件仍使用 `ingress:<event_id>`，不能用 provider 正文作为世界写权限。

### 4.3 Input-runtime 验收门

| 门 | 必须证明 |
| --- | --- |
| I0 启停与归属 | start/stop/tick 各有稳定 run；重复 tick 不重入；每个 source 的 operation 可追踪 |
| I1 成功路径 | provider success → 归一化 result → ingest callback → source/run 完成；`result_event_ids` 去重且顺序稳定 |
| I2 skip/TTL | 未到期返回 `skipped/not_due`，不调用 provider、不写 evidence/world；强制刷新才产生新 operation |
| I3 failure/backoff | provider/ingest 失败隔离到该 source；保存错误分类、连续失败和下次时间；其他 source 继续运行 |
| I4 恢复/重复 | SQLite 重启恢复 source/run；重复 event、重复 run 和同一 fixture 不重复计数或写世界 |
| I5 replay | fresh/restart/replay 的 run、source 状态、事件 IDs、错误分类和 namespace semantic hash 相等；provider calls 为 0 |
| I6 负向安全 | 缺 provider fixture、篡改 request/result、未登记 source/namespace、capture 失败都 fail closed；不能留下部分 source 或世界状态 |
| I7 数据边界 | archive 只保存脱敏 provider reference；密钥、原始响应和不可回放的个人内容不落盘；过期数据仍可审计但不能被当作 fresh |

## 5. 执行顺序与停止条件

下一轮按以下顺序实施，每一项先写测试再改实现：

1. C0/C1：补齐 assistant chat operation 和 provider fixture registry。
2. C2/C3：用原 `/api/chat` handler 做 success/failure/TTS/duplicate/restart replay。
3. I0–I3：已接入 `createInputRuntime` 的可选 operation scope；复核网络等待仍留在 transaction 外。
4. I4–I7：补 input-runtime 重启、重复、缺 fixture、篡改和 source 隔离回放。
5. 再迁移 role proposal/trial/stage、world candidate、life/research route 和 worker/WebSocket。

任一门失败时保留失败报告，状态维持 `partial` 或 `gap`；不得用最终 namespace digest、一次成功聊天或受控 fixture 将 M6b 升级为完成。全部接缝通过后，才开启全局 `requireOperationContext = true`，并进行一次覆盖注册表和全服务回放验收。

## 6. 文档与测试产物

每个接缝必须同时更新：

- 源码映射与矩阵状态；
- 正向、负向、重复、重启测试；
- provider fixture/reference 的脱敏说明；
- replay 报告（包括 `provider_calls`、覆盖 namespace、失败分类）；
- 真实服务/人工体验与受控 fixture 的边界说明。

本合同只描述软件回放与审计，不把真实 TTS、屏幕/固件 ACK、机械外壳或 7–14 日自然生活观察纳入 M6b 完成条件。
