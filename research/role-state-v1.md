# `role-state.v1` 角色状态协议

## 目的

DeskBot Service 把对话、时间、设备传感器、外部事件和人工标注统一为事件，再汇总为可解释、可复现、可发送给设备的结构化状态。RisuAI/SillyTavern 若用于对照，其结果也只能作为普通输入事件；DeskBot Service 是唯一状态真相，`role-state.v1` 是其规范化交换格式。

## 最小 JSON

```json
{
  "schema": "foundry.role-state.v1",
  "identity": "构造组记录者",
  "revision": 3,
  "updated_at": "2026-08-12T10:00:00+08:00",
  "transition": {
    "previous_revision": 2,
    "rule_version": "evolution-rules.v0.1",
    "evidence_ids": ["evt-0003"],
    "changes": [
      {
        "path": "traits.agency",
        "before": 0.61,
        "after": 0.67,
        "reason": "角色主动接受共同制作任务"
      }
    ]
  },
  "traits": {
    "precision": 0.82,
    "openness": 0.31,
    "warmth": 0.54,
    "agency": 0.67
  },
  "evidence": [
    {
      "id": "evt-0003",
      "source": "dialogue",
      "event": "加入构造组",
      "summary": "角色主动接受共同制作任务",
      "weight": 0.8,
      "observed_at": "2026-08-12T09:58:00+08:00"
    }
  ],
  "visual_semantics": {
    "silhouette": "稳定、结构化",
    "symmetry": 0.8,
    "detail_density": 0.72,
    "openness": 0.35,
    "surface_language": "分层、可见连接"
  },
  "embodied_response": {
    "face": "focused",
    "yaw_deg": 12,
    "pitch_deg": -4,
    "tts_style": "precise",
    "display_theme": "amber"
  },
  "shell_trigger": {
    "semantic_distance": 0.43,
    "event_supported": true,
    "status": "candidate",
    "reason": "稳定性维度连续三次上升，超过候选阈值"
  }
}
```

## 字段约束

| 字段 | 约束 |
|---|---|
| `schema` | 固定为 `foundry.role-state.v1` |
| `revision` | 非负整数，每次状态提交递增 |
| `transition` | 记录前一版本、规则版本、证据引用和具体前后值 |
| `traits` | 0 到 1 的数值；第一版最多 6 个维度 |
| `evidence` | 每次变化至少关联一条证据；必须保留来源和时间 |
| `weight` | 0 到 1；表示该证据对状态更新的影响，不表示事实真假 |
| `visual_semantics` | 只放可映射到形态的中间语义，不直接放网格或 CAD 数据 |
| `embodied_response` | 设备可执行的短时反馈；角度范围由设备适配层裁剪 |
| `shell_trigger` | 只有存在证据且达到阈值时才允许进入 `candidate` |

## 第一版状态更新规则

1. 事件先进入 evidence ledger，不直接覆盖角色状态。
2. 同一来源的重复事件需要合并或降低权重，避免单一渠道垄断演化。
3. 状态变化必须记录前值、后值、使用的证据 ID 和规则版本。
4. 只有连续事件或累计语义距离达到阈值，才生成外壳候选；候选不等于自动换壳。
5. 任何人工修正都要标注 `source: manual`，不能伪装成模型推断。

第一版的 trait 维度是设计实验变量，不是对用户或角色进行心理诊断。维度命名和数量需要在先导实验后根据可区分性、映射稳定性和受试者理解度修订。

## 设备适配原则

DeskBot Service 向 ESP-CLAW/VoCat 薄设备层发送完整状态或增量事件均可，但设备端只执行 `embodied_response` 和明确授权的设备动作。设备不能自行修改 `traits`，只能把传感结果作为新事件回传，由服务决定是否形成 evidence。

机器校验文件位于 `protocol/role-state-v1.schema.json`，可运行示例位于 `examples/role-state.example.json`。

DeskBot Service、设备桥接层和实体桌宠之间的事件与命令格式见 `protocol/interaction-contract-v0.1.md`。
