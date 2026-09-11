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

Write-Output 'DeskBot test suites passed.'
