# P4 角色方向与世界候选协议

本文定义两条彼此隔离、可审计的 P4 候选链。角色候选回答“喵呜可能想体验怎样的生活”；世界候选回答“外部 observation 是否可以转成受规则约束的世界变化”。它们不能互相代替，也不能由 LLM 台词直接提交。

## 1. 角色方向证据

### 来源和资格

角色方向由 `fantasy-pull.mjs` 将合格输入映射到内置或动态方向目录。方向提示可来自 `payload.role_direction` / `payload.direction_hint`，同一 `direction_id` 的提示会合并；动态方向至少需要可读的 label、life 和两条 cue。单条命令或喵呜自己的输出不能直接改变身份。

`payload.evidence_polarity` 的协议值为：

| 值 | 含义 | 对方向净分的影响 | 是否作为支持门槛证据 |
|---|---|---|---|
| `support` | 当前输入支持该方向 | 按匹配 cue、confidence 和时间衰减加分 | 是 |
| `conflict` | 当前输入明确反对该方向 | 以同一权重扣分，保留为可回查反证 | 否 |
| `neutral` | 命中相关线索，但不足以判断偏好 | 不加不扣，仍保留审计记录 | 否 |

没有该字段的旧事件继续按 `support` 处理，保持既有输入兼容。有限的中文显式否定识别只用于 `dialogue` 和 `user_profile`，并要求否定词与 cue 直接相邻；它不是通用情绪/语义分类器。天气、世界线、外部事实、设备上下文等层不做自然语言否定猜测：没有显式 polarity 时，已有 cue 命中沿用 `support` 兼容规则。

每条入选证据保留 event/evidence ID、来源与 layer、匹配 cue、polarity、confidence、发生/观测时间及加权贡献。旧证据随时间衰减；重复 event ID 不重复计入。角色 pull 的净分按加权 `support - conflict` 计算；neutral 只作审计，不影响净分。

候选门槛分开计算：至少 3 条支持证据、至少 2 个支持来源、净分达到保留线，才进入 `candidate`；冲突证据可以压低净分，但不能冒充支持证据或增加支持来源数。自动提案还需至少 2 个事件 UTC 日期且没有其他活动试行。当前事件日期桶使用 `occurred_at`，缺失时回退 `observed_at`，不是 canonical world 的 `logical_time` 日期。

### 状态流

```text
eligible input
  -> observing (support / conflict / neutral evidence retained)
  -> candidate (support count + support sources + net score gate)
  -> proposed (cross-UTC-date gate and no other active trial)
  -> trying (user explicitly chooses try)
  -> accepted / rejected / deferred (explicit decision after bounded trial)
  -> archived
```

提案不会自动开始试行；试行观察只由合格的用户聊天回合产生，assistant 回复、天气和其他非聊天 observation 不消耗试行回合。accepted 阶段仅投影为有限的生活、Scene 和表达倾向，不自动修改 Soul、canonical world 或外壳。

### 读取与同步

- `GET /api/roles/evolution` 与兼容别名 `GET /api/role-evolution/status`：读取 evidence、pull、候选、运行、提案、试行和阶段。
- `POST /api/roles/evolution/sync` 与兼容别名 `POST /api/role-evolution/run`：按持久化输入执行幂等聚合与提案同步。

## 2. 外部 observation 到世界候选

`world-candidates.mjs` 只把可识别的 observation 转成候选，不直接提交世界。候选记录来源事件/evidence、provenance、规则版本、白名单动作、动作指纹、预览、预期 world revision 和到期时间。相同 observation 指纹复用候选。

允许的动作仅为 `advance_time`、`apply_world_line_event`、`enqueue_pending_item`、`record_external_context`、`update_weather` 和 `advance_calendar`，每个候选最多四个动作。字段由服务端重新归一化，任意 `world.mutation` payload 不得从外部 observation 直通 canonical world。

- `GET /api/world/candidates` 和单候选读取接口只返回后端读模型。
- `POST /api/world/candidates/:id/preview` 重新验证白名单动作并更新 preview/revision，不写 canonical world。
- `POST /api/world/candidates/:id/accept` 检查 revision 后通过 `persistentWorld.ingest()` 写入 mutation ledger；revision 已变化时必须重新 preview。
- `POST /api/world/candidates/:id/dismiss` 持久化处置记录。

过期、陈旧 revision、非法动作和重复接受均有确定结果。没有显式接受就不会改变世界。当前候选链没有可视化面板，也没有自动新闻 provider；可以通过 API 和隔离数据库验收，不应把手工注入描述成自动新闻接入。

## 3. 验收边界

自动测试应覆盖：正向/冲突/中性分值与证据留存；旧事件缺省 polarity 兼容；只在 dialogue/user_profile 做 cue 邻接否定识别；支持证据/来源门槛与净分门槛分离；两日 UTC 门槛、幂等和重启恢复；世界候选 preview 无副作用、revision 冲突后重预览、accept/dismiss/过期与重复提交。

人工验收仍需使用真实模型和隔离数据库确认：喵呜不会把用户的一句否定误解释成长期人格转向；冲突会让方向降温但不会抹掉历史；外部 observation 经过 preview/accept 后产生的世界后果可被角色自然地生活化表达。当前这些测试不等同于纵向共同生活证明、自动新闻接入或浏览器可视化验收。
