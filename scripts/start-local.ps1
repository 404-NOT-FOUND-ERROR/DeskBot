[CmdletBinding()]
param(
  [switch]$StartWeb,
  [switch]$StartWorld,
  [string]$LlmConfigPath,
  [string]$WeatherEnvFile
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$serviceRoot = Join-Path $repoRoot 'apps\deskbot-service'
$webRoot = Join-Path $repoRoot 'apps\deskbot-web'
$worldRoot = Join-Path $repoRoot 'apps\jev-town-client'
$node = (Get-Command node.exe -ErrorAction Stop).Source

if ([string]::IsNullOrWhiteSpace($LlmConfigPath)) {
  $repoConfigPath = Join-Path $repoRoot 'config\llm_config.json'
  $legacyConfigPath = 'C:\Users\Administrator\Desktop\Jeremy\DeskBotClaude\foundry-bench\llm_config.json'
  if (Test-Path -LiteralPath $repoConfigPath -PathType Leaf) {
    $LlmConfigPath = $repoConfigPath
  } elseif (Test-Path -LiteralPath $legacyConfigPath -PathType Leaf) {
    # Compatibility for the existing workstation; clones should use config\llm_config.json.
    $LlmConfigPath = $legacyConfigPath
  } else {
    $LlmConfigPath = $repoConfigPath
  }
}

if (-not (Test-Path -LiteralPath $LlmConfigPath -PathType Leaf)) {
  throw "DeepSeek config not found: $LlmConfigPath. Copy config\llm_config.example.json to config\llm_config.json and fill it locally."
}

# The config file is read by Node; only the path and provider are exported.
$env:DESKBOT_LLM_PROVIDER = 'deepseek'
$env:DESKBOT_LLM_CONFIG = (Resolve-Path -LiteralPath $LlmConfigPath).Path

function Assert-PortFree([int]$Port, [string]$Name) {
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
      $_.LocalPort -eq $Port -and ($_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '::1' -or $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::')
    })
  if ($listeners.Count -eq 0) {
    $listeners = @(netstat -ano -p tcp | Select-String -Pattern (":$Port\s+.*LISTENING\s+(\d+)$"))
  }
  if ($listeners.Count -gt 0) {
    $pids = ($listeners | ForEach-Object {
        if ($_.PSObject.Properties['OwningProcess']) { $_.OwningProcess } else { ($_.Matches.Groups[1].Value) }
      } | Select-Object -Unique) -join ', '
    throw "$Name port $Port is already listening (PID $pids); stop the existing process or choose another port"
  }
}

function Test-PortOwned([int]$Port, [int]$ProcessId) {
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
      $_.LocalPort -eq $Port -and $_.OwningProcess -eq $ProcessId
    })
  if ($listeners.Count -gt 0) { return $true }
  $line = netstat -ano -p tcp | Select-String -Pattern (":$Port\s+.*LISTENING\s+$ProcessId$")
  return $null -ne $line
}

Assert-PortFree 4311 'DeskBot service'
if ($StartWeb) { Assert-PortFree 4322 'DeskBot web' }
if ($StartWorld) { Assert-PortFree 5173 'Jev Town world client' }
if ($StartWorld) {
  $viteEntry = Join-Path $worldRoot 'node_modules\vite\bin\vite.js'
  if (-not (Test-Path -LiteralPath $viteEntry -PathType Leaf)) {
    throw "Jev Town dependencies not installed: $viteEntry. Run npm.cmd install in apps\jev-town-client."
  }
}

if ($WeatherEnvFile) {
  if (-not (Test-Path -LiteralPath $WeatherEnvFile -PathType Leaf)) {
    throw "Weather env file not found: $WeatherEnvFile"
  }
  foreach ($line in Get-Content -LiteralPath $WeatherEnvFile) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { throw "Invalid weather env line" }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($name -notlike 'DESKBOT_WEATHER_*') { throw "Weather env file may only define DESKBOT_WEATHER_*" }
    Set-Item -Path "Env:$name" -Value $value
  }
}

$serviceLog = Join-Path $env:TEMP 'deskbot-service.log'
$serviceErrorLog = Join-Path $env:TEMP 'deskbot-service.error.log'
$webLog = Join-Path $env:TEMP 'deskbot-web.log'
$webErrorLog = Join-Path $env:TEMP 'deskbot-web.error.log'
$worldLog = Join-Path $env:TEMP 'deskbot-jev-town.log'
$worldErrorLog = Join-Path $env:TEMP 'deskbot-jev-town.error.log'
$service = Start-Process -FilePath $node -WorkingDirectory $serviceRoot -ArgumentList 'src/index.mjs' -RedirectStandardOutput $serviceLog -RedirectStandardError $serviceErrorLog -PassThru -WindowStyle Hidden
Write-Output "DeskBot service started: PID=$($service.Id) http://127.0.0.1:4311"
Write-Output "Service log: $serviceLog"
Write-Output "Service error log: $serviceErrorLog"

if ($StartWeb) {
  $web = Start-Process -FilePath $node -WorkingDirectory $webRoot -ArgumentList 'server.mjs' -RedirectStandardOutput $webLog -RedirectStandardError $webErrorLog -PassThru -WindowStyle Hidden
  Write-Output "DeskBot web started: PID=$($web.Id) http://127.0.0.1:4322/"
  Write-Output "Web log: $webLog"
Write-Output "Web error log: $webErrorLog"
}

if ($StartWorld) {
  $world = Start-Process -FilePath $node -WorkingDirectory $worldRoot -ArgumentList @($viteEntry, '--host', '127.0.0.1', '--port', '5173') -RedirectStandardOutput $worldLog -RedirectStandardError $worldErrorLog -PassThru -WindowStyle Hidden
  Write-Output "Jev Town world client started: PID=$($world.Id) http://127.0.0.1:5173/?mode=deskbot&deskbotUrl=http://127.0.0.1:4311"
  Write-Output "World log: $worldLog"
  Write-Output "World error log: $worldErrorLog"
}

Write-Output ("LLM provider requested: {0}; weather token present in this process: {1}" -f $env:DESKBOT_LLM_PROVIDER, [bool]($env:DESKBOT_WEATHER_TOKEN))

function Wait-ForHealth([string]$Uri, [int]$Port, [System.Diagnostics.Process]$Process, [string]$Name) {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    if ($Process.HasExited) {
      throw "$Name exited before becoming ready (exit code $($Process.ExitCode)); see the log files above"
    }
    try {
      $response = Invoke-WebRequest -Uri $Uri -Method Get -TimeoutSec 2 -UseBasicParsing
      if ($response.StatusCode -eq 200 -and (Test-PortOwned $Port $Process.Id)) { return }
    } catch { }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "$Name did not become ready at $Uri within 20 seconds; see the log files above"
}

Wait-ForHealth 'http://127.0.0.1:4311/health' 4311 $service 'DeskBot service'
if ($StartWeb) { Wait-ForHealth 'http://127.0.0.1:4322/health' 4322 $web 'DeskBot web' }
if ($StartWorld) { Wait-ForHealth 'http://127.0.0.1:5173/' 5173 $world 'Jev Town world client' }
Write-Output 'Health check: service ready'
if ($StartWeb) { Write-Output 'Health check: web ready' }
if ($StartWorld) { Write-Output 'Health check: Jev Town world client ready' }
