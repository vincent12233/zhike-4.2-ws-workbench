[CmdletBinding()]
param(
  [string]$OutputDir = '',
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version = '5.3.0',
  [ValidateSet('Debug','Release')]
  [string]$Configuration = 'Release',
  [string]$RuntimeIdentifier = 'win-x64',
  # WinUI 3 unpackaged apps need the Windows App SDK runtime resources
  # beside the executable. Keep self-contained as the safe default; use
  # -FrameworkDependent only when the target machine is known to have the
  # exact matching runtime installed.
  [switch]$SelfContained,
  [switch]$FrameworkDependent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$OutputDir = if ([string]::IsNullOrWhiteSpace($OutputDir)) { Join-Path $repo 'work\winui-bundle' } else { $OutputDir }
$out = [IO.Path]::GetFullPath($OutputDir)
$stage = Join-Path $out "zhike-winui-$Version-$RuntimeIdentifier"
$archive = Join-Path $out "zhike-winui-$Version-$RuntimeIdentifier.zip"
$sourceArchive = Join-Path $out "zhike-source-$Version.zip"
$project = Join-Path $repo 'desktop\src\Zhike.Desktop\Zhike.Desktop.csproj'
$iconSource = Join-Path $repo 'desktop\src\Zhike.Desktop\Assets\zhike.ico'
$resourcesRoot = Join-Path $repo 'resources\app'
$resourceAllowList = @(
  'index.html',
  'app.js',
  'styles.css',
  'modules',
  'vendor\xlsx'
)
$dotnetCandidates = @(
  (Join-Path $repo '.tools\dotnet10\dotnet.exe'),
  (Get-Command dotnet -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if (-not $dotnetCandidates) { throw 'dotnet SDK was not found; install .NET 10 SDK before building WinUI.' }
$dotnet = [IO.Path]::GetFullPath($dotnetCandidates[0])

function Assert-ChildPath([string]$Path, [string]$Parent, [string]$Label) {
  $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  if (-not $fullPath.StartsWith($fullParent, [StringComparison]::OrdinalIgnoreCase)) { throw "$Label must stay under $fullParent" }
}

Assert-ChildPath $out (Join-Path $repo 'work') 'output path'
if (-not (Test-Path -LiteralPath $project)) { throw "missing WinUI project: $project" }
if (-not (Test-Path -LiteralPath $iconSource -PathType Leaf)) { throw "missing WinUI application icon: $iconSource" }
if (-not (Test-Path -LiteralPath (Join-Path $resourcesRoot 'index.html'))) { throw "missing original page resources: $resourcesRoot" }
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

& $dotnet restore $project -r $RuntimeIdentifier -p:RestoreLockedMode=false -v:minimal
if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed with exit code $LASTEXITCODE" }
$useSelfContained = -not $FrameworkDependent -or $SelfContained
$publishArgs = @('publish', $project, '-c', $Configuration, '-r', $RuntimeIdentifier, '--no-restore', '-o', $stage, '-v:minimal')
$publishArgs += "-p:Version=$Version"
$publishArgs += "-p:AssemblyVersion=$Version.0"
$publishArgs += "-p:FileVersion=$Version.0"
$publishArgs += "-p:InformationalVersion=$Version"
if ($useSelfContained) {
  $publishArgs += '-p:WindowsAppSDKSelfContained=true'
  $publishArgs += '-p:WindowsPackageType=None'
  $publishArgs += '--self-contained'
  $publishArgs += 'true'
} else {
  $publishArgs += '-p:WindowsAppSDKSelfContained=false'
  $publishArgs += '-p:WindowsPackageType=None'
  $publishArgs += '--self-contained'
  $publishArgs += 'false'
}
& $dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

$exe = Join-Path $stage 'Zhike.Desktop.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "publish output missing Zhike.Desktop.exe: $exe" }
Copy-Item -LiteralPath $iconSource -Destination (Join-Path $stage 'zhike.ico') -Force
if (-not (Test-Path -LiteralPath (Join-Path $stage 'zhike.ico') -PathType Leaf)) { throw 'bundle is missing zhike.ico' }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'resources') | Out-Null
$resourceDestination = Join-Path $stage 'resources\app'
$blockedResourceNames = @('data', 'backups', 'logs', 'user-data', 'ai-credentials.json', 'desktop-tools.json', 'workspace.sqlite', 'node.exe', 'main.cjs', 'preload.cjs', 'ws-preload.cjs', 'server.mjs', 'migrate-data.cjs', 'package.json', 'package-lock.json', 'migrations')
$isAllowedResource = {
  param([string]$RelativePath)
  $normalized = $RelativePath.Replace('/', '\').TrimStart('\')
  foreach ($entry in $resourceAllowList) {
    $allow = $entry.Replace('/', '\').TrimEnd('\')
    if ($normalized.Equals($allow, [StringComparison]::OrdinalIgnoreCase) -or $normalized.StartsWith($allow + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}
foreach ($item in Get-ChildItem -LiteralPath $resourcesRoot -Recurse -Force) {
  $relative = $item.FullName.Substring($resourcesRoot.Length).TrimStart('\')
  if (-not (& $isAllowedResource $relative)) { continue }
  $parts = $relative -split '[\\/]'
  if ($parts | Where-Object { $blockedResourceNames -contains $_ -or $_ -match '(?i)^(.*credentials.*|.*\.sqlite|.*\.db|.*\.log)$' }) { continue }
  $destination = Join-Path $resourceDestination $relative
  if ($item.PSIsContainer) { New-Item -ItemType Directory -Force -Path $destination | Out-Null }
  else { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null; Copy-Item -LiteralPath $item.FullName -Destination $destination -Force }
}
foreach ($required in @('index.html', 'app.js', 'styles.css', 'vendor\xlsx\xlsx.js')) {
  if (-not (Test-Path -LiteralPath (Join-Path $stage "resources\app\$required") -PathType Leaf)) { throw "bundle is missing resources/app/$required" }
}
if (Get-ChildItem -LiteralPath $resourceDestination -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -in $blockedResourceNames -or $_.Name -match '(?i)^(.*credentials.*|.*\.sqlite|.*\.db|.*\.log)$' }) { throw 'resource bundle contains blocked user data or credential files' }
$indexPath = Join-Path $resourceDestination 'index.html'
$versionMarker = '<!-- ZHIKE_BUILD_VERSION -->'
$index = [IO.File]::ReadAllText($indexPath)
if ([regex]::Matches($index, [regex]::Escape($versionMarker)).Count -ne 1) { throw 'WinUI sidebar version marker must appear exactly once in index.html' }
[IO.File]::WriteAllText($indexPath, $index.Replace($versionMarker, " &middot; v$Version$versionMarker"))
Copy-Item -LiteralPath (Join-Path $repo 'desktop\src\Zhike.Desktop\README.md') -Destination (Join-Path $stage 'README-desktop.md') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\server-version-deployment.md') -Destination (Join-Path $stage 'server-version-deployment.md') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\server-version-troubleshooting.md') -Destination (Join-Path $stage 'server-version-troubleshooting.md') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\hot-chat-profile-usage.md') -Destination (Join-Path $stage 'hot-chat-profile-usage.md') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\release-notes-5.3.0.md') -Destination (Join-Path $stage 'release-notes-5.3.0.md') -Force

$sourceCommit = try { (& git -C $repo rev-parse HEAD).Trim() } catch { 'unavailable' }
$manifest = @(
  Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object {
    [ordered]@{
      path = $_.FullName.Substring($stage.Length + 1).Replace('\','/')
      bytes = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  }
)
$manifestDocument = [ordered]@{ sourceCommit = $sourceCommit; version = $Version; runtime = $RuntimeIdentifier; selfContained = [bool]$useSelfContained; files = $manifest }
$manifestDocument | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'bundle-manifest.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal
$sourceCommit = if ([string]::IsNullOrWhiteSpace($sourceCommit)) { 'unavailable' } else { $sourceCommit }
if ($sourceCommit -ne 'unavailable') {
  if (Test-Path -LiteralPath $sourceArchive) { Remove-Item -LiteralPath $sourceArchive -Force }
  & git -C $repo archive --format=zip --output=$sourceArchive $sourceCommit
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sourceArchive)) { throw 'source archive generation failed' }
  # Release installers are kept in Git LFS and are delivered separately; they
  # are artifacts rather than source.  Refuse an unexpectedly expanded archive
  # so a smudge/filter regression cannot silently produce a multi-gigabyte
  # source package or make the hash race with a still-running LFS process.
  $sourceArchiveBytes = (Get-Item -LiteralPath $sourceArchive).Length
  if ($sourceArchiveBytes -gt 100MB) { throw "source archive unexpectedly exceeds 100 MB ($sourceArchiveBytes bytes)" }
}
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$sourceHash = if (Test-Path -LiteralPath $sourceArchive) { (Get-FileHash -LiteralPath $sourceArchive -Algorithm SHA256).Hash } else { $null }
Write-Output (ConvertTo-Json @{ version = $Version; runtime = $RuntimeIdentifier; selfContained = [bool]$useSelfContained; archive = $archive; sha256 = $hash; sourceArchive = $sourceArchive; sourceSha256 = $sourceHash; stage = $stage })
