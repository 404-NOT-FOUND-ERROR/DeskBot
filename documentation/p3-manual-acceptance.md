# P3 人工验收：共同生活连续性

这份验收针对 DeskBot 的 P3 持续生活层。它验证的是服务端 API、canonical world、SQLite 持久化和可审计 evidence；不等同于 LLM 文本质量、浏览器视觉质量、TTS、固件或长期陪伴体验验收。

## 前提与安全边界

- 先确认 DeskBot service 正在 `http://127.0.0.1:4311` 监听；脚本不会替你停止、启动或杀掉任何进程。
- 只读检查不改数据：`readiness`、`restart-verify`。
- 写入检查必须显式加 `-Execute`，会把唯一前缀为 `p3-manual-*` 的记忆、承诺、NPC 互动、摘要、世界事件和旅行写入当前数据库。运行前请确认这是可接受的测试环境。
- 不要删除或替换 `apps/deskbot-service/data/deskbot.sqlite`。重启验收必须继续使用同一个 `DESKBOT_DB_PATH`。
- 脚本使用 PowerShell 5.1 可运行的语法；在仓库根目录执行。

## 启动与健康检查

已有本地启动脚本时，按项目原有方式启动即可。例如：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\Jeremy\DeskBot'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -StartWeb
```

如果服务已在 4311 运行，不要重复启动；先运行只读检查：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario readiness
```

默认 Base URL 是 `http://127.0.0.1:4311`，端口不同可显式指定：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -BaseUrl 'http://127.0.0.1:4311' -Scenario readiness
```

## 验收场景

每个场景都会打印 `[PASS]`、`[FAIL]` 或 `[SKIP]`，末尾打印汇总。只读场景可以直接运行；其余场景没有 `-Execute` 时只会提示跳过。

### 1. 基线和寻路

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario readiness
```

通过标准：`/health`、canonical world、`/api/life/world`、地图均返回 200；若当前地点有邻接地点，路线返回 `found=true`。这只证明服务端路由投影可读，不替代客户端视觉验收。

客户端路线验收还应覆盖：选择远端地点后显示从起点到终点的完整折线；多段路线显示中转点和最终目的地标记；旅行动画沿同一折线逐段前进；服务端 revision 变化、路线失效或阻断后，旧预览被清除而不会继续显示；未知地点 fallback 只影响显示，不改变服务端路径事实。

### 2. 记忆修订

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario memory -Execute
```

脚本先写入一条确认记忆，再用 `fact_key + supersedes_id + resolve_conflict=true` 写入修订版，然后回读 `/api/life/memories`。通过标准：修订版文本存在，旧版不再出现在有效读模型中。历史对话审计记录不会被删除。

### 3. 承诺做到、错过、取消

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario commitments -Execute
```

脚本创建三条显式确认承诺，分别通过 `resolve` 写成 `kept`、`missed`，以及通过 `cancel` 写成 `cancelled`，最后回读承诺列表。通过标准：三种终态都可按唯一 ID 和 evidence ref 审计；没有任何承诺来自模型自动推断。

### 4. 每日摘要 preview/materialize

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario reports -Execute
```

脚本读取当前逻辑日，执行 `POST /api/life/daily-summary { operation: preview }`，确认摘要列表数量不变；随后执行 `materialize`，确认摘要出现在 `/api/life/daily-summaries`。通过标准：preview 无副作用，materialize 有稳定 `id`，`evidence_ids` 来自 canonical 记录；空日允许返回 `status=empty`，不应编造事件。

### 5. 关系趋势 evidence

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario trend -Execute
```

脚本选择当前地点的第一个 NPC，提交两次不同 `interaction_id` 的 `greet` / `chat` 互动，再读取 `/api/life/relationship-trends`。通过标准：该 NPC 的趋势为 `status=observed`，至少有两个 `evidence_ids`。若当前地点没有 NPC，脚本会 `[SKIP]`，请先在世界地图让喵呜抵达有 NPC 的地点。

### 6. 跨日 replay 和幂等

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario replay -Execute -ReplayId p3-replay-manual-01
```

脚本推进 1440 分钟（24 小时），再用同一个 `replay_id` 重放。通过标准：首次返回时间步，第二次所有步骤都是 `duplicate=true`，`logical_time_after` 不再推进。`replay_id` 最多 7 天范围；脚本不会自动重启服务。

### 7. 封路与重规划

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario route -Execute
```

脚本读取当前地点的直接邻接点，激活一个临时 `blocks_travel=true` 世界事件，重新规划并尝试旅行，再结束事件并重新规划。通过标准：

- 封路路线返回 `blocked=true` 和 `blocked_reason`；
- 旅行返回 HTTP 409、`error=travel_blocked`；地点与逻辑时间不改变；
- 解封路线返回 `blocked=false`；
- 重新规划后执行一跳合法旅行并抵达目标地点。

在客户端同步检查：封路或 revision 变化后，已显示的路线预览消失；解封并重新规划后，完整折线、中转点和目的地标记按新路线重建。

如果世界中已有用户事件处于 active 状态，脚本会跳过，不会覆盖或擅自结束它。

### 8. 重启后验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario restart-verify
```

脚本先读取 world、生活快照、记忆和摘要，并打印当前 revision/day/location。然后手动：

1. 停止 DeskBot service；不要删除 SQLite，也不要更换 `DESKBOT_DB_PATH`。
2. 用原来的 LLM、天气环境和数据库路径重新启动 4311。
3. 再运行 `restart-verify`，确认同一 world revision、逻辑日、地点和已写入的读模型仍可读取。
4. 若要验证 replay 跨重启幂等：重启前运行 `replay -Execute -ReplayId <同一 ID>`，重启后再次运行同一命令，后一次应全部为 duplicate。

## 一次运行全部检查

先做只读基线：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario all
```

确认测试数据库后，再运行写入场景：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\p3-acceptance.ps1 -Scenario all -Execute -ReplayId p3-replay-manual-all
```

`all` 会按 readiness、memory、commitments、reports、trend、route、replay、restart-verify 顺序执行；任何断言失败都会以非零退出码结束。

## 记录表

| 场景 | 时间 | Run ID / Replay ID | PASS/FAIL/SKIP | 证据 ID 或备注 |
| --- | --- | --- | --- | --- |
| readiness |  |  |  |  |
| memory |  |  |  |  |
| commitments |  |  |  |  |
| reports |  |  |  |  |
| trend |  |  |  |  |
| route |  |  |  |  |
| replay |  |  |  |  |
| restart-verify |  |  |  |  |

脚本输出的 `run=`、唯一 ID、关系趋势 `evidence_ids`、摘要 `id`、世界 mutation ID 和 replay ID 应填入备注，便于从 `/api/world/mutations`、`/api/life/relationship-trends`、`/api/life/daily-summaries` 回查。

## 验收边界

这些检查只能证明当前本地服务的持久化、规则约束、路由阻断、报告派生和 replay 幂等。它们不能证明：DeepSeek 回复是否自然、天气 provider 是否实时、浏览器页面是否美观、TTS 音色/音调、固件执行、摄像头/音频输入，或用户在第 30 天仍愿意主动回到桌面生命体。上述项目需要各自的真实环境验收。
