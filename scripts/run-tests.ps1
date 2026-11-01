[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
  & node scripts/check-architecture.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node --test scripts/tests/architecture.test.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  # Use the same interpreter as the real bridge, including a local override.
  $cognitionPython = & node --input-type=module -e "import {findCognitionPython} from './apps/deskbot-service/src/cognition-bridge.mjs'; console.log(findCognitionPython())"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $cognitionPython = ($cognitionPython | Select-Object -Last 1).Trim()
  & $cognitionPython -c "import sys; from zoneinfo import ZoneInfo; assert sys.version_info >= (3,11); ZoneInfo('Asia/Shanghai')"
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.11+ with Asia/Shanghai timezone data is required. Install services/deskbot-cognition/requirements-test.txt.' }
  $env:DESKBOT_COGNITION_PYTHON = $cognitionPython
} finally {
  Pop-Location
}

Push-Location (Join-Path $repoRoot 'services\deskbot-cognition')
try {
  & $cognitionPython -m unittest discover -s . -p 'test_*.py' -v
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Push-Location (Join-Path $repoRoot 'apps\deskbot-service')
try {
  & node --test --test-concurrency=2
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Push-Location (Join-Path $repoRoot 'voice-sidecar')
try {
  & $cognitionPython -m unittest discover -s tests -v
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Push-Location (Join-Path $repoRoot 'apps\jev-town-client')
try {
  & npm.cmd exec -- vitest run --maxWorkers 2
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Output 'DeskBot architecture, cognition, service, voice and frontend checks passed. Real-model and natural-life acceptance are separate.'
