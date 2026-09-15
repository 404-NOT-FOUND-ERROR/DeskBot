# GitHub 里程碑：P2 Fantasy Pull v0.1

**日期：** 2026-09-14  
**状态：** 已实现，候选管理、角色提案 API、有限试行和研究 Web 已验证

## 目标

把多源输入转成“喵呜最近被什么奇幻生活吸引”的可解释候选。候选不直接修改 Soul、canonical world、角色阶段或外壳。

## 已实现

- `apps/deskbot-service/src/fantasy-pull.mjs`：按湿地青蛙、星空观察者、工坊学徒、云朵梦境四类方向聚合事件；保留 evidence ID、来源、分数、吸引强度和观察/候选状态。
- 跨至少两个来源且至少三条证据后才进入 `candidate`；单一用户命令只能保持 `observing`。
- 证据聚合是确定性的，方向和阈值可测试，后续可替换为从实验数据导出的权重。
- 重复事件会合并，旧事件按时间衰减，低于保留线的方向会淘汰，候选数量有上限。
- 回归测试覆盖跨源候选、结构化天气/偏好字段和单句强制变身拒绝。

## 验收

`npm.cmd --prefix apps/deskbot-service test`：141/141 通过（当前工作区）；初版 P2 记录的 135/135 为历史快照。

## P3 入口

最高优先级候选已可转成 `role-direction-proposal.v0.1`，记录提案文本、想体验的生活、冷却时间和用户 `try/later/reject` 选择；选择会持久化为 `trying/deferred/rejected`，不会伪装成 `accepted` 或自动换壳。

服务 API 与研究 Web 已可读取方向吸引、创建提案、提交选择、开始试行、记录反馈、明确完成和归档；提案与试行观察分别保留阶段历史、event/evidence ID，可跨服务重启回读。

## P3 试行机制（2026-09-14）

- `startTrial` 为 `trying` 提案建立有限窗口（默认 5 次观察），记录开始时间、计数和状态。
- `recordTrialObservation` 接收 `positive/negative/neutral` 信号及 event/evidence ID；重复 event 幂等，不重复计数。活动试行中的完成用户回合由聊天编排自动追加 `neutral` 观察，明确正/负反馈仍由受控入口提供。
- 达到窗口后仅标记 trial `completed`，不会自动接受或换壳。
- `completeTrial` 必须由明确动作决定 `accepted/rejected/deferred`；接受只确认角色方向阶段，不改写 Soul 或外壳。活动试行以方向专属 overlay 临时影响聊天提示词，结束或回退后立即失效。
- 试行观察和完成原因持久化在提案记录中，可按证据链回放。
