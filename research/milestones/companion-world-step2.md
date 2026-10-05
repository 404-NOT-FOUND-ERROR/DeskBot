# 第二步验收：现实时间与持续任务

日期：2026-10-04。对应 [开发路线第 2 步](../development-roadmap-v0.4.md)。

## 交付行为

生产入口默认现实时间 1:1、时区 Asia/Shanghai。世界当地日期、昼夜与成长证据的跨日判断使用同一日历。旧存档保存迁移前逻辑时间、迁移 UTC 时间与起始日期，直接同步现实时间；不会继续叠加研究模式的旅行快进。模拟世界仍可独立回放，生产世界拒绝快进及日历日期、时区改写。

喵呜与 NPC 的移动创建 `travel` 持久任务，每段使用地图既有 `travel_cost` 分钟。出发返回 `travelling`，到期核验后才提交位置变化；多段行程由服务端继续，关闭网页不影响。暂停保存剩余毫秒，重启仍暂停；继续重算截止时间；取消或封路失败保持上次确认位置。出行角色不能在原位置制造当面互动。NPC 目标等待到期结果后才能完成，研究模式日程与现实日程分别编号，位置已经改变的旧决策不能重新执行。

制作与照料支持持久开始、到期完成及同样的任务控制。完成效果仅为 `record_activity_only`。材料、资源、产物、苗况和设施变化按第 4 步接入，当前不声称已经实现制作经济或种植模拟。

任务与世界位置在同一 SQLite 事务中提交，mutation event ID 保证幂等。恢复按到期顺序有界执行，并分别保存 `due_at`、`reconciled_at`、`late`；补算结果不能冒充停机时持续在线执行的日志。主角位置在途中代表上次确认位置，连续道路坐标与地图内部区域在第 3 步拓展。

## 接口与客户端

- `GET /api/world/tasks`：只读任务与剩余秒数。
- `POST /api/world/tasks`：白名单 `craft/care` 开始，或 `pause/resume/cancel` 控制。
- `POST /api/world/travel`：相邻第一站与可选最终目的地，返回已接受的持久任务；重复提交复用原时间并越过过期 revision 检查，内容冲突仍拒绝。
- `GET /api/world/map`：时钟、任务、实际位置与在途状态；两个客户端显示日期、在路上、预计完成和任务控制。
- `GET /api/world/contract`：现实存档返回 `partially_implemented` 与 `real_time_tasks: true`；新居民未安装、其余合同未全量执行的状态继续明确标记。

客户端只发起任务与读取结果。研究模式保留原即时动画；现实模式不立即调用抵达动画或输出抵达旁白。聊天上下文明确区分当前在途和上次确认位置。

## 验证与迁移

新增服务专项 14 项、客户端专项 2 项通过。完整服务回归 303 项、世界客户端回归 134 项通过，TypeScript 类型检查与 Vite 生产构建通过。覆盖真实午夜、直接停机校正、时钟回拨、拒绝快进、客户端伪造时间、SQLite 重启、重复结果、暂停续跑、取消、离线多段路线、封路失败、记录型制作与照料、事务失败回滚、NPC 等待、HTTP 重试与来源字段白名单、成长当地日期、旧模拟 NPC 决策隔离。日志保存在本地 `runtime/service-tests-companion-step2.log`、`runtime/world-tests-companion-step2.log`。

实际旧 SQLite 存档使用 Node SQLite backup API 备份，完整性检查 `ok`，迁移前包含 2332 条记录。备份路径：`D:/502 Bad Gateway/Codex Project/DeskBot Online/runtime/deskbot-before-realtime-2026-10-04T07-14-35-605Z.sqlite`。先用备份的副本独立启动迁移，健康检查通过、三名 NPC 和五个地点保留，然后部署到实际本地服务。副本验证结果为 `runtime/step2-migration-verification.json`。

浏览器已观察到北京时间日期、真实任务出发、暂停及继续状态。实际服务重启后暂停状态与 411277 毫秒剩余时间保持一致，随后通过页面恢复继续；三个 NPC 的出行按真实时间完成。制作、照料的到期结果通过独立 SQLite 与 HTTP 测试验证；没有修改生产时间加速验收。界面验收图位于 `D:/502 Bad Gateway/Codex Project/DeskBot Online/runtime/companion-world-step2.png`。

主角实际行程也完成了端到端核验：继续后的截止时间为北京时间 15:41:19.380，服务在 15:41:19.740 提交唯一抵达结果，页面随后显示潮痕旧路、当前场景与同地点居民，开放当面互动。抵达截图为 `D:/502 Bad Gateway/Codex Project/DeskBot Online/runtime/companion-world-step2-arrival.png`。任务 ID、暂停剩余时间和 SQLite mutation ledger 可用于复核。

## 本步边界与下一步

当前仍使用 fake LLM、本地预览与三名旧运行 NPC，语音和实际硬件没有在本步接入。十二名重新设计的居民按第 6 步安装。第 3 步开始把地图扩展为稳定地点、内部区域与可变通行合同，为物件、设施和居民的持续生活提供空间基础。
