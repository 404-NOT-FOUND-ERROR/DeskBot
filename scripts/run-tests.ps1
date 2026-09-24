[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location (Join-Path $repoRoot 'apps\deskbot-service')
try {
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Push-Location (Join-Path $repoRoot 'voice-sidecar')
try {
  & python -m unittest discover -s tests -v
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Push-Location (Join-Path $repoRoot 'apps\jev-town-client')
try {
  & npm.cmd run typecheck
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & npm.cmd exec vitest run tests/deskbotBridge.test.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Output 'DeskBot test suites passed.'
