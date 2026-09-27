[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://127.0.0.1:4311',
  [ValidateSet('readiness', 'memory', 'commitments', 'reports', 'trend', 'route', 'replay', 'restart-verify', 'all')]
  [string]$Scenario = 'readiness',
  [switch]$Execute,
  [string]$ReplayId
)

$ErrorActionPreference = 'Stop'
$script:PassCount = 0
$script:FailCount = 0
$script:SkipCount = 0
$script:RunId = 'p3-manual-{0}-{1}' -f (Get-Date -Format 'yyyyMMddHHmmssfff'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$script:BaseUrl = $BaseUrl.TrimEnd('/')

function Write-Result {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][bool]$Passed,
    [string]$Detail = ''
  )
  if ($Passed) {
    $script:PassCount++
    Write-Host ('[PASS] {0}{1}' -f $Name, $(if ($Detail) { " - $Detail" } else { '' })) -ForegroundColor Green
  } else {
    $script:FailCount++
    Write-Host ('[FAIL] {0}{1}' -f $Name, $(if ($Detail) { " - $Detail" } else { '' })) -ForegroundColor Red
  }
}

function Write-Skip {
  param([Parameter(Mandatory = $true)][string]$Name, [string]$Detail = '')
  $script:SkipCount++
  Write-Host ('[SKIP] {0}{1}' -f $Name, $(if ($Detail) { " - $Detail" } else { '' })) -ForegroundColor Yellow
}

function Assert-Condition {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Detail = ''
  )
  Write-Result -Name $Name -Passed $Condition -Detail $Detail
  return $Condition
}

function Invoke-JsonApi {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body
  )
  $uri = if ($Path -match '^https?://') { $Path } else { "$script:BaseUrl$Path" }
  $request = @{
    Uri = $uri
    Method = $Method
    UseBasicParsing = $true
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $request.ContentType = 'application/json; charset=utf-8'
    $request.Body = ($Body | ConvertTo-Json -Depth 30 -Compress)
  }
  try {
    $response = Invoke-WebRequest @request
    $status = [int]$response.StatusCode
    $raw = [string]$response.Content
  } catch {
    $webResponse = $_.Exception.Response
    if ($null -eq $webResponse) { throw }
    $status = [int]$webResponse.StatusCode
    $raw = ''
    if ($webResponse.PSObject.Methods.Name -contains 'GetResponseStream') {
      $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
      try { $raw = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } elseif ($webResponse.Content) {
      $raw = [string]$webResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
    if ([string]::IsNullOrWhiteSpace($raw) -and $_.ErrorDetails.Message) {
      $raw = [string]$_.ErrorDetails.Message
    }
  }
  $parsed = $null
  if (-not [string]::IsNullOrWhiteSpace($raw)) {
    # ConvertFrom-Json in Windows PowerShell 5.1 has no -Depth parameter.
    try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $null }
  }
  return [pscustomobject]@{ Status = $status; Body = $parsed; Raw = $raw; Uri = $uri }
}

function Assert-Status {
  param(
    [Parameter(Mandatory = $true)]$Response,
    [Parameter(Mandatory = $true)][int[]]$Expected,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $ok = $Expected -contains [int]$Response.Status
  $detail = "HTTP $($Response.Status), expected $($Expected -join ',')"
  Assert-Condition -Condition $ok -Name $Name -Detail $detail | Out-Null
  return $ok
}

function Require-Execute {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not $Execute) {
    Write-Skip -Name $Name -Detail '此场景会写入真实数据库；请追加 -Execute'
    return $false
  }
  return $true
}

function Get-WorldState {
  $response = Invoke-JsonApi -Method GET -Path '/api/world/state'
  if (-not (Assert-Status -Response $response -Expected @(200) -Name '读取 canonical world')) { return $null }
  if ($null -eq $response.Body.world) {
    Assert-Condition $false 'canonical world 响应包含 world' | Out-Null
    return $null
  }
  Assert-Condition ($null -ne $response.Body.world.logical_time) 'canonical world 包含 logical_time' | Out-Null
  return $response.Body.world
}

function Invoke-Readiness {
  $health = Invoke-JsonApi -Method GET -Path '/health'
  Assert-Status $health @(200) '服务健康检查' | Out-Null
  $world = Get-WorldState

  $life = Invoke-JsonApi -Method GET -Path '/api/life/world'
  Assert-Status $life @(200) '读取世界生活快照' | Out-Null
  Assert-Condition ($null -ne $life.Body.current_scene) '世界生活快照包含 current_scene' | Out-Null

  $map = Invoke-JsonApi -Method GET -Path '/api/world/map'
  Assert-Status $map @(200) '读取世界地图' | Out-Null
  if ($map.Body) {
    Assert-Condition (@($map.Body.locations).Count -gt 0) '世界地图包含地点' | Out-Null
    $current = @($map.Body.locations | Where-Object { $_.current }) | Select-Object -First 1
    if ($current -and @($current.neighbors).Count -gt 0) {
      $target = @($current.neighbors)[0]
      $route = Invoke-JsonApi -Method GET -Path ('/api/world/route?destination_location_id={0}&character_id=shaping-001' -f [uri]::EscapeDataString([string]$target))
      if (Assert-Status $route @(200) '读取当前地点到相邻地点的路线') {
        Assert-Condition ($route.Body.route.found -eq $true) '路线 found=true' | Out-Null
      }
    } else {
      Write-Skip '读取相邻地点路线' '当前地点没有可用邻接点'
    }
  }
  if ($world) {
    Write-Host ('    world_revision={0}, day={1}, minute={2}, location={3}' -f $world.world_revision, $world.logical_time.day, $world.logical_time.minute_of_day, $world.protagonist.location_id)
  }
}

function Invoke-MemoryScenario {
  if (-not (Require-Execute '记忆修订')) { return }
  $oldId = "$script:RunId-memory-old"
  $newId = "$script:RunId-memory-new"
  $old = Invoke-JsonApi POST '/api/life/memories' @{
    id = $oldId; character_id = 'shaping-001'; text = '验收前偏好：旧路'; fact_key = "$script:RunId-preference"
    evidence_ref = "$script:RunId-old"; confirmed = $true
  }
  if (-not (Assert-Status $old @(200) '写入初始确认记忆')) { return }
  $corrected = Invoke-JsonApi POST '/api/life/memories' @{
    id = $newId; character_id = 'shaping-001'; text = '验收修订偏好：潮痕旧路'; fact_key = "$script:RunId-preference"
    supersedes_id = $oldId; resolve_conflict = $true; evidence_ref = "$script:RunId-correction"; confirmed = $true
  }
  if (-not (Assert-Status $corrected @(200) '写入修订后的确认记忆')) { return }
  $list = Invoke-JsonApi GET '/api/life/memories?character_id=shaping-001'
  if (Assert-Status $list @(200) '回读记忆修订结果') {
    $current = @($list.Body.memories | Where-Object { $_.id -eq $newId })
    $oldStillVisible = @($list.Body.memories | Where-Object { $_.id -eq $oldId })
    Assert-Condition ($current.Count -eq 1 -and $current[0].text -eq '验收修订偏好：潮痕旧路') '新记忆成为当前有效记录' | Out-Null
    Assert-Condition ($oldStillVisible.Count -eq 0) '旧记忆从有效读模型中移除' | Out-Null
  }
}

function Invoke-CommitmentScenario {
  if (-not (Require-Execute '承诺生命周期')) { return }
  $records = @(
    @{ id = "$script:RunId-commit-kept"; text = '验收承诺：看一眼潮痕旧路'; status = 'kept' },
    @{ id = "$script:RunId-commit-missed"; text = '验收承诺：记录一次水洼地图'; status = 'missed' },
    @{ id = "$script:RunId-commit-cancelled"; text = '验收承诺：给旧光留一个名字'; status = 'cancelled' }
  )
  foreach ($record in $records) {
    $created = Invoke-JsonApi POST '/api/life/commitments' @{
      id = $record.id; character_id = 'shaping-001'; text = $record.text
      due_at = (Get-Date).ToUniversalTime().AddHours(1).ToString('o'); evidence_ref = "$script:RunId-created"; confirmed = $true
    }
    if (-not (Assert-Status $created @(200) "创建承诺 $($record.status)")) { continue }
    $operation = if ($record.status -eq 'cancelled') { 'cancel' } else { 'resolve' }
    $resolved = Invoke-JsonApi POST '/api/life/commitments' @{
      operation = $operation; id = $record.id; status = $record.status
      evidence_ref = "$script:RunId-$($record.status)"; confirmed = $true
    }
    if (Assert-Status $resolved @(200) "结算承诺 $($record.status)") {
      Assert-Condition ($resolved.Body.status -eq $record.status) "承诺状态为 $($record.status)" | Out-Null
    }
  }
  $list = Invoke-JsonApi GET '/api/life/commitments?character_id=shaping-001'
  if (Assert-Status $list @(200) '回读承诺生命周期') {
    foreach ($record in $records) {
      $item = @($list.Body.commitments | Where-Object { $_.id -eq $record.id }) | Select-Object -First 1
      Assert-Condition ($null -ne $item -and $item.status -eq $record.status) "承诺 $($record.status) 已可审计" | Out-Null
    }
  }
}

function Invoke-ReportsScenario {
  if (-not (Require-Execute '每日摘要')) { return }
  $world = Get-WorldState
  if ($null -eq $world) { return }
  $day = [int]$world.logical_time.day
  $before = Invoke-JsonApi GET '/api/life/daily-summaries?character_id=shaping-001'
  if (-not (Assert-Status $before @(200) '读取摘要持久化列表')) { return }
  $preview = Invoke-JsonApi POST '/api/life/daily-summary' @{
    operation = 'preview'; character_id = 'shaping-001'; day = $day
  }
  if (Assert-Status $preview @(200) '预览每日摘要（无副作用）') {
    Assert-Condition ($null -ne $preview.Body.summary -and $preview.Body.summary.world_day -eq $day) '预览摘要对应当前逻辑日' | Out-Null
  }
  $afterPreview = Invoke-JsonApi GET '/api/life/daily-summaries?character_id=shaping-001'
  if (Assert-Status $afterPreview @(200) '确认 preview 未新增持久化摘要') {
    Assert-Condition (@($afterPreview.Body.summaries).Count -eq @($before.Body.summaries).Count) 'preview 不改变摘要列表数量' | Out-Null
  }
  $materialized = Invoke-JsonApi POST '/api/life/daily-summary' @{
    operation = 'materialize'; character_id = 'shaping-001'; day = $day
  }
  if (Assert-Status $materialized @(200) '物化每日摘要') {
    Assert-Condition ($null -ne $materialized.Body.summary.id) '物化摘要有稳定 id' | Out-Null
    $listed = Invoke-JsonApi GET '/api/life/daily-summaries?character_id=shaping-001'
    if (Assert-Status $listed @(200) '回读物化摘要') {
      Assert-Condition (@($listed.Body.summaries | Where-Object { $_.id -eq $materialized.Body.summary.id }).Count -eq 1) '物化摘要出现在持久化列表' | Out-Null
    }
  }
}

function Invoke-TrendScenario {
  if (-not (Require-Execute '关系趋势 evidence')) { return }
  $life = Invoke-JsonApi GET '/api/life/world'
  if (-not (Assert-Status $life @(200) '读取可互动 NPC')) { return }
  $npc = @($life.Body.encounters) | Select-Object -First 1
  if ($null -eq $npc) {
    Write-Skip '关系趋势互动' '当前地点没有同场 NPC；请先在世界面板让喵呜抵达有 NPC 的地点'
    return
  }
  $first = Invoke-JsonApi POST '/api/life/npc-interactions' @{
    interaction_id = "$script:RunId-trend-1"; npc_id = $npc.npc_id; intent = 'greet'
  }
  Assert-Status $first @(200) '第一次 NPC 相遇记录' | Out-Null
  $second = Invoke-JsonApi POST '/api/life/npc-interactions' @{
    interaction_id = "$script:RunId-trend-2"; npc_id = $npc.npc_id; intent = 'chat'
  }
  Assert-Status $second @(200) '第二次 NPC 相遇记录' | Out-Null
  $trends = Invoke-JsonApi GET ('/api/life/relationship-trends?npc_id={0}' -f [uri]::EscapeDataString([string]$npc.npc_id))
  if (Assert-Status $trends @(200) '读取关系趋势') {
    $trend = @($trends.Body.trends | Where-Object { $_.npc_id -eq $npc.npc_id }) | Select-Object -First 1
    Assert-Condition ($null -ne $trend -and $trend.status -eq 'observed') '关系趋势达到 observed' | Out-Null
    Assert-Condition ($null -ne $trend -and @($trend.evidence_ids).Count -ge 2) '关系趋势包含至少两个 evidence_id' | Out-Null
  }
}

function Invoke-ReplayScenario {
  if (-not (Require-Execute '跨日 replay 幂等')) { return }
  $id = if ($ReplayId) { $ReplayId } else { "$script:RunId-replay" }
  $body = @{ minutes = 1440; replay_id = $id }
  $first = Invoke-JsonApi POST '/api/life/world/replay' $body
  if (-not (Assert-Status $first @(200) '执行一次 24 小时世界 replay')) { return }
  Assert-Condition (@($first.Body.steps).Count -gt 0) 'replay 返回至少一个时间步' | Out-Null
  $second = Invoke-JsonApi POST '/api/life/world/replay' $body
  $duplicateStatus = Assert-Status $second @(200) '重复同一 replay_id'
  if (-not $duplicateStatus -and $second.Body) {
    Write-Host ('    replay duplicate response: error={0}, message={1}' -f $second.Body.error, $second.Body.message) -ForegroundColor DarkGray
  }
  if ($duplicateStatus) {
    Assert-Condition (@($second.Body.steps | Where-Object { -not $_.duplicate }).Count -eq 0) '重复 replay 的所有步骤均为 duplicate' | Out-Null
    Assert-Condition ((($second.Body.logical_time_after | ConvertTo-Json -Compress) -eq ($first.Body.logical_time_after | ConvertTo-Json -Compress))) '重复 replay 不再次推进逻辑时间' | Out-Null
  }
  Write-Host "    replay_id=$id（重启服务后请再次执行同一 ID，验证跨重启幂等）"
}

function Invoke-RouteScenario {
  if (-not (Require-Execute '封路与重规划')) { return }
  $map = Invoke-JsonApi GET '/api/world/map'
  if (-not (Assert-Status $map @(200) '读取封路前地图')) { return }
  $current = @($map.Body.locations | Where-Object { $_.current }) | Select-Object -First 1
  $target = if ($current) { @($current.neighbors)[0] } else { $null }
  if ([string]::IsNullOrWhiteSpace([string]$target)) {
    Write-Skip '封路与重规划' '当前地点没有直接相邻目的地'
    return
  }
  $before = Get-WorldState
  if ($null -eq $before) { return }
  if ($before.active_event) {
    Write-Skip '封路与重规划' "已有 active_event=$($before.active_event.event_id)，脚本不会覆盖用户事件"
    return
  }
  $eventId = "$script:RunId-blocker"
  $activated = Invoke-JsonApi POST '/api/event' @{
    event_id = "$script:RunId-activate"; type = 'world.mutation'; source = 'p3-manual-acceptance'; character_id = 'shaping-001'
    payload = @{ action = 'activate_event'; event = @{ event_id = $eventId; title = 'P3 验收中的逆风潮'; summary = 'temporary acceptance blocker'; blocks_travel = $true } }
  }
  if (-not (Assert-Status $activated @(200, 202) '激活临时封路事件')) { return }
  $routeBlocked = Invoke-JsonApi GET ('/api/world/route?destination_location_id={0}&character_id=shaping-001' -f [uri]::EscapeDataString([string]$target))
  if (Assert-Status $routeBlocked @(200) '封路后重新规划路线') {
    Assert-Condition ($routeBlocked.Body.route.blocked -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$routeBlocked.Body.route.blocked_reason)) '路线报告 blocked 与 blocked_reason' | Out-Null
  }
  $blockedRevision = if ($routeBlocked.Body.world_revision) { [int]$routeBlocked.Body.world_revision } else { [int]$before.world_revision + 1 }
  $blockedTravel = Invoke-JsonApi POST '/api/world/travel' @{
    event_id = "$script:RunId-blocked-travel"; character_id = 'shaping-001'; location_id = $target
    expected_world_revision = $blockedRevision; expected_from_location_id = $before.protagonist.location_id
  }
  $travelBlocked = $blockedTravel.Status -eq 409 -and $blockedTravel.Body.error -eq 'travel_blocked'
  Assert-Condition $travelBlocked '封路时旅行返回 409 travel_blocked' ('HTTP {0}, error={1}, message={2}' -f $blockedTravel.Status, $blockedTravel.Body.error, $blockedTravel.Body.message) | Out-Null
  $afterBlocked = Get-WorldState
  if ($afterBlocked) {
    Assert-Condition ($afterBlocked.protagonist.location_id -eq $before.protagonist.location_id -and $afterBlocked.logical_time.minute_of_day -eq $before.logical_time.minute_of_day) '封路失败不改变地点与时间' | Out-Null
  }
  $resolved = Invoke-JsonApi POST '/api/event' @{
    event_id = "$script:RunId-resolve"; type = 'world.mutation'; source = 'p3-manual-acceptance'; character_id = 'shaping-001'
    payload = @{ action = 'resolve_active_event'; event_id = $eventId; outcome = 'manual acceptance complete' }
  }
  if (-not (Assert-Status $resolved @(200, 202) '结束临时封路事件')) { return }
  $routeOpen = Invoke-JsonApi GET ('/api/world/route?destination_location_id={0}&character_id=shaping-001' -f [uri]::EscapeDataString([string]$target))
  if (Assert-Status $routeOpen @(200) '解封后重新规划路线') {
    Assert-Condition ($routeOpen.Body.route.blocked -eq $false) '解封后路线 blocked=false' | Out-Null
  }
  $afterResolve = Get-WorldState
  $travel = Invoke-JsonApi POST '/api/world/travel' @{
    event_id = "$script:RunId-travel"; character_id = 'shaping-001'; location_id = $target
    expected_world_revision = [int]$afterResolve.world_revision; expected_from_location_id = $afterResolve.protagonist.location_id
  }
  if (Assert-Status $travel @(200, 202) '解封后执行一跳合法旅行') {
    Assert-Condition ($travel.Body.accepted -eq $true -and $travel.Body.world_mutation.world.protagonist.location_id -eq $target) '旅行完成并到达新地点' | Out-Null
  }
}

function Invoke-RestartVerify {
  $world = Get-WorldState
  $life = Invoke-JsonApi GET '/api/life/world'
  $memories = Invoke-JsonApi GET '/api/life/memories?character_id=shaping-001'
  $summaries = Invoke-JsonApi GET '/api/life/daily-summaries?character_id=shaping-001'
  Assert-Status $life @(200) '重启后读取世界生活快照' | Out-Null
  Assert-Status $memories @(200) '重启后读取记忆' | Out-Null
  Assert-Status $summaries @(200) '重启后读取每日摘要' | Out-Null
  if ($world) { Write-Host ('    restart verification: revision={0}, day={1}, location={2}' -f $world.world_revision, $world.logical_time.day, $world.protagonist.location_id) }
  Write-Host ''
  Write-Host '    手动重启后复验：' -ForegroundColor Cyan
  Write-Host '    1) 停止当前 DeskBot service；不要删除 apps/deskbot-service/data/deskbot.sqlite。'
  Write-Host '    2) 用原来的 DESKBOT_DB_PATH、LLM 和天气环境重新启动 4311。'
  Write-Host '    3) 重新运行本脚本 -Scenario restart-verify。'
  Write-Host '    4) 若要验证 replay 跨重启幂等，重启前后用同一 -Scenario replay -Execute -ReplayId <id>。'
}

function Invoke-Scenario {
  switch ($Scenario) {
    'readiness' { Invoke-Readiness }
    'memory' { Invoke-MemoryScenario }
    'commitments' { Invoke-CommitmentScenario }
    'reports' { Invoke-ReportsScenario }
    'trend' { Invoke-TrendScenario }
    'route' { Invoke-RouteScenario }
    'replay' { Invoke-ReplayScenario }
    'restart-verify' { Invoke-RestartVerify }
    'all' {
      Invoke-Readiness
      Invoke-MemoryScenario
      Invoke-CommitmentScenario
      Invoke-ReportsScenario
      Invoke-TrendScenario
      Invoke-RouteScenario
      Invoke-ReplayScenario
      Invoke-RestartVerify
    }
  }
}

Write-Host "DeskBot P3 manual acceptance | run=$script:RunId | base=$script:BaseUrl | scenario=$Scenario | execute=$Execute" -ForegroundColor Cyan
if (-not $Execute -and $Scenario -in @('memory', 'commitments', 'reports', 'trend', 'route', 'replay', 'all')) {
  Write-Host '写入场景未执行；追加 -Execute 才会修改真实 canonical world/SQLite。' -ForegroundColor Yellow
}
try {
  Invoke-Scenario
} catch {
  $script:FailCount++
  Write-Host ('[FAIL] 脚本异常 - {0}' -f $_.Exception.Message) -ForegroundColor Red
}
Write-Host ''
Write-Host ('Summary: PASS={0} FAIL={1} SKIP={2} run={3}' -f $script:PassCount, $script:FailCount, $script:SkipCount, $script:RunId)
if ($script:FailCount -gt 0) { exit 1 }
exit 0
