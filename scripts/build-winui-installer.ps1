[CmdletBinding()]
param(
  # Leave empty to use the stage directory that matches -AppVersion. This
  # prevents an AppVersion override from silently packaging the previous
  # version's binaries.
  [string]$StageDir = '',
  [string]$OutputDir = (Join-Path $PSScriptRoot '..\work\winui-installer-output'),
  [string]$AppVersion = '5.0.0'
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
& $iscc "/DStageDir=$stage" "/DBuildOutputDir=$out" "/DAppVersion=$AppVersion" (Join-Path $repo 'zhike-desktop-setup.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }
$installer = Get-ChildItem -LiteralPath $out -Filter '*.exe' -File |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1 -ExpandProperty FullName
if ([string]::IsNullOrWhiteSpace($installer) -or -not (Test-Path -LiteralPath $installer)) { throw "installer not found in output directory: $out" }
Write-Output (ConvertTo-Json @{ installer = $installer; sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash; bytes = (Get-Item -LiteralPath $installer).Length })
