# 伴生世界第一步验收

**日期：** 2026-10-04
**状态：** 规则合同与居民作者设计完成。

本次执行 [开发路线 v0.4](../development-roadmap-v0.4.md) 的第一步。目标是把现实同步时间、分级折射、可变地图、身份连续性与居民重设计转成一致且可校验的开发合同。

## 交付

- `world-content/companion-world/rules.v1.json`：时间、身体、人数、地图、身份、记忆与八类输入作用范围。
- `world-content/companion-world/residents.v1.json`：十二名居民，分别具有私人欲望、缺点、日常、持续项目、成败后果和关系矛盾。
- `apps/deskbot-service/src/companion-world-contract.mjs`：作者内容校验、无状态输入分类辅助函数及合同读模型。
- `GET /api/world/contract`：只读返回作者设计与实际世界状态，不安装内容或执行世界动作。
- 开发路线、居民说明及 README、架构与设计对照索引。

## 自动验证

使用本机 Node v24 运行 `node --test --test-reporter=spec test/companion-world-contract.test.mjs test/companion-world-contract-http.test.mjs`，23 项通过。专项覆盖现实时间比例、身体感知边界、三居民限制移除的设计合同、来源自声明不提权、过期观测、传输输出不强化人格、居民引用和只读接口无副作用。

随后在 `apps/deskbot-service` 运行完整 `node --test --test-reporter=spec`，289 项通过，零失败。`git diff --check` 通过，新路线与人物文档链接可解析。测试使用隔离或内存状态，不向正式存档注入验收故事。

## 本地运行检查

保留原来的 SQLite 路径，以原有 fake 模型预览配置重启后端。本地接口返回 `contract_only`、`rules_enforced_by_runtime: false` 和 `resident_catalog_installed: false`，作者居民数为 12，实际 NPC 为现有三名，实际地点数为 5。前端与 3D 服务继续使用原有后端地址。

自动测试证明合同、分类边界与现有服务兼容；尚未进行新居民真实模型对话验收、十二居民运行安装、现实同步旅行或真实硬件感知联调。

## 下一步

执行第 2 步：建立现实同步时间锚点、当地日期、持续任务状态与真实耗时旅行。重启恢复、重复调度、路况阻断及暂停后继续需要保留一次执行和可追溯结果。此后再扩展地图、对象、自主生活及十二名居民的安装。
