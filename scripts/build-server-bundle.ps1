[CmdletBinding()]
param(
  [string]$OutputDir = (Join-Path $PSScriptRoot '..\work\server-bundle'),
  [string]$Version = '5.2.0'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$out = [IO.Path]::GetFullPath($OutputDir)
$stage = Join-Path $out "zhike-server-$Version"
$archive = Join-Path $out "zhike-server-$Version.zip"
if (-not ([IO.Path]::GetFullPath($stage)).StartsWith($out.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'stage must remain under output directory' }
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$include = @('infra\compose.yaml', 'infra\compose.prod.yaml', 'infra\.env.example', 'infra\README.md', 'infra\backup\backup.ps1', 'server\Dockerfile', 'server\Directory.Build.props', 'server\migrations', 'server\src', 'connectors\ws-worker', 'docs\server-version-deployment.md', 'docs\server-version-troubleshooting.md', 'docs\server-version-rollback.md', 'docs\hot-chat-profile-usage.md', 'docs\release-notes-5.2.0.md', 'docs\v5-implementation-report.md')

function Copy-TreeWithoutGeneratedArtifacts([string]$Source, [string]$Target) {
  $excludedDirectoryNames = @('bin', 'obj', 'node_modules', '.git', '.vs', 'TestResults')
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  $sourceRoot = [IO.Path]::GetFullPath($Source).TrimEnd('\\')
  Get-ChildItem -LiteralPath $sourceRoot -Force -Recurse | ForEach-Object {
    $relative = $_.FullName.Substring($sourceRoot.Length).TrimStart('\\')
    $segments = $relative -split '[\\/]'
    if ($segments | Where-Object { $excludedDirectoryNames -contains $_ }) { return }
    $destination = Join-Path $Target $relative
    if ($_.PSIsContainer) {
      New-Item -ItemType Directory -Force -Path $destination | Out-Null
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
    }
  }
}

foreach ($relative in $include) {
  $source = Join-Path $repo $relative
  if (-not (Test-Path -LiteralPath $source)) { throw "missing bundle input: $relative" }
  $target = Join-Path $stage $relative
  if ((Get-Item -LiteralPath $source).PSIsContainer) { Copy-TreeWithoutGeneratedArtifacts $source $target }
  else { New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null; Copy-Item -LiteralPath $source -Destination $target -Force }
}

$envExample = Join-Path $stage 'infra\.env.example'
if (-not (Test-Path -LiteralPath $envExample)) { throw '.env.example is required' }
$manifest = @(
  Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($stage.Length + 1).Replace('\','/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
  }
)
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'bundle-manifest.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
Write-Output (ConvertTo-Json @{ version = $Version; archive = $archive; sha256 = $hash; stage = $stage })
