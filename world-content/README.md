# 聚形域内容包

这里保存可评审的世界内容合同。当前运行时的唯一事实源仍是
`apps/deskbot-service` 的 canonical world 和 SQLite；这些文件是“雾灯镇
（Morrowmere）”第一版内容基线，用来让地图、Scene、NPC 行程和 Lorebook
召回有稳定的归属，不是客户端可以自行修改的第二套世界状态。

## 内容边界

- `settlements/morrowmere/settlement.json`：聚落身份、聚形域归属和叙事锚点。
- `locations.json`：地点的视觉语义、区域、Lore key 和运行时地点 ID；邻接与旅行结果仍由服务端裁决。
- `npcs.json`：NevaMind 式 NPC 结构的作者合同：身份、欲望、日程、状态、触发条件和合法行动。
- `schedules.json`：有限日程与时间槽；执行必须经过 `world-life` 和 mutation ledger。
- `stories.json`：第一人称 Scene/故事包素材；“机会”不是已经发生的事实。
- `lore.json`：按地点或话题召回的聚形域背景；不应整本注入每轮 prompt。
- `world-events.json`：以后接入世界线的事件模板；外界新闻、天气和用户偏好先进入 evidence，再经过世界规则解释。

服务端通过 `apps/deskbot-service/src/content-packages.mjs` 在启动后的首次读取时编译并校验这些文件：它检查聚落/setting 归属、canonical 地点覆盖、NevaMind NPC 字段、日程路线、故事包版本和事件模板。编译层只读，不写 SQLite；客户端只能通过 `/api/life/content-packages` 和 `/api/life/story-packages` 看到经过校验的目录与故事计划，不能直接把 JSON 当作世界状态。

当前内容驱动故事包是 `morrowmere-first-day-v1`「雾灯镇第一天：先听灯声」。它由 `stories.json` 生成，安装后由 shared-life 生成五步有限计划，再逐步交给 canonical mutation 执行。预览没有副作用；重复安装同一版本会被拒绝。

## 第一版定位

雾灯镇只是聚形域中的一个生活聚落。喵呜从桌边凝聚成猫型第一形态，
在这里与 NPC、地点和持续世界一起生活。小镇不会因为用户一句话直接改写；
只有世界规则允许的喵呜/NPC 行动，才会写入 canonical world，并在地图和故事
中留下可回放痕迹。
