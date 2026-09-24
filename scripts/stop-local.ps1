[CmdletBinding()]
param(
  [int[]]$Ports = @(4311, 4322, 5173)
)

$ErrorActionPreference = 'Stop'
$processIds = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in $Ports -and $_.LocalAddress -in @('127.0.0.1', '::1', '0.0.0.0', '::') } |
  Select-Object -ExpandProperty OwningProcess -Unique)

if ($processIds.Count -eq 0) {
  Write-Output "No DeskBot listener found on ports $($Ports -join ', ')"
  exit 0
}

foreach ($processId in $processIds) {
  Stop-Process -Id $processId -Force -ErrorAction Stop
  Write-Output "Stopped PID=$processId"
}
