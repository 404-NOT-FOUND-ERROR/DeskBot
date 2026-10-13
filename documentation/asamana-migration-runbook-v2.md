# Asamana → DeskBot 迁移作业单 v2

这是每个迁移项的可复制验收记录。它不写入生产数据库，不替代 catalog；完成一项
后把脱敏证据引用回写到 `documentation/asamana-migration-catalog-v1.json` 和矩阵。

## A. 开始前（必须）

```powershell
$item = '<item_id>'
$run = "<item_id>-$(Get-Date -Format yyyyMMddHHmmss)"
git status --short --branch
git rev-parse HEAD
node scripts/validate-migration-catalog.mjs
git diff --check
```

记录：

- `item_id`、run_id、当前 commit、分支和工作区是否干净；
- item 的依赖是否满足；
- SQLite schema、namespace 清单、rule/content fingerprint；
- 当前测试基线和 feature flag；
- 只读的已知 canonical revision（不要把生产数据库复制进证据目录）。

## B. 合同冻结卡

```text
item_id:
upstream_mechanism:
deskbot_modules:
authority_writer:
schema/contracts:
rule_version:
content_version:
trust_boundary:
idempotency_key:
transaction_boundary:
failure_classes:
dependencies:
rollback_switch_or_commit:
required_gates:
```

合同卡缺一字段只能保持 `contract_drafted`，不能开始实现。

## C. 测试矩阵

| case_id | 类型 | 场景 | 预期 | 实际 | 证据 |
| --- | --- | --- | --- | --- | --- |
| P1-01 | 正向 | 最小合法输入 | 正确 namespace/结果引用 |  |  |
| P1-02 | 正向/skip | 无新输入或合法空结果 | `skipped`，无伪事实 |  |  |
| P2-01 | 负向 | 缺字段/错误 schema | fail closed，不写状态 |  |  |
| P2-02 | 负向 | 越权 payload/外部正文/assistant output | 拒绝，不成为 evidence/mutation |  |  |
| P2-03 | 负向 | 过期、篡改、未登记 fixture | 明确错误，不半提交 |  |  |
| P2-04 | 负向 | provider/设备失败、取消、未执行 | 分类保留，不能伪造成功 |  |  |
| P3-01 | 幂等 | 相同 event/operation 重试 | 同一 ID、无额外计数/revision |  |  |
| P3-02 | 幂等 | duplicate accept/tick/ACK | 返回第一次结果或冲突，不重复副作用 |  |  |
| P4-01 | 恢复 | 事务前重启 | 未提交，无半状态 |  |  |
| P4-02 | 恢复 | 事务后/worker 中途重启 | 恢复同一状态，继续未完成工作 |  |  |
| P5-01 | 回放 | fresh/restart 使用原入口 | semantic hash/顺序一致 |  |  |
| P5-02 | 回放 | replay 运行 | `provider_calls=0`、不读源库/不联网 |  |  |
| P6-01 | 人工 | 页面/声音/设备/跨日生活 | 体验符合预期且边界可见 |  |  |

不适用行必须填写 `na_reason`。只执行 P1 不能升级任何完成状态。

## D. 运行命令与证据

```powershell
# 目录与模块专项
node scripts/validate-migration-catalog.mjs
npm.cmd --prefix apps/deskbot-service test -- <focused-test>

# 临时库 fresh/restart/replay（按 item 替换脚本）
$env:DESKBOT_DB_PATH = Join-Path $env:TEMP "$run.sqlite"
# 执行原 HTTP/domain/worker 入口；不要用 SQL 导入

# 全量回归与客户端
npm.cmd --prefix apps/deskbot-service test
npm.cmd --prefix apps/jev-town-client run typecheck
npm.cmd --prefix apps/jev-town-client run build
git diff --check
```

证据摘要必须包含：

```text
item_id:
run_id:
base_commit:
rule_version/content_version:
commands:
database_path: <temporary only>
logic_time/time_zone:
provider_mode:
provider_calls:
namespace_coverage:
positive:
negative:
duplicate:
restart:
replay:
manual_artifacts:
status:
known_gaps:
rollback_result:
```

## E. 状态升级签核

| 结论 | 条件 | 必填签核 |
| --- | --- | --- |
| `contract_verified` | G0 + 合同/负向边界可执行 | 合同卡、静态检查 |
| `automated_verified` | 适用 G0–G5、P1–P5 全通过 | 专项/全量结果、artifact hash |
| `manual_pending` | 自动门通过但 G6 尚未完成 | 人工场景清单、风险 |
| `accepted` | 所有 required gates（含 G6）通过，依赖已接受 | 人工记录、回滚验证、父任务复核 |
| `partial` | 只有部分接缝或明确缺口 | 缺口和下一门 |
| `inconclusive` | 运行完成但结果无法归因/观察不足 | 原始失败分类，不得美化 |
| `rolled_back` | 新路径停用，原历史保留 | 开关/commit、数据完整性 |

状态写回时必须同步：`evidence_refs`、`last_verified_at`、`base_commit`、
`known_gaps`。代码、合同、规则、fixture 或 content fingerprint 变化后先标 `stale`
并重新验收；不得沿用旧绿色证据。

## F. 完成后交接

1. 检查 `git diff --check` 和敏感文件清单；
2. 确认没有数据库、密钥、音频、真实个人对话、私有 replay tape、临时截图进入交付；
3. 更新 catalog、matrix、pipeline 和 README 的能力边界（只在必要时）；
4. 将下一依赖项、回滚方式和人工门交给父任务；
5. 不在本作业单中执行 commit/push，除非父任务另行决定。

## G. 当前首项执行卡

首项建议：`M6b-C-chat-handler-replay`。当前状态是 `partial`，已有受控用户 handler
fixture 证据，但仍缺 assistant 分支、独立 TTS fixture、success/error 全组合和全服务
原入口回放。完成前不得将 M6b 宣传为全服务完成，也不得打开全局
`requireOperationContext`。
