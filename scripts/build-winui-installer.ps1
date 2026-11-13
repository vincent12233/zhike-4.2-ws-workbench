[CmdletBinding()]
param(
  # Leave empty to use the stage directory that matches -AppVersion. This
  # prevents an AppVersion override from silently packaging the previous
  # version's binaries.
  [string]$StageDir = '',
  [string]$OutputDir = '',
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$AppVersion = '6.0.0',
  [switch]$SkipWebView2Check,
  [switch]$AllowUnsigned,
  # A publishable installer must come from a bundle built with -ReleaseGate.
  # Omit this only for local development/install smoke tests.
  [switch]$ReleaseGate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$OutputDir = if ([string]::IsNullOrWhiteSpace($OutputDir)) { Join-Path $repo 'work\winui-installer-output' } else { $OutputDir }
$stageInput = if ([string]::IsNullOrWhiteSpace($StageDir)) {
  Join-Path $PSScriptRoot "..\work\winui-bundle\zhike-winui-$AppVersion-win-x64"
} else {
  $StageDir
}
$stage = [IO.Path]::GetFullPath($stageInput)
$out = [IO.Path]::GetFullPath($OutputDir)
function Get-WebView2RuntimeVersion {
  $keys = @('HKCU:\Software\Microsoft\EdgeUpdate\Clients','HKLM:\Software\Microsoft\EdgeUpdate\Clients','HKLM:\Software\WOW6432Node\Microsoft\EdgeUpdate\Clients')
  foreach ($root in $keys) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($child in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
      try { $item = Get-ItemProperty -LiteralPath $child.PSPath -ErrorAction Stop; if ([string]$item.name -match 'WebView2' -and -not [string]::IsNullOrWhiteSpace([string]$item.pv)) { return [string]$item.pv } } catch { }
    }
  }
  return ''
}
$webView2Version = Get-WebView2RuntimeVersion
if ([string]::IsNullOrWhiteSpace($webView2Version)) {
  if ($SkipWebView2Check) { Write-Warning '未检测到 WebView2 Runtime，已按参数跳过检查。' }
  else { Write-Warning '未检测到 WebView2 Runtime；安装包会保留运行时提示，目标机首次启动前需补装。' }
}
$signingRequired = $env:ZHike_REQUIRE_SIGNING -eq 'true'
$certificate = [string]$env:ZHike_SIGN_CERTIFICATE
if ($signingRequired -and -not $AllowUnsigned -and [string]::IsNullOrWhiteSpace($certificate)) { throw 'ZHike_REQUIRE_SIGNING=true 但未提供签名证书；请配置 ZHike_SIGN_CERTIFICATE 或传入 -AllowUnsigned。' }
function Get-SignToolPath {
  if (-not [string]::IsNullOrWhiteSpace([string]$env:ZHike_SIGNTOOL) -and (Test-Path -LiteralPath $env:ZHike_SIGNTOOL)) { return [IO.Path]::GetFullPath($env:ZHike_SIGNTOOL) }
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (Test-Path -LiteralPath $kits) {
    $found = Get-ChildItem -LiteralPath $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
      Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return ''
}
function Invoke-CodeSign([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($certificate)) { return }
  if (-not (Test-Path -LiteralPath $certificate -PathType Leaf)) { throw "signing certificate not found: $certificate" }
  $signTool = Get-SignToolPath
  if ([string]::IsNullOrWhiteSpace($signTool)) { throw 'signtool.exe was not found; install the Windows SDK or configure ZHike_SIGNTOOL.' }
  $arguments = @('sign', '/fd', 'SHA256', '/f', $certificate)
  if (-not [string]::IsNullOrWhiteSpace([string]$env:ZHike_SIGN_PASSWORD)) { $arguments += @('/p', [string]$env:ZHike_SIGN_PASSWORD) }
  $timestamp = if ([string]::IsNullOrWhiteSpace([string]$env:ZHike_TIMESTAMP_URL)) { 'http://timestamp.digicert.com' } else { [string]$env:ZHike_TIMESTAMP_URL }
  $arguments += @('/tr', $timestamp, '/td', 'SHA256', $Path)
  & $signTool @arguments
  if ($LASTEXITCODE -ne 0) { throw "code signing failed: $Path" }
  & $signTool verify /pa /all $Path
  if ($LASTEXITCODE -ne 0) { throw "signature verification failed: $Path" }
}
if (-not (Test-Path -LiteralPath (Join-Path $stage 'Zhike.Desktop.exe'))) { throw "WinUI stage is missing Zhike.Desktop.exe: $stage" }
$requiredStageFiles = @(
  'resources\app\index.html',
  'resources\app\app.js',
  'resources\app\styles.css',
  'resources\app\server.mjs',
  'resources\app\modules\horizon-atelier.css',
  'resources\app\assets\zhike-horizon-logo.png',
  'resources\app\vendor\xlsx\xlsx.js',
  'zhike.ico',
  'bundle-manifest.json'
)
foreach ($relative in $requiredStageFiles) {
  $requiredPath = Join-Path $stage $relative
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "WinUI stage is missing required file: $requiredPath" }
}
$manifestPath = Join-Path $stage 'bundle-manifest.json'
try {
  $bundleManifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  throw "invalid WinUI bundle manifest: $manifestPath ($($_.Exception.Message))"
}
$manifestVersion = if ($bundleManifest.PSObject.Properties.Name -contains 'version') { [string]$bundleManifest.version } else { '' }
if ([string]::IsNullOrWhiteSpace($manifestVersion)) { throw "WinUI bundle manifest missing version: $manifestPath" }
if ($manifestVersion -ne $AppVersion) { throw "staged bundle version mismatch: manifest=$manifestVersion expected=$AppVersion" }
$manifestGate = if ($bundleManifest.PSObject.Properties.Name -contains 'releaseGate') { [string]$bundleManifest.releaseGate } else { '' }
if ($ReleaseGate -and $manifestGate -ne 'passed') { throw "release gate rejected this stage: manifest releaseGate=$manifestGate; rebuild the bundle with -ReleaseGate." }
if ($ReleaseGate -and [bool]$bundleManifest.sourceWorktreeDirty) { throw 'release gate rejected a stage built from a dirty worktree.' }
$stagedIndex = [IO.File]::ReadAllText((Join-Path $stage 'resources\app\index.html'))
if (-not $stagedIndex.Contains(" &middot; v$AppVersion<!-- ZHIKE_BUILD_VERSION --></span>")) {
  throw "staged sidebar version mismatch: expected v$AppVersion in resources/app/index.html; rebuild the WinUI bundle."
}
if (-not $stagedIndex.Contains('<title>知客 6.0 · Horizon Atelier</title>')) { throw 'staged UI title is not Horizon Atelier 6.0; refusing an old UI stage.' }
$stagedScrollIndex = $stagedIndex.IndexOf('scroll-system.css', [StringComparison]::Ordinal)
$stagedHorizonIndex = $stagedIndex.IndexOf('horizon-atelier.css', [StringComparison]::Ordinal)
if ($stagedHorizonIndex -lt 0 -or $stagedScrollIndex -le $stagedHorizonIndex) { throw 'staged scroll interaction layer is missing or ordered before Horizon Atelier.' }
$stagedServer = [IO.File]::ReadAllText((Join-Path $stage 'resources\app\server.mjs'))
if ($stagedServer -notmatch "const APP_VERSION = '$([regex]::Escape($AppVersion))'") { throw "staged server version mismatch: expected $AppVersion" }
if (-not $stagedServer.Contains("'/modules/horizon-atelier.css'")) { throw 'staged local service does not allow the Horizon Atelier resource.' }

function Assert-ManifestFileHash([string]$RelativePath) {
  $normalized = $RelativePath.Replace('\','/')
  $entry = $bundleManifest.files | Where-Object { [string]$_.path -eq $normalized } | Select-Object -First 1
  if (-not $entry) { throw "bundle manifest is missing $normalized" }
  $filePath = Join-Path $stage $RelativePath
  $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
  if ($actualHash -ne [string]$entry.sha256) { throw "bundle file hash mismatch: $normalized" }
}
foreach ($relative in @('Zhike.Desktop.exe','resources\app\index.html','resources\app\server.mjs','resources\app\modules\horizon-atelier.css')) {
  Assert-ManifestFileHash $relative
}
$executableVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $stage 'Zhike.Desktop.exe')).FileVersion
if ($executableVersion -ne "$AppVersion.0") { throw "staged executable version mismatch: executable=$executableVersion expected=$AppVersion.0" }
Invoke-CodeSign (Join-Path $stage 'Zhike.Desktop.exe')
$manifestRuntime = if ($bundleManifest.PSObject.Properties.Name -contains 'runtime') { [string]$bundleManifest.runtime } else { '' }
if (-not [string]::IsNullOrWhiteSpace($manifestRuntime) -and $manifestRuntime -ne 'win-x64') {
  throw "staged bundle runtime mismatch: manifest=$manifestRuntime expected=win-x64"
}
$blockedStageNames = @('main.cjs', 'preload.cjs', 'ws-preload.cjs', 'ai-credentials.json', 'workspace.sqlite', 'package.json')
$blockedStageFiles = Get-ChildItem -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -in $blockedStageNames -or $_.Name -match '(?i)credentials|\.sqlite$|\.db$|\.log$' }
if ($blockedStageFiles) { throw "WinUI stage contains blocked runtime or user-data files: $($blockedStageFiles[0].FullName)" }
$candidates = @(
  $env:INNO_SETUP_COMPILER,
  $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe' }),
  $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe' }),
  $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 7\ISCC.exe' })
) | Where-Object { $_ }
$iscc = $null
foreach ($candidate in $candidates) {
  $full = [IO.Path]::GetFullPath($candidate)
  if (Test-Path -LiteralPath $full) { $iscc = $full; break }
}
if (-not $iscc) { throw 'Inno Setup compiler was not found.' }
New-Item -ItemType Directory -Force -Path $out | Out-Null
# Keep the validation path ASCII-only. Windows PowerShell 5.1 may decode this
# UTF-8 script without a BOM as the active system code page, while Inno Setup
# still writes the correctly localized Chinese filename. Match by version and
# product suffix instead of embedding the localized name in the script.
$expectedPattern = "*-$AppVersion-WinUI*.exe"
if ($ReleaseGate) {
  # A formal publish directory is a single-version hand-off.  Remove only
  # installer artifacts that match Zhike's versioned WinUI filename shape;
  # never recurse and never touch unrelated files supplied by the user.
  Get-ChildItem -LiteralPath $out -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '-\d+\.\d+\.\d+-WinUI[^\\/]*\.exe$' -and $_.Name -notlike $expectedPattern } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
  $previousOutputManifest = Join-Path $out 'release-output-manifest.json'
  if (Test-Path -LiteralPath $previousOutputManifest -PathType Leaf) { Remove-Item -LiteralPath $previousOutputManifest -Force }
}
Get-ChildItem -LiteralPath $out -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like $expectedPattern } |
  Remove-Item -Force
# ISCC parses /D values itself. Invoke it through cmd.exe so quotes around
# paths containing spaces survive PowerShell's native argument marshalling;
# passing the same strings directly to ISCC is interpreted as multiple script
# filenames on Windows and can silently package stale files.
$iss = [IO.Path]::GetFullPath((Join-Path $repo 'zhike-desktop-setup.iss'))
foreach ($value in @($iscc, $stage, $out, $iss, (Join-Path $stage 'zhike.ico'))) {
  if ($value.Contains('"')) { throw "Installer path contains an unsupported quote: $value" }
}
$commandLine = '"' + $iscc + '" /DStageDir="' + $stage + '" /DBuildOutputDir="' + $out + '" /DAppVersion=' + $AppVersion + ' /DIconFile="' + (Join-Path $stage 'zhike.ico') + '" "' + $iss + '"'
& $env:ComSpec /d /s /c $commandLine
$isccExitCode = $LASTEXITCODE
if ($isccExitCode -ne 0) { throw "ISCC failed with exit code $isccExitCode" }
$installer = ''
# Inno can return immediately after the final write while the antivirus/file
# system still publishes the Unicode-named output. Retry the existence check
# briefly so a successful compile is not reported as a packaging failure.
for ($attempt = 0; $attempt -lt 20 -and [string]::IsNullOrWhiteSpace($installer); $attempt++) {
  $published = Get-ChildItem -LiteralPath $out -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like $expectedPattern } | Select-Object -First 1
  if ($published) { $installer = $published.FullName; break }
  Start-Sleep -Milliseconds 250
}
if ([string]::IsNullOrWhiteSpace($installer) -or -not (Test-Path -LiteralPath $installer)) {
  # Fall back to directory enumeration for Unicode/long-path providers that
  # can transiently fail a literal existence probe immediately after ISCC
  # closes the output handle.
  $published = Get-ChildItem -LiteralPath $out -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like $expectedPattern } | Select-Object -First 1
  if ($published) { $installer = $published.FullName }
}
$installerItem = Get-Item -LiteralPath $installer -ErrorAction SilentlyContinue
if (-not $installerItem) {
  $installerItem = Get-ChildItem -LiteralPath $out -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like $expectedPattern } | Select-Object -First 1
}
if (-not $installerItem) { throw "installer not found in output directory: $out" }
$installer = $installerItem.FullName
Invoke-CodeSign $installer
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
if ($ReleaseGate) {
  $formalInstallers = @(Get-ChildItem -LiteralPath $out -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '-\d+\.\d+\.\d+-WinUI[^\\/]*\.exe$' })
  if ($formalInstallers.Count -ne 1 -or $formalInstallers[0].FullName -ne $installer) {
    throw "formal release output must contain exactly one versioned installer: $out"
  }
  [ordered]@{
    product = 'Zhike Desktop'
    version = $AppVersion
    installer = $installerItem.Name
    sha256 = $installerHash
    bytes = $installerItem.Length
    releaseGate = 'passed'
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $out 'release-output-manifest.json') -Encoding UTF8
}
Write-Output (ConvertTo-Json @{
  installer = $installer
  sha256 = $installerHash
  bytes = $installerItem.Length
  webView2Version = if ($webView2Version) { $webView2Version } else { 'not-detected' }
  signingStatus = if ($certificate) { 'signed-and-verified' } else { 'unsigned' }
  recovery = '6.0 仅使用 %LOCALAPPDATA%\Zhike6；不读取、迁移或删除旧 %LOCALAPPDATA%\Zhike。程序恢复使用 6.0 安装包和 6.0 本机备份，不重新启用旧客户端。'
})
