[CmdletBinding()]
param(
  # Leave empty to use the stage directory that matches -AppVersion. This
  # prevents an AppVersion override from silently packaging the previous
  # version's binaries.
  [string]$StageDir = '',
  [string]$OutputDir = (Join-Path $PSScriptRoot '..\work\winui-installer-output'),
  [string]$AppVersion = '5.1.0'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
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
$expectedName = "知客-$AppVersion-WinUI桌面版.exe"
$expectedPath = Join-Path $out $expectedName
if (Test-Path -LiteralPath $expectedPath) { Remove-Item -LiteralPath $expectedPath -Force }
# ISCC parses /D values itself. Explicitly quote paths so a repository or
# output directory containing spaces is passed as one macro value; without
# this, the compiler can silently truncate StageDir and package stale files.
$stageDefine = '/DStageDir="' + $stage + '"'
$outputDefine = '/DBuildOutputDir="' + $out + '"'
& $iscc $stageDefine $outputDefine "/DAppVersion=$AppVersion" (Join-Path $repo 'zhike-desktop-setup.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }
$installer = $expectedPath
if ([string]::IsNullOrWhiteSpace($installer) -or -not (Test-Path -LiteralPath $installer)) { throw "installer not found in output directory: $out" }
Write-Output (ConvertTo-Json @{ installer = $installer; sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash; bytes = (Get-Item -LiteralPath $installer).Length })
