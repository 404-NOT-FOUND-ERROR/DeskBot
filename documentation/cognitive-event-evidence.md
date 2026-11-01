# 公共事件证据接口

2026-11-01，R3-A 事件证据第一批。共享定义为 [cognitive-event-evidence.v1.json](../contracts/cognitive-event-evidence.v1.json)，跨语言反例为 [event-evidence.v1.json](../contracts/fixtures/event-evidence.v1.json)。这是现有结果根、消息和约定的投影与校验，不新增事实库。

## 实际链路

`实际任务结算 → resultDisclosures → speech_evidence / choice_catalogue → Python 选项选择 → Node 复核与消息任务 → messageReceipt → actual_result.effects.communication → Python 后续预检 → Node 原子采用`

Node 的 `cognitive-event-evidence.mjs` 生成有限摘录和回执。`cognitive-social` 保持实际收件/发送记录；`cognitive-life-state` 沿原事务保存结果和个人反馈。Python 的 `event_evidence.py` 读取同一合同；`catalogue_choice` 校验责任，`continuation_contract` 校验反馈。失败归类为合同错误，不成为角色的亲历，也不自动换动机。

## 结果公开与送达

| 字段/对象 | 生产方与含义 | 边界 |
| --- | --- | --- |
| `deskbot.result-disclosure.v1` | Node 从本人已完成任务生成，含结果根、发生时间、字段与确定性编号 | 不复制整份结果、私人记忆或理由 |
| `completion_notice` | 只公布任务已完成 | 不包含实测读数，不等于已交付产物 |
| `result_extract` | 已登记方法的有限观测、前后值、条件、时间范围与产出/转移增量 | 是当时记录；包含环境变化，不证明单独因果；增量不含开工预留，未登记单位显示原始量纲 |
| `deskbot.message-receipt.v1` | 实际发送者、接收者、消息 ID、正文及 SHA-256、已公开摘录、时间和送达状态 | `understanding_verified` / `acceptance_verified` / `material_transfer` 均不由送达推导 |
| `communication_evidence_id` | 反馈引用本次实际回执 ID | 必须匹配，不能借另一条消息证明本次结果 |

选项把完成通知与读数摘录分开；选择后绑定的是确定正文。来源根只证明引用了哪个结果，接收者只能读取实际送达字段，不能由此访问来源全文。发送失败时回执不含已送达正文、哈希、公开摘录或消息 ID。

方法条件、字段和范围来自已登记执行器。暂限有限整份摘录，不是任意自然语言摘要或任意字段选择器；超过 1,400 字的未来方法需另写明确的公开投影，不能截断后声称完整告知。近期两个带结果摘录的任务可供后续选择，不因先发完成通知而立即丢掉读数；更长历史的检索与保留策略另行设计。

新回执存在时，后续 `reason` 的语义是**事实依据**，必须逐字等于 `receipt.summary`，并引用正确 ID。`question` 保留未来意向/疑问，个人感受留在独立记忆。程序不擅自替换模型回答；不匹配按原修复次数处理，仍失败便保留待反馈。此规则不声称已经验证任意主观自然语言。

## 已接受责任

`context.event_evidence.obligations` 只列本人物参与、双方明确加入、尚未过期/撤回且已到可履行时间的条款，含 `commitment_id`、`terms_revision` 与当前可履行 `choice_ids`。

`accepted_obligation` 必须携带 `obligation_ref:{commitment_id,terms_revision}`。目前范围复用既有赴约移动、明确交付、合作双方分工及共同进餐。无关活动不能选一份约定凑依据；其他动机不能夹带责任引用。没有新选项回执的提案也不能绕过责任检查。Python 绑定后，Node 在采用前重新检查当前条款；修改、撤回、重新待确认均使旧提案失效。

外部署名、单方面邀请、自己打算、已送达不等于接受。原 `social-life` 仍是约定和共同完成的执行者。旧存档的 `unknown` 保护保留，不追改历史动机。

## 兼容、空间与验收边界

- 冻结 job 没有新合同的，保留旧消息/反馈语义；不补造过去的送达凭据。新任务与新字段沿现有 SQLite 编码持久化，没有整库改写。
- 本轮只提供同地亲见的位置及时间；可联系人物的远处位置为未知。历史位置/实际告知/时效衰减尚未形成完整知识接口。
- 完成通知、指定结果和物品交接已经是不同绑定，但跨方法目标、稳定完成标准与复查生命周期仍需下一批；不能宣称所有目标语义已经统一。
- 原 10 月 31 日错误响应不修改，离线反例验证拒绝原错误。真实 Python 进程、Node 采用、实际任务、发送和 SQLite 关闭重开验证恢复后只补反馈。
- 本轮离线通过不改变旧批 18/20、15 有效的结论，不代表 R3-A 或自然持续生活验收通过。完整交付及后续见 [工程管线](../research/design/engineering-delivery-plan-2026-11-01.md)。
