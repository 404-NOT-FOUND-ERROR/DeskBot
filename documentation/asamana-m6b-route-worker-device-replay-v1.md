# Asamana → DeskBot M6b-R：路由、Worker 与设备回放接缝合同 v1

> 状态：`planned / partial`（2026-10-14）
>
> 本文件冻结 M6b-R 的迁移标准和验收门。它不宣称当前服务已经覆盖全部入口；当前已验证的是 input-runtime 与 chat 的受控 fixture replay，voice/device 已接入第一批 operation scope 但完整原入口 replay 仍按本合同逐波次接入。

## 1. 目标与边界

M6b-R 把“一个写入操作”从临时 SQLite transaction 提升为可识别、可重启、可回放的业务 operation。回放必须重新进入原有 route/domain handler，不能把 SQL 记录直接导入目标库，也不能让客户端或外部文本获得 canonical world 写权限。

本波次覆盖：

- 直接 HTTP 写路由：role/life/world-candidate/research/interaction/device/voice/connector；
- 启动和定时 worker：world clock、tasks、shared-life、NPC goals、life-choice、slow-cognition、world-life、role sync、input-runtime；
- NPC 决策和目标步骤；
- WebSocket/device hello、dispatch、ACK、failure 与 ASR 回调。

不改变的事实所有权：`persistentWorld.ingest` 仍是 canonical world 唯一事实写入口；角色生命周期仍由 `role-proposals` 管理；外部观察先进入 candidate/review；真实 TTS、固件 ACK 和机械外壳不属于本波次的完成条件。route 通过 `ingestNonChatEvent` 产生的嵌套 ingress 使用 child operation；child envelope 必须记录 `parent_operation_id`，保留 route 与 ingress 的因果关系。

## 2. Operation 状态机

```text
received → validated → executing → awaiting_result → committed
                                      ├──────────────→ skipped
                                      ├──────────────→ failed
                                      ├──────────────→ duplicate
                                      └──────────────→ rejected

replay_pending → replayed | replay_failed
```

terminal 状态不可变。重试使用相同 `operation_id` 和幂等键；重复请求返回第一次结果，不生成第二个世界 mutation。没有写入的 read-only route 不创建 operation。

## 3. 稳定 operation ID 与 cadence

| 类别 | 稳定 ID |
| --- | --- |
| 世界节拍 | `scheduler:world:<logical-date>:<slot>` |
| 任务补算 | `scheduler:tasks:<revision>` |
| shared life / NPC goal | `scheduler:<worker>:<logical-date>:<slot>` 或 `npc-goal:<goal-id>:<step-id>` |
| NPC 决策 | `npc-agent:<decision-id>` |
| 慢认知 | `slow-cognition:<request-id>` |
| life choice | `life-choice:<request-id>` |
| 设备发送 | `device.send:<device-id>:<command-id>` |
| 设备回执 | `device.ack:<device-id>:<command-id>:<status>` |
| 设备失败 | `device.fail:<device-id>:<command-id>` |
| 设备握手 | `device.hello:<device-id>:<correlation-id>` |
| HTTP route | `<route_id>:<event_id|idempotency_key|entity_id>` |

同一 cadence 在同一逻辑时间只执行一次；timer 重复触发不能重复推进世界。

## 4. Registry

每个 side-effect writer 必须登记 `route_id`、业务入口、写入 namespace、状态、fixture/replay 要求和幂等键。当前 registry 分层如下：

### 已接入

- `http.chat` / `http.event`：通过 `ingestNonChatEvent` 或 chat handler；
- `input-runtime.source-run`：success/skip/error、TTL/backoff、重启/重复和 fail-closed fixture replay；
- `role/world-candidate/research` 的首批 route：已进入统一 scope，但原入口 replay 尚未完成，状态仍为 `partial`。
- `voice.asr`、`voice.transcribe`、`voice.tts`、`voice.cancel`：已进入稳定 operation scope；独立 `transcribe/tts` 已能消费私有 fixture 并在缺失/篡改时 fail closed，完整 fresh/restart/replay route archive 仍未完成。
- WebSocket `device.hello`、`device.event`、audio stream、command ACK 和本地 failure：已进入 bridge operation scope；完整 ACK/failure/restart/replay 门仍为 `partial`。

### 待接入的高价值 route

- `role.evolution.run`、proposal choose/trial/stage；
- `world.candidate.preview|accept|dismiss`；
- `life.autonomy`、`life.npc-goals`、`life.npc-interactions`、memory/plan；
- `research.scenario.run`、session/turn/probe/note/complete；
- `world.resources.transfer`、task、travel；
- weather/forecast refresh 和外部 connector。

GET-only read model route 不需要 operation，但只要隐含写入、materialize、refresh、ack 或 install，就必须登记。

## 5. Operation envelope v1

`replay-capture` 的公开 journal 不保存原始敏感请求或 provider 正文。每条 envelope 至少包含：

```json
{
  "schema": "deskbot.service-operation.v1",
  "capture_id": "capture:…",
  "index": 0,
  "operation_id": "role.evolution.run:…",
  "parent_operation_id": null,
  "operation_kind": "role.evolution.run",
  "route_id": "role.evolution.run",
  "source": "http.role",
  "status": "committed",
  "logic_time": "2026-10-14T…",
  "rule_version": "…",
  "content_fingerprint": "…",
  "adapter_ref": null,
  "request_hash": "sha256:…",
  "source_event_ids": [],
  "result_ref_ids": [],
  "transaction_id": "…",
  "before_namespace_digest": "…",
  "after_namespace_digest": "…",
  "canonical_revision_before": 0,
  "canonical_revision_after": 0,
  "writes": [],
  "record_hash": "…"
}
```

`committed_at` 只有在能够证明真实 SQLite commit 完成时才填写；before-commit hook 不伪造提交时间。当前 v1 hook 只提供 prepared boundary，因此 `status` 默认 `executing`、`before/after_namespace_digest` 可能为 `null`，不能据此宣称 R5 已通过。provider fixture 只存脱敏引用，私有 fixture registry 与公开 journal 分离。

## 6. Worker、NPC 与慢认知规则

- worker 必须从原 domain entry 执行；replay 禁止启动真实 timer 和 provider；
- slow-cognition/life-choice 记录 `request_id`、候选快照 hash、provider fixture ref、timeout/fallback 和 selected result；
- NPC decision 和 goal step 使用稳定业务 ID，不再以 `transaction:<uuid>` 作为唯一业务身份；
- assistant 回复、设备输出、transport/service 输出不能成为角色方向证据；
- accepted role stage 只投影到 prompt/scene/NPC 偏好，不能自动修改外壳、Soul 原文或真实设备。

## 7. WebSocket / device ACK

设备入口必须覆盖：hello、dispatch、ACK、failure、ASR callback。ACK 业务规则保留 duplicate、conflict、unknown device、wrong device、expired command、retry/failure；每个分支都要落入稳定 operation，并可在重启后重放。

## 8. M6b-R 验收门

- **R0 registry**：所有 side-effect namespace/route/worker/device writer 已登记，无 unknown writer；
- **R1 fresh**：success/error/skip/duplicate 均生成正确状态和稳定 ID；
- **R2 restart**：provider 前后、commit 前后、timer、ACK 中断后恢复一致；
- **R3 original entry**：replay 重新进入原 route/domain handler，不导入 SQL；provider calls 为 0；
- **R4 fail-closed**：删除、篡改、乱序、rule/content mismatch 不产生部分写入；
- **R5 digest**：canonical revision/sequence 与全部注册 namespace semantic digest 一致；
- **R6 async context**：context 跨 await、Promise.all、timer、WebSocket callback；
- **R7 ACK**：duplicate/conflict/expired/unknown/wrong-device/retry/failure；
- **R8 enforcement**：`requireOperationContext=true` 时未包装 writer 必须回滚并失败。

只有 R0–R8 全部通过，才可全局开启 `requireOperationContext`。在此之前，未覆盖入口明确标记为 `partial`，不得把受控 fixture replay 写成自然长期生活。

## 9. 迁移顺序

1. 冻结 registry、envelope 和 helper；
2. 接入 role/world-candidate/research 高价值 HTTP route；
3. 接入 life/NPC/slow-cognition/life-choice worker；
4. 接入 world/task scheduler 与 cadence 幂等；
5. 接入 WebSocket/device/voice/connector；
6. 每一波补 fresh/restart/replay/fail-closed 专项，更新 migration matrix、pipeline、runbook 和 tests；
7. R0–R8 全通过后再考虑 M8b 真实模型多日追求和 M8c 7–14 天现实观察。
