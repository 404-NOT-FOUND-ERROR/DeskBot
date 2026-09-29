# 测试覆盖图

本文件区分“仓库当前已经检查”与“建议但尚未完成”的证据。自动回归不是真实 DeepSeek、QWeather 或 ESP-VoCat 验收的替代品。

## Existing coverage

| 用例 | 规则/预期 | 证据 | 状态 |
|---|---|---|---|
| NPC Persona Agent | Persona 字段、Markdown 作者卡、Scene/关系提示词、HTTP 真实调用、fallback、重复请求幂等 | `npc-personas.test.mjs`、`world-life.test.mjs` | existing: local fake LLM |
| 雾灯镇内容合同 | settlement、地点归属、Lore key、NevaMind NPC 字段、日程与世界事件模板和 canonical world 对齐 | `morrowmere-content.test.mjs`、`persistent-world*.test.mjs` | existing |
| 内容包编译与第一天回放 | 只读校验作者包、故事目录来源、预览无副作用、五步 canonical 计划 | `content-packages.test.mjs`、`story-packages.test.mjs` | existing |
| 路线投影与旅行动画 | 统一地点锚点、完整路线折线、中转点、端点、道路拐点和分段动画时长；版本漂移清除预览；未知地点使用坐标 fallback，不改变服务端事实 | `canonicalGeometry.test.ts`、`routeVisual.test.ts`、`deskbotBridge.test.ts` | existing: 26 targeted client cases |
| 持久化真实墙钟 | 首次锚定、分钟余数、单次追赶上限、marker 中断恢复、SQLite 重启和 replay 幂等 | `persistent-world-clock.test.mjs` | existing: 5 cases |
| 输入与聊天幂等 | 相同 event/correlation 不重复回合；冲突返回错误 | `apps/deskbot-service/test/input.test.mjs`、`persistence-restart.test.mjs` | existing |
| 喵呜提示词 | seed/profile/反应节拍/边界字段进入 prompt | `chat-orchestrator.test.mjs`、`persistent-world.test.mjs` | existing |
| 角色试行表达覆盖 | 活动方向进入 prompt；用户回合 neutral 观察；同角色单活动试行 | `chat-orchestrator.test.mjs`、`role-proposals.test.mjs`、`role-proposals-http.test.mjs` | existing |
| 旧世界迁移 | `ember-001`/旧名迁移到 canonical ID/喵呜且保留历史 | `persistent-world-migration.test.mjs` | existing |
| 多源隔离 | 世界线、天气、用户偏好和设备事件按 route 分类，不自动播报 | `interaction-policy.test.mjs`、`multisource-prompt.test.mjs` | existing |
| 天气缓存 | TTL、force、观测时间单调、v7/v1 字段和错误不泄密 | `weather-connector.test.mjs`、`context-sources.test.mjs` | existing |
| P4-1 输入运行层 | 来源注册、TTL 到期判断、SQLite 状态恢复、失败退避、持久化失败隔离、canonical ingest callback 不被调度异常打断 | `input-runtime.test.mjs`、`weather-persistence.test.mjs` | implemented: 5 cases |
| P4 角色方向 evidence polarity | `support/conflict/neutral` 分别加分/扣分/只审计；缺省 polarity 兼容为 support；仅 dialogue/user_profile 有 cue 邻接中文显式否定识别；支持证据单独计数与跨源门槛 | `fantasy-pull.test.mjs` | implemented: targeted polarity cases |
| P4 角色演化闭环 | 独立来源聚合、UTC 事件日期提案门槛、候选/提案幂等物化、显式试行、仅用户聊天消耗试行回合、accepted 阶段提示词/表达/世界投影、SQLite 重启恢复、单句变形不越权 | `role-evolution.test.mjs`、`p4-acceptance.test.mjs`、`role-proposals-http.test.mjs`、`chat-orchestrator.test.mjs`、`world-life.test.mjs` | implemented |
| P4 外部事件到世界候选 | observation 来源/evidence/provenance 保留、白名单动作、preview 无副作用、revision 冲突需重预览、显式 accept/dismiss、过期/幂等/重启恢复 | `world-candidates.test.mjs`、`world-candidates-http.test.mjs`、`p4-acceptance.test.mjs` | implemented: backend/API; no visual candidate panel or automatic news provider |
| LLM 错误 | 不回显 provider body/secret；缺配置拒绝启动 | `llm.test.mjs` | existing |
| 设备 outbox/ACK | 白名单命令、重复 ACK、冲突 ACK 和失败可解释 | `output-router*.test.mjs`、`device-*.test.mjs` | existing |
| WebSocket/音频协议 | hello、能力协商、序列、hash、重连和播放边界 | `websocket-bridge.test.mjs`、`app-websocket.test.mjs`、`protocol-regression.test.mjs` | existing |
| 研究场景 | 固定场景隔离、可回放、无虚构 L1b 距离 | `research-scenarios.test.mjs`、`research-sessions.test.mjs` | existing |
| voice sidecar contract | ASR/TTS/cancel、超时、格式和错误 envelope | `voice-sidecar/tests/*`、`voice-sidecar-client.test.mjs` | existing |
| 世界线结果到 Scene 分支 | outcome/status 选择 authored branch；相同 cause 不重复 | `world-life.test.mjs` | implemented: targeted |
| NPC 多步目标 | 每 tick 一步；waiting/missed/failed 可重启恢复 | `npc-goals.test.mjs` | implemented: targeted |
| 支线经历检索 | 相关 query 返回 source/evidence；不进入 confirmed memory | `shared-life.test.mjs` | implemented: targeted |
| 共享生活连续性 | 承诺需显式确认并可重启恢复；关系趋势要求两条 mutation 证据；日报预览无副作用、空日不造事实、物化后可回读 | `shared-life-reports.test.mjs` | implemented |
| CI | Node service test workflow | `.github/workflows/service-test.yml` | existing/configured |

此前 Node 服务回归快照依次为 `145/145`、`180/180`、`186/186`、`194/194`、`216/216`、`223/223` 和 `244/244`。`244/244` 是 2026-09-30 P4 polarity / 世界候选增量之前的完整回归快照。当前 P4 工作区全量 Node service 回归为 `266/266`；Jev Town 客户端最近已知快照为 `16 files / 132 tests`，TypeScript 检查与生产构建通过；路线投影定向用例为 26 个。Python sidecar 本轮回归为 `16/16`（未把 provider 网络调用算作自动通过）。

2026-09-30 P4 验证：role evidence polarity 与跨 UTC 事件日期提案门槛的定向测试 `13/13` 通过；完整 Node service 回归 `266/266` 通过，覆盖角色演化、proposal decision 原子提交、world candidate preview/accept、幂等和 SQLite 重启恢复。

2026-09-11 运行态检查：`4311/health` 与 `4322/health` 均通过；服务实际加载 `openai-compatible-v0.1`。本次 PowerShell 对 `api.deepseek.com:443` 的直接连接被 Windows socket 权限策略拒绝，真实聊天因此返回 `502 llm_transport_error`；这不是 DeepSeek HTTP 错误。未加载 QWeather 环境文件时，天气状态明确为 `open-meteo / disabled`，不能把历史天气快照记为当前连接成功。

2026-09-16 运行态修订：沙箱外 DeepSeek 直连最小请求返回 HTTP 200；最新服务真实聊天返回 HTTP 202。角色样本验证了融合式功能话语、猫式开场、低风险代选、情绪承接、世界生活细节和“机会/悬念未观测前不得当作事实”的规则。当前服务 PID 由启动时动态分配，验收时以 `/health` 和当次请求为准；天气仍明确为 `open-meteo / disabled`。

2026-09-21 Persona Agent 修订：首轮 NPC 草稿若不满足 60-180 个中文字符、1-2 个短段落及“直接回应 + 具体物件/动作 + 人物判断 + 小选择”，或触发设定说明、客服套话、抽象词堆叠，会最多进行一次窄范围改写；若改写仍不合格，则丢弃两次模型草稿并使用 authored persona fallback。测试分别锁定合格首稿只调用一次模型、重复 interaction 不二次调用、坏稿触发二稿以及二稿失败回退。地图读模型继续验证 `toy_zone/prop_icon/material/signature_props`，Web 静态检查覆盖五种摆件 class 与移动 NPC 抽屉样式。

2026-09-18 当前运行复核：按 `scripts/start-local.ps1 -StartWeb` 以现有 DeepSeek/QWeather 配置重启后，`4311/health`、`4322/health` 和页面静态资源均返回 200；真实 `/api/chat` 使用 `openai-compatible-v0.1` 返回带具体桌面物件和小选择的喵呜样本；QWeather 当前观测刷新 `accepted=true,cached=false`，分钟/小时/每日预报分别返回 24/24/7 条；NPC Persona Agent 实际返回带路标、歪耳朵杯子、变色小路标和小动作选择的潮痕巡路员台词。voice-sidecar 仍未运行，浏览器视觉点击验收仍需可用浏览器或人工完成。

## Proposed tests

| 用例 | 类型 | 通过条件 | 状态 |
|---|---|---|---|
| 十类喵呜真实 DeepSeek 样本 | guarded live + manual review | utility/character/grounding/presence/variety 五项全 1 | partial: representative samples pass; full matrix open |
| 正式 QWeather v7/v1 刷新 | guarded live integration | 真实观测/预报、TTL、失败旧快照均可解释 | partial: current QWeather live smoke passed; v1/长期失败恢复仍 open |
| 认证和局域网暴露 | automated integration + security review | 未认证请求拒绝，Origin/速率/设备密钥有效 | proposed |
| CosyVoice/真实 ASR | guarded live + hardware | 20 回合一次且仅一次、延迟和播放失败可回放 | proposed |
| ESP-VoCat 真机 | hardware integration | hello、speak、expression、ACK、断线恢复 | proposed |
| 纵向角色变化 | manual longitudinal study | P2-P4 evidence/revision/阶段档案可完整回放 | proposed |
| 世界候选处置流程 | automated integration + manual review | 隔离数据库中完成 observation -> candidate -> preview -> accept/dismiss；预览无 mutation，accept 产生单次可回查 ledger 写入 | proposed |
| 跨日门槛的日期语义 | automated regression + design review | 明确使用 UTC observation date 还是 canonical world logical day；边界、时区、重放结果固定且可回归 | proposed |

## Gaps

- **高风险：** 当前无认证/授权/速率限制测试；禁止把 `0.0.0.0` 当作生产配置。
- **高风险：** QWeather 已有本轮真实观测和 24/24/7 预报 smoke，但长期失败恢复与 v1 兼容仍未形成稳定证据；真实语音出站仍未运行。DeepSeek 角色样本已在本轮重启后再次验证。
- **高风险：** 固件 agent 尚未提供真实设备 ACK、播放和断线证据。
- **中风险：** `expression_intent` 尚未驱动真实屏幕/TTS 三端一致性。
- **中风险：** P2-P4 角色方向 API、有限试行、accepted `role-state.v1` 和临时表达覆盖已实现；跨天稳定主动性、真实阶段演化和外壳映射尚未实现。
- **中风险：** 世界候选只有后端 API，尚无候选观测/处置面板或自动新闻 provider；UTC 日期门槛与虚拟世界 `logical_time` 尚未统一。

## Merge gate

合并到 `main` 至少要求：Node CI 通过、无密钥/SQLite/音频/临时输出、接口变化附迁移说明；角色表达变化还需附真实模型人工记录，硬件协议变化需通知固件 agent。
# 2026-09-16 shared-life verification

NPC editor follow-up: 157/157 passing, including frontend request mapping, priority order, empty input and maximum-alternative validation. JS syntax check passed; `/npc-goal-editor.js` returned HTTP 200 and proxied goal API returned successfully. Browser permission review timed out, so rendered desktop/mobile layout and actual browser clicks remain unverified. No live NPC goal was installed by verification.

NPC deployment verification follow-up: the running backend now exposes `/api/life/npc-goals` directly and through port 4322, both returning an empty goals array. Page HTTP 200; real DeepSeek chat returned successfully; QWeather refresh returned accepted=true, cached=false, condition=阴, temperature_c=27. No NPC goal was installed by this smoke test. This supersedes the earlier deployment-blocked status, but is not a browser visual test or live NPC goal lifecycle test.

NPC finite-goal follow-up: 156/156 passed. Tests cover waiting for canonical evidence, persisted pause/resume, single execution across reload, reservation/cancellation, failed-goal blocking, and replay of a persisted immutable decision after interrupted delivery. Tests do not validate an open-ended planner, LLM-generated goals, or longitudinal NPC experience. Goal creation remains opt-in through API.

Plan admission follow-up: 153/153 tests pass. Covers read-only domain preview, sequential NPC dependency, exclusive resource conflict and cancellation release, malformed steps and missing fields, plus runtime failure blocking. Future plans may still fail after manual world edits; installation validation is not a guarantee against later state changes.

Memory follow-up: 151/151 passing. Added old-note retrieval beyond 20 records, cross-character ID protection, SQLite-persisted deletion boundary, and HTTP chat checks proving previous user text and assistant paraphrases are excluded after correction/deletion. This validates prompt inputs, not guaranteed model behavior or deletion from historical audit records.

Follow-up: 149/149 tests passed after Web authoring and cancellation support. Added cross-source candidate threshold and cancellation/reload coverage. Frontend `node --check` passed. Deployed backend with existing local credentials; proxied memory/plan GETs returned successfully, page HTML contains the panel, real DeepSeek chat succeeded, and QWeather refresh returned accepted=true with a new observation. Browser visual/click validation remains blocked by `unsupported Codex auth method: apikey`. No sample plan or test memory was installed in the live database.

`npm.cmd --prefix apps/deskbot-service test`: 148 passed, 0 failed.
New `shared-life.test.mjs` checks SQLite restart persistence, explicit memory confirmation, revision, character isolation, physical note deletion, prompt inclusion, real HTTP memory-to-chat wiring, scheduled NPC-to-ledger wiring, cross-day clock simulation, bounded catch-up, duplicate prevention, and failure blocking. Test databases are isolated temporary files. These checks do not establish long-term user experience quality, real model memory recall quality, or deployed availability on port 4311. The running user service was not restarted in this change.
