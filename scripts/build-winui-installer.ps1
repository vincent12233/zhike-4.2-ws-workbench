[CmdletBinding()]
param(
  # Leave empty to use the stage directory that matches -AppVersion. This
  # prevents an AppVersion override from silently packaging the previous
  # version's binaries.
  [string]$StageDir = '',
  [string]$OutputDir = '',
  [string]$AppVersion = '5.1.0'
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
if (-not (Test-Path -LiteralPath (Join-Path $stage 'Zhike.Desktop.exe'))) { throw "WinUI stage is missing Zhike.Desktop.exe: $stage" }
$requiredStageFiles = @(
  'resources\app\index.html',
  'resources\app\app.js',
  'resources\app\styles.css',
  'resources\app\vendor\xlsx\xlsx.js',
  'bundle-manifest.json'
)
foreach ($relative in $requiredStageFiles) {
  $requiredPath = Join-Path $stage $relative
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "WinUI stage is missing required file: $requiredPath" }
}
$blockedStageNames = @('node.exe', 'main.cjs', 'preload.cjs', 'ws-preload.cjs', 'server.mjs', 'migrate-data.cjs', 'ai-credentials.json', 'workspace.sqlite', 'package.json', 'migrations')
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
Get-ChildItem -LiteralPath $out -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like $expectedPattern } |
  Remove-Item -Force
# ISCC parses /D values itself. Invoke it through cmd.exe so quotes around
# paths containing spaces survive PowerShell's native argument marshalling;
# passing the same strings directly to ISCC is interpreted as multiple script
# filenames on Windows and can silently package stale files.
$iss = [IO.Path]::GetFullPath((Join-Path $repo 'zhike-desktop-setup.iss'))
foreach ($value in @($iscc, $stage, $out, $iss)) {
  if ($value.Contains('"')) { throw "Installer path contains an unsupported quote: $value" }
}
$commandLine = '"' + $iscc + '" /DStageDir="' + $stage + '" /DBuildOutputDir="' + $out + '" /DAppVersion=' + $AppVersion + ' "' + $iss + '"'
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
Write-Output (ConvertTo-Json @{ installer = $installer; sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash; bytes = $installerItem.Length })
