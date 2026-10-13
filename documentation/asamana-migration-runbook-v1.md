# Asamana → DeskBot 迁移作业单 v1

状态：`active`。当前工作分支为 `codex/asamana-m6b-seam-v6-4-input-runtime-replay`；v6.3/v6.2 记录保留为历史基线。本文是每一项迁移的执行与验收标准；能力状态仍以[正式迁移矩阵](asamana-migration-matrix-v1.md)为唯一事实源。它不把上游代码直接复制进 DeskBot，也不把受控 fixture 的通过结果写成自然长期生活。关联标准、管线与接缝合同见 [迁移标准](asamana-migration-standard-v1.md)、[迁移管线](asamana-migration-pipeline-v1.md) 和 [M6b 接缝合同](asamana-m6b-seam-contract-v1.md)。

## 1. 迁移单元

每一个迁移项必须有一个稳定的 `item_id`，并在开始前填写下表。没有完成字段的项目只能标记为 `planned`，不能进入 `automated verified`。

| 字段 | 要求 |
| --- | --- |
| `item_id` | 例如 `M6b-C2-chat-handler-replay`、`M6b-I5-input-runtime-replay` |
| 上游机制 | 文件、函数、版本和只迁移的工程机制 |
| DeskBot 权威 | 唯一状态存储、唯一写入口和不迁移的边界 |
| 输入/输出合同 | schema、版本、稳定 ID、规则版本、时间语义 |
| 信任边界 | 用户、模型、provider、设备、受信 adapter 各自能做什么 |
| 幂等键 | 重试、重复事件、重启后的唯一判定键 |
| 事务边界 | 业务写入、审计封套、fixture 引用是否同一提交；不能用事后 hash 替代 |
| 失败分类 | 缺失、过期、篡改、未授权、provider 失败、未执行、取消、未知 |
| 回滚点 | feature flag/代码点；数据只能用临时 SQLite 或向前迁移，不删除 canonical 历史 |
| 证据目录 | 测试命令、报告、数据库路径、逻辑时钟、namespace 覆盖、`provider_calls` |
| 人工验收 | 需要实际页面、声音、设备或长期观察时单独列出，不由单测替代 |

## 2. 状态机与升级规则

```text
planned
  -> contract_drafted
  -> implementation_in_progress
  -> contract_verified
  -> automated_verified
  -> manual_pending
  -> accepted
```

允许的非成功状态：

- `partial`：合同的一部分已经接入，但仍有明确缺口；不可作为完成能力对外宣传。
- `gap`：尚未有足够实现或原入口证据。
- `inconclusive`：运行过，但环境、模型或观察窗不足以判定成功；不能升级为通过。
- `blocked`：只有同一外部阻塞条件连续三次复核仍无法前进时才使用。

状态只能向前升级，除非新的负向证据将其降回 `partial` 或 `inconclusive`。测试全绿不自动跳过人工门；受控时间、mock provider 和 fixture 只证明规则链，不证明自然生活、真实声音或实体设备。

## 3. 固定执行管线

每个迁移项按以下顺序执行，缺一项就停止升格：

1. **基线快照**：记录当前 commit、工作区状态、SQLite schema/namespace、规则指纹和现有测试结果；不修改 `main`。
2. **合同冻结**：写入输入/输出 schema、唯一写入口、信任边界、幂等键和失败分类；先写负向边界。
3. **正向测试**：先证明最小成功路径、跨异步边界和正确的结果引用。
4. **负向测试**：缺字段、重复、越权、过期、篡改、provider/设备失败和半提交均必须 fail closed。
5. **实现接入**：复用现有唯一状态机/写入口；不得另建第二套 world、memory、role 或 replay writer。
6. **重启/回放**：在 fresh、关键操作前后、SQLite 重启和重复输入下使用原业务入口；provider replay 必须为 `provider_calls=0`。
7. **人工门**：需要页面、声音、设备或长期生活的项目，保存可复核截图/录屏/日志并标明时间；不把静态读模型当人工体验。
8. **审计与状态更新**：运行 `git diff --check`，生成证据清单，更新矩阵、管线和 README 的边界说明。

## 4. 统一验收门

| 门 | 必须证明 |
| --- | --- |
| G0 合同 | schema/rule/content version、稳定 ID、唯一写入口和拒绝边界冻结；静态检查通过 |
| G1 正向 | 成功、空结果/跳过和必要的 provider/设备结果能落到正确 namespace |
| G2 安全 | 未授权 payload、外部正文、assistant 台词、过期/篡改/缺 fixture 不获得写权限 |
| G3 幂等 | 相同 event/operation/retry 不重复计数、任务、证据、mutation 或输出 |
| G4 恢复 | 每个提交前后及 SQLite 重启恢复同一状态；不补造停机期间的生活 |
| G5 原入口回放 | 隔离库调用原 handler/domain route/worker；不 SQL 导入、不读源库、不联网；semantic hash 和顺序一致 |
| G6 体验 | 页面/声音/设备/长期观察按项目要求人工复核，自动化结果与人工结论分开 |
| G7 交付 | 仅提交相关源码、测试、协议和文档；密钥、数据库、音频、私有 replay tape、临时输出排除 |

## 5. 当前迁移顺序

| 波次 | `item_id` | 依赖 | 当前门 |
| --- | --- | --- | --- |
| G0 | `migration-program-standard` | M0–M6a 已有合同 | 本文、矩阵、管线和证据模板冻结 |
| C | `M6b-C0/C1` | operation journal | `partial / contract verified` |
| C | `M6b-C2/C3-chat-handler-replay` | C0/C1 | v6.3/v6.4 受控用户 handler LLM fixture replay 已通过专项 10/10 与服务端广套 861/861；独立 TTS fixture、assistant 分支和全服务 replay 仍未完成；缺/篡改 fixture 必须 fail closed |
| I | `M6b-I4/I7-input-runtime-replay` | C2 的 fixture/replay harness | `implemented / automated verified`：success/skip/error、重复 source 结果、重启、provider calls=0、缺失/篡改/未登记 source 负向门；真实 provider 长期观察仍待 M8 |
| R | `M6b-R-route-worker-device` | I4/I7 | 直接 HTTP、worker、WebSocket、设备 ACK |
| L | `M8b-grounded-live-model` | M3/M4/M6、Clash | 真实模型跨日目标追求 |
| W | `I2-world-event-content` | I1、M5、候选审核 | 多源输入生成合法世界事件 |
| V | `M7-render-long-disconnect` | M7/M7.1 | 浏览器 context loss、长断线人工门 |
| H | `M8c-natural-long-life` | L/W/V | 7–14 日现实 1:1 共同生活 |
| P | `P7/P8/P9` | H 及内容/资产审查 | 真实声音、实体外壳、开放形态 |

前一波未通过时，不开启下一波，也不把 `requireOperationContext` 全局打开。每波失败只停用新 worker/feature flag；保留既有 world、role stage、task 和 canonical ledger。

## 6. 回滚与数据安全

- 代码回滚到迁移前 commit 或关闭 feature flag；不使用 `git reset --hard` 覆盖用户改动。
- 测试和回放只使用临时 SQLite；生产库只做只读快照和显式向前迁移。
- preview 不产生 revision；accept 重新校验过期、revision、权限和合法 mutation。
- stage/experience 使用冻结 snapshot/hash 回退，不静默覆盖旧阶段；虚拟变化不代表真实外壳已变更。
- operation journal 只保存可审计摘要；私有 replay tape 可能包含重放所需的聊天/provider fixture，必须留在本机，绝不公开提交。
- 任何密钥、原始音频、真实个人对话、数据库、截图临时输出和模型缓存都不进入公开交付。

## 7. 证据清单模板

每波次报告至少包含：

```text
item_id:
base_commit:
rule_version/content_version:
commands:
database_path:
logic_time/time_zone:
provider_mode: none | fixture | live
provider_calls:
namespace_coverage:
positive:
negative:
duplicate/restart/replay:
manual_artifacts:
rollback_result:
status:
known_gaps:
```

本文的第一项执行对象是 `M6b-C2/C3-chat-handler-replay`；第二项已完成 `M6b-I4/I7-input-runtime-replay`。I 项的专项证据见 [input-runtime 回放验收记录](asamana-input-runtime-replay-v1.md)，通过的是受控本地 fixture 原入口回放，不等于真实 provider 长期运行。v6.4 的 chat 用户 handler LLM fixture replay 与 input-runtime replay 均为 scoped 证据；独立 TTS fixture、assistant 分支、直接 route/worker/WebSocket/device ACK 和全服务生产归档仍未完成，M6b 总体保持 `partial`，不能写成全服务完成。
