[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$ArchiveName
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $repoRoot 'dist'
}

function Get-RepoRelativePath([string]$FullPath) {
  return ($FullPath.Substring($repoRoot.Length) -replace '^[\\/]+', '')
}

if ([string]::IsNullOrWhiteSpace($ArchiveName)) {
  $ArchiveName = 'DeskBot-source-{0}.zip' -f (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
}
if ([IO.Path]::GetExtension($ArchiveName) -ne '.zip') {
  $ArchiveName = "$ArchiveName.zip"
}

$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
$archivePath = Join-Path $resolvedOutput $ArchiveName
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ('deskbot-source-' + [guid]::NewGuid().ToString('N'))

# Build from the working tree so the package is useful before the first commit.
# Explicit exclusions are intentional: a public package must not depend on .gitignore being correct.
$excludedDirectoryNames = @('.git', '.pnpm-store', 'node_modules', 'tmp', 'dist', 'dist-server', 'build', 'coverage', '__pycache__', '.venv', 'venv', '.vercel', 'models', 'model-cache', 'checkpoints')
$excludedFileNames = @('config\llm_config.json', 'config\weather.env')
$excludedExtensions = @('.sqlite', '.sqlite-shm', '.sqlite-wal', '.log', '.wav', '.mp3', '.ogg', '.pyc', '.bin', '.onnx', '.pt', '.pth', '.safetensors')

function Test-PublicPackagePath([string]$RelativePath) {
  $normalized = $RelativePath.Replace('/', '\')
  $segments = $normalized -split '\\'
  if ($segments | Where-Object { $excludedDirectoryNames -contains $_ }) { return $false }
  if ($excludedFileNames -contains $normalized) { return $false }
  if ($normalized -match '(^|\\)(\.env($|\.)|.*credentials.*\.json$|.*secrets.*\.json$)') { return $false }
  if ($normalized -match '(^|\\).*[-_]test-output\.txt$') { return $false }
  if ($excludedExtensions -contains ([IO.Path]::GetExtension($normalized).ToLowerInvariant())) { return $false }
  return $true
}

function Get-PublicFiles([string]$Directory) {
  foreach ($item in Get-ChildItem -LiteralPath $Directory -Force) {
    if ($item.PSIsContainer) {
      if ($excludedDirectoryNames -contains $item.Name) { continue }
      Get-PublicFiles $item.FullName
      continue
    }
    $relative = Get-RepoRelativePath $item.FullName
    if (Test-PublicPackagePath $relative) { $item }
  }
}

try {
  New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
  $files = @(Get-PublicFiles $repoRoot | Where-Object { $_.FullName -ne $archivePath })

  if ($files.Count -eq 0) { throw 'No public source files found' }
  foreach ($file in $files) {
    $relative = Get-RepoRelativePath $file.FullName
    $destination = Join-Path $stagingRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination
  }

  New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
  if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
  Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = ([BitConverter]::ToString($sha256.ComputeHash([IO.File]::ReadAllBytes($archivePath))).Replace('-', '')).ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
  $manifestPath = [IO.Path]::ChangeExtension($archivePath, '.manifest.txt')
  @(
    "archive=$([IO.Path]::GetFileName($archivePath))"
    "sha256=$hash"
    "file_count=$($files.Count)"
    'excluded=.git,.pnpm-store,node_modules,tmp,dist,dist-server,build,coverage,.vercel,Python caches,SQLite/WAL,logs,audio,models,local configs'
  ) | Set-Content -LiteralPath $manifestPath -Encoding utf8

  Write-Output "Source archive: $archivePath"
  Write-Output "Manifest: $manifestPath"
  Write-Output "Files packaged: $($files.Count)"
  Write-Output "SHA-256: $hash"
} finally {
  if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
}
