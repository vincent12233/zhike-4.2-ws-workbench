[CmdletBinding()]
param(
  [switch]$ForceDownload,
  [switch]$StageOnly,
  [string]$CacheRoot,
  [string]$OutputDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$WorkRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot 'work'))
if (-not $CacheRoot) { $CacheRoot = Join-Path $WorkRoot 'cache' }
if (-not $OutputDir) { $OutputDir = Join-Path $WorkRoot 'output' }
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$StageRoot = [IO.Path]::GetFullPath((Join-Path $WorkRoot 'staging\zhike-win-x64'))
$AppSource = Join-Path $RepoRoot 'resources\app'
$PackagePath = Join-Path $AppSource 'package.json'
$SetupPath = Join-Path $RepoRoot 'zhike-setup.iss'
$Package = Get-Content -LiteralPath $PackagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$AppVersion = [string]$Package.version
$ElectronVersion = [string]$Package.zhikeRuntime.electron
$NodeVersion = [string]$Package.zhikeRuntime.node
$ZhikeName = ([string][char]0x77E5) + [char]0x5BA2
$WorkbenchName = ([string][char]0x5DE5) + [char]0x4F5C + [char]0x53F0
$AppExeName = $ZhikeName + [char]0x79BB + [char]0x7EBF + $WorkbenchName + '.exe'
$InstallerName = $ZhikeName + "-$AppVersion-WS" + $WorkbenchName + [char]0x667A + [char]0x80FD + [char]0x5F55 + [char]0x5165 + [char]0x7248 + '.exe'

function Assert-ChildPath([string]$Path, [string]$Parent, [string]$Label) {
  $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  if (-not $fullPath.StartsWith($fullParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label must stay under $fullParent (received $fullPath)"
  }
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
}

function Relative-Path([string]$Base, [string]$Path) {
  $baseFull = [IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
  $pathFull = [IO.Path]::GetFullPath($Path)
  if (-not $pathFull.StartsWith($baseFull, [StringComparison]::OrdinalIgnoreCase)) { throw "$pathFull is outside $baseFull" }
  return $pathFull.Substring($baseFull.Length)
}

function Test-NodeVersion([string]$NodePath, [string]$Expected) {
  if (-not (Test-Path -LiteralPath $NodePath)) { return $false }
  try { return ((& $NodePath --version 2>$null).TrimStart('v')) -eq $Expected } catch { return $false }
}

function Get-VerifiedArchive(
  [string]$ArchiveUrl,
  [string]$ChecksumsUrl,
  [string]$FileName,
  [string]$DestinationDirectory
) {
  Ensure-Directory $DestinationDirectory
  $archive = Join-Path $DestinationDirectory $FileName
  $verified = "$archive.sha256"
  if ((Test-Path -LiteralPath $archive) -and (Test-Path -LiteralPath $verified)) {
    $expected = (Get-Content -LiteralPath $verified -Raw).Trim().ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -eq $expected) { return $archive }
    Remove-Item -LiteralPath $archive -Force
    Remove-Item -LiteralPath $verified -Force
  }

  $checksums = Join-Path $DestinationDirectory ("SHASUMS256-" + [Guid]::NewGuid().ToString('N') + '.txt')
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $ChecksumsUrl -OutFile $checksums
    $line = Get-Content -LiteralPath $checksums | Where-Object { $_ -match ("(^|\s)\*?" + [regex]::Escape($FileName) + '$') } | Select-Object -First 1
    if (-not $line) { throw "No checksum found for $FileName" }
    $expected = (($line -split '\s+')[0]).Trim().ToLowerInvariant()
    Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $archive
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
      Remove-Item -LiteralPath $archive -Force
      throw "SHA-256 mismatch for $FileName (expected $expected, got $actual)"
    }
    Set-Content -LiteralPath $verified -Value $expected -Encoding Ascii
    return $archive
  } finally {
    if (Test-Path -LiteralPath $checksums) { Remove-Item -LiteralPath $checksums -Force }
  }
}

function Resolve-ElectronRuntime {
  $localVersion = Join-Path $RepoRoot 'version'
  $localExe = Join-Path $RepoRoot $AppExeName
  if (-not $ForceDownload -and (Test-Path -LiteralPath $localVersion) -and (Test-Path -LiteralPath $localExe)) {
    if ((Get-Content -LiteralPath $localVersion -Raw).Trim() -eq $ElectronVersion) { return $RepoRoot }
  }

  $runtimeDir = Join-Path $CacheRoot "electron-$ElectronVersion-win32-x64"
  $runtimeExe = Join-Path $runtimeDir 'electron.exe'
  if (-not $ForceDownload -and (Test-Path -LiteralPath $runtimeExe) -and (Test-Path -LiteralPath (Join-Path $runtimeDir 'version'))) {
    if ((Get-Content -LiteralPath (Join-Path $runtimeDir 'version') -Raw).Trim() -eq $ElectronVersion) { return $runtimeDir }
  }

  if (Test-Path -LiteralPath $runtimeDir) { Remove-Item -LiteralPath $runtimeDir -Recurse -Force }
  $fileName = "electron-v$ElectronVersion-win32-x64.zip"
  $release = "https://github.com/electron/electron/releases/download/v$ElectronVersion"
  $archive = Get-VerifiedArchive "$release/$fileName" "$release/SHASUMS256.txt" $fileName (Join-Path $CacheRoot 'downloads')
  Ensure-Directory $runtimeDir
  Expand-Archive -LiteralPath $archive -DestinationPath $runtimeDir -Force
  if (-not (Test-Path -LiteralPath $runtimeExe)) { throw "Electron archive did not contain electron.exe" }
  return $runtimeDir
}

function Resolve-NodeRuntime {
  $localNode = Join-Path $AppSource 'node.exe'
  if (-not $ForceDownload -and (Test-NodeVersion $localNode $NodeVersion)) { return $localNode }

  $nodeDir = Join-Path $CacheRoot "node-v$NodeVersion-win-x64"
  $nodeExe = Join-Path $nodeDir 'node.exe'
  if (-not $ForceDownload -and (Test-NodeVersion $nodeExe $NodeVersion)) { return $nodeExe }

  if (Test-Path -LiteralPath $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
  $fileName = "node-v$NodeVersion-win-x64.zip"
  $release = "https://nodejs.org/dist/v$NodeVersion"
  $archive = Get-VerifiedArchive "$release/$fileName" "$release/SHASUMS256.txt" $fileName (Join-Path $CacheRoot 'downloads')
  $extractRoot = Join-Path $CacheRoot ("node-extract-" + [Guid]::NewGuid().ToString('N'))
  try {
    Expand-Archive -LiteralPath $archive -DestinationPath $extractRoot -Force
    $expanded = Join-Path $extractRoot "node-v$NodeVersion-win-x64"
    if (-not (Test-Path -LiteralPath (Join-Path $expanded 'node.exe'))) { throw "Node archive did not contain node.exe" }
    Move-Item -LiteralPath $expanded -Destination $nodeDir
  } finally {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
  }
  if (-not (Test-NodeVersion $nodeExe $NodeVersion)) { throw "Downloaded Node runtime is not v$NodeVersion" }
  return $nodeExe
}

function Copy-ElectronRuntime([string]$Source) {
  $sourceExe = if (Test-Path -LiteralPath (Join-Path $Source $AppExeName)) { $AppExeName } else { 'electron.exe' }
  Copy-Item -LiteralPath (Join-Path $Source $sourceExe) -Destination (Join-Path $StageRoot $AppExeName)

  $allowedFiles = @(
    'chrome_100_percent.pak', 'chrome_200_percent.pak', 'chrome_crashpad_handler.exe',
    'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'electron_wer.dll', 'ffmpeg.dll',
    'icudtl.dat', 'libEGL.dll', 'libGLESv2.dll', 'LICENSE', 'LICENSES.chromium.html',
    'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'version',
    'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll'
  )
  foreach ($name in $allowedFiles) {
    $sourcePath = Join-Path $Source $name
    if (Test-Path -LiteralPath $sourcePath) { Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $StageRoot $name) }
  }
  $locales = Join-Path $Source 'locales'
  if (-not (Test-Path -LiteralPath $locales)) { throw "Electron locales directory is missing: $locales" }
  Copy-Item -LiteralPath $locales -Destination (Join-Path $StageRoot 'locales') -Recurse
}

function Copy-AppSource {
  $destination = Join-Path $StageRoot 'resources\app'
  Ensure-Directory $destination
  foreach ($file in Get-ChildItem -LiteralPath $AppSource -File -Recurse) {
    $relative = Relative-Path $AppSource $file.FullName
    $lower = $relative.ToLowerInvariant()
    $extension = [IO.Path]::GetExtension($lower)
    $blocked = $lower -eq 'node.exe' `
      -or $lower -match '(^|\\)(data|backups?|logs?|user-data)(\\|$)' `
      -or $lower -match '(^|\\)\.env(?:\.|$)' `
      -or $lower -match '(^|\\)(ai-credentials|credentials|secrets|desktop-tools)\.json$' `
      -or @('.sqlite', '.sqlite3', '.db', '.log') -contains $extension
    if ($blocked) { continue }
    $target = Join-Path $destination $relative
    Ensure-Directory (Split-Path $target -Parent)
    Copy-Item -LiteralPath $file.FullName -Destination $target
  }
}

function Resolve-Iscc {
  $candidates = @(
    $env:INNO_SETUP_COMPILER,
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe' }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe' }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe' }),
    (Join-Path $RepoRoot '..\..\inno\ISCC.exe')
  ) | Where-Object { $_ }
  foreach ($candidate in $candidates) {
    $full = [IO.Path]::GetFullPath($candidate)
    if (Test-Path -LiteralPath $full) { return $full }
  }
  throw 'Inno Setup 6 compiler was not found. Install Inno Setup or set INNO_SETUP_COMPILER to ISCC.exe.'
}

Assert-ChildPath $StageRoot $WorkRoot 'staging path'
Ensure-Directory $WorkRoot
Ensure-Directory $CacheRoot
if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force }
Ensure-Directory $StageRoot

$ElectronRoot = Resolve-ElectronRuntime
$NodePath = Resolve-NodeRuntime
Write-Host "Using Electron $ElectronVersion from $ElectronRoot"
Write-Host "Using Node $NodeVersion from $NodePath"
Copy-ElectronRuntime $ElectronRoot
Copy-AppSource
$stagedApp = Join-Path $StageRoot 'resources\app'
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $stagedApp 'node.exe')

$required = @(
  $AppExeName, 'resources.pak', 'icudtl.dat', 'locales',
  'resources\app\node.exe', 'resources\app\main.cjs', 'resources\app\server.mjs',
  'resources\app\package.json', 'resources\app\migrations\005-ws-workbench.sql', 'resources\app\migrations\006-ws-workbench-hardening.sql'
)
foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $StageRoot $relative))) { throw "staging validation failed; missing $relative" }
}
if (Test-Path -LiteralPath (Join-Path $stagedApp 'data')) { throw 'staging must not contain resources/app/data' }
if (-not (Test-NodeVersion (Join-Path $stagedApp 'node.exe') $NodeVersion)) { throw 'staged Node version mismatch' }
$stagedVersion = (Get-Content -LiteralPath (Join-Path $stagedApp 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ([string]$stagedVersion -ne $AppVersion) { throw "staged app version mismatch: $stagedVersion vs $AppVersion" }

$commit = ''
try { $commit = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim() } catch {}
$files = @(Get-ChildItem -LiteralPath $StageRoot -File -Recurse | ForEach-Object {
  [ordered]@{
    path = (Relative-Path $StageRoot $_.FullName).Replace('\', '/')
    bytes = $_.Length
    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  }
})
$manifest = [ordered]@{
  schemaVersion = 1
  appVersion = $AppVersion
  electronVersion = $ElectronVersion
  nodeVersion = $NodeVersion
  sourceCommit = $commit
  createdAt = [DateTime]::UtcNow.ToString('o')
  files = $files
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $StageRoot 'build-manifest.json') -Encoding UTF8
Write-Host "Validated clean staging directory: $StageRoot ($($files.Count) files before manifest)"

if ($StageOnly) {
  Write-Host 'StageOnly requested; installer compilation skipped.'
  exit 0
}

Ensure-Directory $OutputDir
$iscc = Resolve-Iscc
& $iscc "/DStageDir=$StageRoot" "/DBuildOutputDir=$OutputDir" "/DAppVersion=$AppVersion" $SetupPath
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }
$installer = Join-Path $OutputDir $InstallerName
if (-not (Test-Path -LiteralPath $installer)) { throw "ISCC completed but installer was not found: $installer" }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
Write-Host "Installer: $installer"
Write-Host "SHA-256: $hash"
