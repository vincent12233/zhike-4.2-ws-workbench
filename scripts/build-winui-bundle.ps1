[CmdletBinding()]
param(
  [string]$OutputDir = '',
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version = '6.0.0',
  [ValidateSet('Debug','Release')]
  [string]$Configuration = 'Release',
  [string]$RuntimeIdentifier = 'win-x64',
  # WinUI 3 unpackaged apps need the Windows App SDK runtime resources
  # beside the executable. Keep self-contained as the safe default; use
  # -FrameworkDependent only when the target machine is known to have the
  # exact matching runtime installed.
  [switch]$SelfContained,
  [switch]$FrameworkDependent,
  # Development snapshots may be built from a dirty worktree. A publishable
  # bundle must opt in to this gate and is rejected unless Git is clean and
  # every executable/resource version source agrees with -Version.
  [switch]$ReleaseGate
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
  'node.exe',
  'server.mjs',
  'state-delta.cjs',
  'migrate-data.cjs',
  'migrations',
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

function Assert-SourceReleaseContract {
  $packagePath = Join-Path $resourcesRoot 'package.json'
  $serverPath = Join-Path $resourcesRoot 'server.mjs'
  $indexSourcePath = Join-Path $resourcesRoot 'index.html'
  $horizonPath = Join-Path $resourcesRoot 'modules\horizon-atelier.css'
  $setupPath = Join-Path $repo 'zhike-desktop-setup.iss'
  foreach ($requiredPath in @($packagePath, $project, $serverPath, $indexSourcePath, $horizonPath, $setupPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "release source is incomplete: $requiredPath" }
  }

  $packageVersion = [string]((Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json).version)
  if ($packageVersion -ne $Version) { throw "source version mismatch: package.json=$packageVersion expected=$Version" }
  $projectText = [IO.File]::ReadAllText($project)
  foreach ($tag in @('Version','InformationalVersion')) {
    if ($projectText -notmatch "<$tag>$([regex]::Escape($Version))</$tag>") { throw "source version mismatch: Zhike.Desktop.csproj $tag expected $Version" }
  }
  if ($projectText -notmatch "<FileVersion>$([regex]::Escape($Version))\.0</FileVersion>") { throw "source version mismatch: executable FileVersion expected $Version.0" }

  $serverText = [IO.File]::ReadAllText($serverPath)
  if ($serverText -notmatch "const APP_VERSION = '$([regex]::Escape($Version))'") { throw "source version mismatch: server.mjs expected $Version" }
  if (-not $serverText.Contains("'/modules/horizon-atelier.css'")) { throw 'Horizon Atelier is not present in the local static-resource allowlist.' }

  $parsedVersion = [Version]$Version
  $displayVersion = "$($parsedVersion.Major).$($parsedVersion.Minor)"
  $indexSource = [IO.File]::ReadAllText($indexSourcePath)
  if (-not $indexSource.Contains("<title>知客 $displayVersion · Horizon Atelier</title>")) { throw "index title does not identify Horizon Atelier $displayVersion" }
  $scrollIndex = $indexSource.IndexOf('scroll-system.css', [StringComparison]::Ordinal)
  $horizonIndex = $indexSource.IndexOf('horizon-atelier.css', [StringComparison]::Ordinal)
  if ($horizonIndex -lt 0 -or $scrollIndex -le $horizonIndex) { throw 'scroll-system.css must remain the final interaction layer after Horizon Atelier.' }

  $setupText = [IO.File]::ReadAllText($setupPath)
  $setupVersionPattern = '#define AppVersion "' + [regex]::Escape($Version) + '"'
  if ($setupText -notmatch $setupVersionPattern) { throw "source version mismatch: installer definition expected $Version" }
}

Assert-ChildPath $out (Join-Path $repo 'work') 'output path'
Assert-SourceReleaseContract
$sourceCommit = 'unavailable'
$sourceWorktreeDirty = $true
try {
  $commitCandidate = @(& git -C $repo rev-parse --verify HEAD 2>$null)
  if ($LASTEXITCODE -eq 0 -and $commitCandidate.Count -gt 0) {
    $sourceCommit = ([string]$commitCandidate[0]).Trim()
  }
  $gitStatus = @(& git -C $repo status --porcelain --untracked-files=all 2>$null)
  if ($LASTEXITCODE -eq 0) { $sourceWorktreeDirty = $gitStatus.Count -gt 0 }
} catch {
  $sourceCommit = 'unavailable'
  $sourceWorktreeDirty = $true
}
if ($ReleaseGate) {
  if ($sourceCommit -eq 'unavailable') { throw 'release gate requires a valid Git commit.' }
  if ($sourceWorktreeDirty) { throw 'release gate rejected a dirty worktree; commit the complete 6.0 source before publishing.' }
}
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
$blockedResourceNames = @('data', 'backups', 'logs', 'user-data', 'ai-credentials.json', 'desktop-tools.json', 'workspace.sqlite', 'main.cjs', 'preload.cjs', 'ws-preload.cjs', 'package.json', 'package-lock.json')
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
foreach ($required in @('server.mjs', 'modules\horizon-atelier.css')) {
  if (-not (Test-Path -LiteralPath (Join-Path $stage "resources\app\$required") -PathType Leaf)) { throw "bundle is missing resources/app/$required" }
}
if (Get-ChildItem -LiteralPath $resourceDestination -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -in $blockedResourceNames -or $_.Name -match '(?i)^(.*credentials.*|.*\.sqlite|.*\.db|.*\.log)$' }) { throw 'resource bundle contains blocked user data or credential files' }
$indexPath = Join-Path $resourceDestination 'index.html'
$versionMarker = '<!-- ZHIKE_BUILD_VERSION -->'
$index = [IO.File]::ReadAllText($indexPath)
if ([regex]::Matches($index, [regex]::Escape($versionMarker)).Count -ne 1) { throw 'WinUI sidebar version marker must appear exactly once in index.html' }
[IO.File]::WriteAllText($indexPath, $index.Replace($versionMarker, " &middot; v$Version$versionMarker"))
Copy-Item -LiteralPath (Join-Path $repo 'desktop\src\Zhike.Desktop\README.md') -Destination (Join-Path $stage 'README-desktop.md') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\local-desktop-deployment.md') -Destination (Join-Path $stage 'local-desktop-deployment.md') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\local-desktop-troubleshooting.md') -Destination (Join-Path $stage 'local-desktop-troubleshooting.md') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\hot-chat-profile-usage.md') -Destination (Join-Path $stage 'hot-chat-profile-usage.md') -Force
Copy-Item -LiteralPath (Join-Path $repo "docs\release-notes-$Version.md") -Destination (Join-Path $stage "release-notes-$Version.md") -Force
$optionalMigration = Join-Path $repo "docs\migrations\$Version-ws-timestamp-provenance.sql"
if (Test-Path -LiteralPath $optionalMigration -PathType Leaf) {
  $migrationDestination = Join-Path $stage 'migrations'
  New-Item -ItemType Directory -Force -Path $migrationDestination | Out-Null
  Copy-Item -LiteralPath $optionalMigration -Destination $migrationDestination -Force
}

$manifest = @(
  Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object {
    [ordered]@{
      path = $_.FullName.Substring($stage.Length + 1).Replace('\','/')
      bytes = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  }
)
$manifestDocument = [ordered]@{ sourceCommit = $sourceCommit; sourceCommitIsBase = $true; sourceWorktreeDirty = $sourceWorktreeDirty; releaseGate = if ($ReleaseGate) { 'passed' } else { 'development-snapshot' }; sourceSnapshot = "zhike-source-$Version.zip"; generatedAtUtc = [DateTime]::UtcNow.ToString('o'); version = $Version; runtime = $RuntimeIdentifier; selfContained = [bool]$useSelfContained; files = $manifest }
$manifestDocument | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'bundle-manifest.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal
$sourceCommit = if ([string]::IsNullOrWhiteSpace($sourceCommit)) { 'unavailable' } else { $sourceCommit }
if ($sourceCommit -ne 'unavailable') {
  $baseSourceArchive = Join-Path $out "zhike-source-$Version-base.zip"
  $sourceStage = Join-Path $out "zhike-source-$Version-staging"
  Assert-ChildPath $sourceStage $out 'source staging path'
  if (Test-Path -LiteralPath $sourceStage) { Remove-Item -LiteralPath $sourceStage -Recurse -Force }
  & git -C $repo archive --format=zip --output=$baseSourceArchive $sourceCommit
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $baseSourceArchive)) { throw 'source archive generation failed' }
  Expand-Archive -LiteralPath $baseSourceArchive -DestinationPath $sourceStage -Force
  # The base archive is created from HEAD, while this script is often run on
  # a dirty worktree.  Remove retired runtime trees explicitly before overlaying
  # current files so retired Docker/Electron sources cannot leak back into the
  # local-first source package for the current WinUI release.
  $sourceArchiveExcludedPrefixes = @(
    '.superpowers', '.codex-backups', 'desktop/.backups', 'docs/superpowers',
    'infra', 'server', 'connectors/ws-worker', 'tools/sqlite-to-postgres',
    'resources/app/main.cjs', 'resources/app/preload.cjs', 'resources/app/ws-preload.cjs',
    'desktop/src/Zhike.Desktop/Views/HomePage.xaml', 'desktop/src/Zhike.Desktop/Views/HomePage.xaml.cs',
    'desktop/src/Zhike.Desktop/Views/CustomersPage.xaml', 'desktop/src/Zhike.Desktop/Views/CustomersPage.xaml.cs',
    'desktop/src/Zhike.Desktop/Views/ImportPage.xaml', 'desktop/src/Zhike.Desktop/Views/ImportPage.xaml.cs',
    'desktop/src/Zhike.Desktop/Views/OperationsPage.xaml', 'desktop/src/Zhike.Desktop/Views/OperationsPage.xaml.cs',
    'desktop/src/Zhike.Desktop/Views/AiFollowupPage.xaml', 'desktop/src/Zhike.Desktop/Views/AiFollowupPage.xaml.cs',
    'desktop/src/Zhike.Desktop/Views/WsWorkbenchPage.xaml', 'desktop/src/Zhike.Desktop/Views/WsWorkbenchPage.xaml.cs',
    'scripts/build-server-bundle.ps1', 'scripts/build-installer.ps1', 'zhike-setup.iss',
    'docs/archive', 'tests/server-v2', 'tests/automatic-backup-test.cjs',
    'tests/ws-multi-account-main.test.cjs', 'tests/ws-installer-qa.cjs', 'tests/ws-upgrade-qa.cjs'
  )
  foreach ($prefix in $sourceArchiveExcludedPrefixes) {
    $targetPrefix = Join-Path $sourceStage ($prefix.Replace('/', '\'))
    Assert-ChildPath $targetPrefix $sourceStage 'excluded source path'
    if (Test-Path -LiteralPath $targetPrefix) { Remove-Item -LiteralPath $targetPrefix -Recurse -Force }
  }
  $statusLines = & git -C $repo -c core.quotepath=false status --short --untracked-files=all
  foreach ($line in $statusLines) {
    if ($line.Length -lt 4) { continue }
    $relative = $line.Substring(3).Trim('"')
    $relativeNormalized = $relative.Replace('\', '/')
    if ($sourceArchiveExcludedPrefixes | Where-Object { $relativeNormalized -eq $_ -or $relativeNormalized.StartsWith($_ + '/') }) { continue }
    $source = Join-Path $repo $relative
    $target = Join-Path $sourceStage $relative
    if (Test-Path -LiteralPath $source -PathType Leaf) {
      New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
      Copy-Item -LiteralPath $source -Destination $target -Force
    } elseif (Test-Path -LiteralPath $target -PathType Leaf) {
      Remove-Item -LiteralPath $target -Force
    }
  }
  if (Test-Path -LiteralPath $sourceArchive) { Remove-Item -LiteralPath $sourceArchive -Force }
  Compress-Archive -Path (Join-Path $sourceStage '*') -DestinationPath $sourceArchive -CompressionLevel Optimal
  Remove-Item -LiteralPath $baseSourceArchive -Force
  Remove-Item -LiteralPath $sourceStage -Recurse -Force
  # Release installers are kept in Git LFS and are delivered separately; they
  # are artifacts rather than source.  Refuse an unexpectedly expanded archive
  # so a smudge/filter regression cannot silently produce a multi-gigabyte
  # source package or make the hash race with a still-running LFS process.
  $sourceArchiveBytes = (Get-Item -LiteralPath $sourceArchive).Length
  if ($sourceArchiveBytes -gt 100MB) { throw "source archive unexpectedly exceeds 100 MB ($sourceArchiveBytes bytes)" }
}
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
$sourceHash = if (Test-Path -LiteralPath $sourceArchive) { (Get-FileHash -LiteralPath $sourceArchive -Algorithm SHA256).Hash } else { $null }
Write-Output (ConvertTo-Json @{ version = $Version; runtime = $RuntimeIdentifier; selfContained = [bool]$useSelfContained; releaseGate = if ($ReleaseGate) { 'passed' } else { 'development-snapshot' }; archive = $archive; sha256 = $hash; sourceArchive = $sourceArchive; sourceSha256 = $sourceHash; stage = $stage })
