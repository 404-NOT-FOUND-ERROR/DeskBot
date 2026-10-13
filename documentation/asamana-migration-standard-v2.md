# Asamana → DeskBot 迁移标准 v2

状态：`active-for-execution`（2026-10-14）

本文是“逐项迁移”工作的规范合同。它把 Asamana 当作工程机制参考，不把上游
代码、人格设定或世界事实搬进 DeskBot。已有 v1 标准、目录和矩阵继续保留为历史
证据；从本轮开始，新迁移以本文、[v2 管线](asamana-migration-pipeline-v2.md)
和 [v2 作业单](asamana-migration-runbook-v2.md) 为执行入口。标准已经冻结并进入逐项
执行；目录中的 `partial`、`inconclusive` 和 `planned` 仍表示未完成，不能被本文件的
启用状态误读为“全部迁移完成”。

当前执行基线由目录 `release.branch`、`release.base_commit` 和每项证据中的
`base_commit` 共同确定。历史发布分支、旧测试数字和旧证据只作为历史引用；若与当前
目录不一致，必须标注为 stale，不能混用。

## 1. 目标与不变边界

目标是把可验证的工程机制迁移成 DeskBot 的长期共同生活能力：

```text
观察/输入 → 规范化证据 → 动机/计划 → 合法行动 → 真实反馈
         → canonical world / role stage / memory → 可观察回放
```

必须保留的产品边界：

1. `persistentWorld.ingest` 是 canonical world 的唯一事实写入口。
2. `role-proposals`/trial/stage 是角色方向和阶段的唯一生命周期；聊天台词不能直接
   改人格、换壳或写世界。
3. 外部输入、网页正文、LLM、assistant/device 输出默认不可信，只能产生 evidence
   或 world candidate；受信 adapter 也必须经过领域规则。
4. Asamana 的“AI 是人类”不是 DeskBot 人格。喵呜仍是奇幻潮玩生命体，形态、职业、
   口癖和表达只从已采用的 role stage 投影出来。
5. 现实 1:1 时钟和 SQLite canonical ledger 继续有效。停机期间不补造没有安排的
   生活；恢复只结算真实到期且可验证的事务。
6. 虚拟 stage、表达或 TTS intent 不等于真实外壳、固件或机械动作已发生。

任何新 side-effect writer、第二套状态机、客户端 mutation 或绕过领域规则的 replay
均为标准违规，必须在实现前阻断。

## 2. 统一版本、身份与证据合同

每个迁移 run、operation、evidence、candidate、mutation、manual observation 都要
有稳定 ID，并携带：

| 字段 | 规则 |
| --- | --- |
| `schema` | 使用已登记的 `deskbot.*.vN` 合同；变更 schema 必须递增版本 |
| `rule_version` | 规则/validator 指纹；规则变化会使旧自动证据过期 |
| `content_version` | prompt、scene、world-event 或 experience package 指纹 |
| `run_id` / `operation_id` | 一次可恢复工作单元；重试复用同一业务键 |
| `source_event_ids` / `evidence_ids` | 可追溯到原始 canonical 或受控 fixture 来源 |
| `logic_time` | 逻辑日/时钟及 timezone；禁止只用 wall-clock 推断已发生生活 |
| `world_revision_before/after` | preview 必须相等，accept 才能递增 |
| `provider_mode` / `provider_calls` | `none`、`fixture`、`live`；replay 必须为 `provider_calls=0` |
| `namespace_coverage` | 列出实际读写 namespace；缺失 namespace 必须 fail closed |
| `status` / `error_class` | 区分 `success`、`skipped`、`failed`、`expired`、`rejected`、`not_executed`、`cancelled`、`unknown` |
| `base_commit` / `artifact_hash` | 证明证据对应的代码和报告，而不是“最新代码” |

证据记录最小形状：

```json
{
  "schema": "deskbot.migration-evidence.v2",
  "item_id": "M6b-R-http-route-operation-context",
  "run_id": "run-...",
  "base_commit": "...",
  "rule_version": "sha256:...",
  "commands": ["..."],
  "database_path": "<temporary sqlite>",
  "logic_time": {"start": "...", "end": "...", "timezone": "Asia/Shanghai"},
  "provider_mode": "fixture",
  "provider_calls": 0,
  "namespace_coverage": ["role.proposals", "operation.journal"],
  "positive": [{"case": "...", "result": "pass"}],
  "negative": [{"case": "...", "result": "pass"}],
  "restart_idempotency": {"fresh": "pass", "restart": "pass", "duplicate": "pass"},
  "manual_artifacts": [],
  "status": "automated_verified",
  "known_gaps": []
}
```

私有 fixture、真实对话、密钥、数据库、音频、截图临时目录不进入公开交付；公开
报告只保留脱敏引用和 hash。

## 3. 通用验收门 G0–G7

每一项只对其 `required_gates` 验收；`na` 必须写理由。门的通过不是“测试数量够了”，
而是下列证据全部存在：

| 门 | 必须证明 | 最低证据 |
| --- | --- | --- |
| G0 合同与权限 | schema、稳定 ID、唯一 writer、输入信任边界和失败分类已冻结 | 合同/静态检查 + catalog 记录 |
| G1 正向 | 最小成功、空结果/skip、异步完成和必要输出均落到正确 namespace | 专项测试 + semantic result |
| G2 安全 | 越权 payload、外部正文、assistant/device 输出、缺失/过期/篡改 fixture 不写事实 | 负向测试，明确 HTTP/领域错误 |
| G3 幂等 | 重试、重复事件、重复 accept、重复 tick 不重复计数、任务、mutation 或 provider call | duplicate replay + ledger/count 对比 |
| G4 重启与恢复 | 每个提交边界前后重启后状态相同；不补造停机生活 | fresh/restart SQLite 对比 |
| G5 原入口回放 | 使用原 handler/domain worker，不 SQL 导入、不读源库、不联网 | fixture replay、顺序与 semantic hash |
| G6 体验/长期观察 | 页面、声音、设备或跨日生活符合产品体验 | 人工记录/录屏/截图；自动证据单列 |
| G7 交付与可复核 | diff、敏感文件、版本和报告可复查；工作区可恢复 | `git diff --check`、文件清单、artifact hash |

### 3.1 状态升级

```text
planned → contract_drafted → implementation_in_progress
         → contract_verified → automated_verified → manual_pending → accepted
```

允许侧状态：

- `partial`：合同或原入口只完成一部分；不能宣传为完成。
- `inconclusive`：运行失败或观察窗不足，不能用绿灯替代。
- `gap`：无可用实现/证据。
- `blocked`：同一外部阻塞连续三次仍无法推进才可使用。
- `rolled_back`：新路径停用，canonical 历史保留。

自动化通过只能升到 `automated_verified`。有 G6 的项必须先 `manual_pending`，并且
人工证据确认后才能 `accepted`。规则、合同、fixture、代码或内容指纹变化时，旧
证据自动降级为 `stale`，重新通过受影响的门。

## 4. 每项迁移的最低测试剖面

为避免“只跑 happy path”，每个 item 必须执行适用的测试剖面：

- **P1 正向**：最小成功、合法空结果/skip、异步完成和正确引用。
- **P2 负向**：缺字段、错误 schema、越权 writer、错误来源、过期、篡改、未登记
  provider、provider/设备失败、未执行和取消。
- **P3 幂等**：相同业务键重复提交、网络重试、重复事件、重复 worker slot、重复
  candidate accept；比较 ledger、计数、revision、输出 hash。
- **P4 恢复**：初始化后、事务前、事务后、worker 中途和 provider 返回后重启；恢复
  后继续原状态，不重复副作用。
- **P5 回放**：仅受控脱敏 fixture，调用原 HTTP/domain/worker 入口，`provider_calls=0`，
  比较 namespace 覆盖、顺序、semantic hash 和错误分类。
- **P6 人工**：地图/故事/角色面板、语气和表情、设备 ACK 或跨日生活；保存观察窗与
  已知缺口，不把截图推断成 canonical 事实。

一个 item 的“完成”要求：G0 必过；P1/P2/P3/P4 必过；若声明 replay 则 P5 必过；
若 required G6 则 P6 必过；最后 G7 必过。

## 5. 回滚与失败处理

1. 失败只停用新 feature flag/worker；保留既有 world、role stage、task 和 ledger。
2. 测试只使用临时 SQLite；生产数据库只读快照或显式向前迁移。
3. preview 不产生 revision；accept 重新校验 candidate、权限、过期和 expected revision。
4. 不使用 `git reset --hard` 覆盖用户改动；回滚用代码开关或可恢复 commit。
5. 失败分类写进 evidence，不能用台词、日志或“看起来合理”的状态补齐事实。

## 6. 本轮执行边界

本轮从标准冻结进入逐项实现。已有 `automated_verified` 项只有在证据的
`base_commit`、规则指纹、内容指纹和 required gates 仍匹配时才可复用；否则先降为
`stale` 并重跑。每完成一个 item，必须先写入脱敏 evidence、更新 catalog/matrix，再
进行本地验证或本地提交；当前执行批次不自动 push 到远端。
