#requires -Version 7.2
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$InstallerPath,
  [Parameter(Mandatory)][string]$StageDir,
  [Parameter(Mandatory)][string]$OutputDir
)

# Payload-only smoke for a disposable GitHub-hosted Windows runner. Never
# launch the application or create, read, redirect or delete its real data root.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$work = [IO.Path]::GetFullPath((Join-Path $repo 'work'))
$nativeKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{8A2E0A65-B5C8-4F74-9DD9-7AC4CE0A50B3}_is1'
$legacyId = '{C3EDBD10-E7B9-4C06-A297-6184F7DDE410}_is1'

function Assert-NoLinks([string]$Path) {
  $cursor = [IO.Path]::GetFullPath($Path)
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Reparse points are not permitted: $cursor"
      }
    }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
}
function Get-WorkPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $repo $Path }))
  if (-not $full.StartsWith($work + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      $full -match '["\r\n]' -or $full.StartsWith('\\')) { throw "Path must be strictly below repository work/: $Path" }
  Assert-NoLinks $full
  return $full.TrimEnd([IO.Path]::DirectorySeparatorChar)
}
function Get-Registrations {
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
      $root = $null
      try {
        $root = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
        if ($null -eq $root) { continue }
        foreach ($name in $root.GetSubKeyNames()) {
          $key = $root.OpenSubKey($name)
          try {
            $displayName = [string]$key.GetValue('DisplayName', '')
            if ($name -eq ($nativeKey.Split('\')[-1]) -or $name -eq $legacyId -or $displayName -match 'Zhike|知客') {
              [pscustomobject]@{ hive = "$hive"; view = "$view"; key = $name; displayName = $displayName }
            }
          } finally { if ($key) { $key.Dispose() } }
        }
      } finally { if ($root) { $root.Dispose() }; $base.Dispose() }
    }
  }
}
function Get-NativeRegistration {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
  $key = $null
  try {
    $key = $base.OpenSubKey($nativeKey)
    if ($null -eq $key) { return $null }
    return [pscustomobject]@{
      path = [string]$key.GetValue('Inno Setup: App Path', '')
      version = [string]$key.GetValue('DisplayVersion', '')
      uninstall = [string]$key.GetValue('UninstallString', '')
    }
  } finally { if ($key) { $key.Dispose() }; $base.Dispose() }
}
function Get-WebViewRuntime {
  # Match InitializeSetup in zhike-desktop-setup.iss: HKCU and HKLM32.
  foreach ($candidate in @(
    @{ hive = [Microsoft.Win32.RegistryHive]::CurrentUser; view = [Microsoft.Win32.RegistryView]::Registry64; root = $env:LOCALAPPDATA },
    @{ hive = [Microsoft.Win32.RegistryHive]::LocalMachine; view = [Microsoft.Win32.RegistryView]::Registry32; root = ${env:ProgramFiles(x86)} }
  )) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($candidate.hive, $candidate.view)
    $key = $null
    try {
      $key = $base.OpenSubKey('Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
      if ($null -eq $key) { continue }
      $versionText = [string]$key.GetValue('pv', '')
      if ($versionText -notmatch '^\d+\.\d+\.\d+\.\d+$' -or [version]$versionText -le [version]'0.0.0.0') { continue }
      $runtimeExe = Join-Path $candidate.root "Microsoft\EdgeWebView\Application\$versionText\msedgewebview2.exe"
      if (Test-Path -LiteralPath $runtimeExe -PathType Leaf) {
        return [pscustomobject]@{ version = $versionText; executable = $runtimeExe; hive = "$($candidate.hive)"; view = "$($candidate.view)" }
      }
    } finally { if ($key) { $key.Dispose() }; $base.Dispose() }
  }
  throw 'WebView2 Evergreen Runtime is missing. Install the official Microsoft runtime before this smoke; registry substitutes are not supported.'
}
function Assert-NoApplicationProcess {
  if (@(Get-Process -Name 'Zhike*' -ErrorAction SilentlyContinue).Count) { throw 'A Zhike application process exists; payload smoke must not run the app.' }
}
function Invoke-SilentInstaller([string]$Executable, [string]$LogPath, [switch]$Uninstall) {
  Assert-NoApplicationProcess
  $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$LogPath`"")
  if (-not $Uninstall) {
    $arguments += @('/SP-', '/CURRENTUSER', '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', "/DIR=`"$install`"")
  }
  # Start-Process -Wait waits for the complete Inno process tree, including
  # the temporary uninstall worker. Silent mode skips [Run] skipifsilent.
  $process = Start-Process -FilePath $Executable -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Inno returned exit code $($process.ExitCode); see $LogPath" }
  if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { throw "Inno did not produce its requested log: $LogPath" }
  Assert-NoApplicationProcess
  return $process.ExitCode
}
function Get-OwnedUninstaller {
  $registration = Get-NativeRegistration
  if ($null -eq $registration -or [IO.Path]::GetFullPath($registration.path).TrimEnd('\') -ne $install -or
      $registration.version -ne [string]$manifest.version) { throw 'HKCU64 installation registration does not match the isolated path and bundle version.' }
  if ($registration.uninstall -notmatch '^"([^"]+\\unins\d{3}\.exe)"$') { throw 'Unexpected Inno UninstallString; refusing to execute it.' }
  $uninstaller = [IO.Path]::GetFullPath($Matches[1])
  if ([IO.Path]::GetDirectoryName($uninstaller) -ne $install -or -not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
    throw 'Registered uninstaller is not in the smoke-owned installation.'
  }
  Assert-NoLinks $uninstaller
  return $uninstaller
}
function Assert-Payload([string]$Root, [switch]$Installed) {
  Assert-NoLinks $Root
  $items = @(Get-ChildItem -LiteralPath $Root -Recurse -Force)
  if (@($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw "Payload contains a reparse point: $Root" }
  foreach ($entry in $manifest.files) {
    $file = Get-Item -LiteralPath (Join-Path $Root $entry.path) -Force
    if ($file.PSIsContainer -or $file.Length -ne [long]$entry.bytes -or
        (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne [string]$entry.sha256) {
      throw "Payload size/SHA256 mismatch: $($entry.path) in $Root"
    }
  }
  $installedManifestHash = (Get-FileHash -LiteralPath (Join-Path $Root 'bundle-manifest.json') -Algorithm SHA256).Hash
  if ($installedManifestHash -ne $manifestHash) { throw "Installed bundle manifest differs from the source: $Root" }
  $files = @($items | Where-Object { -not $_.PSIsContainer })
  foreach ($file in $files) {
    $relative = [IO.Path]::GetRelativePath($Root, $file.FullName).Replace('\', '/')
    if ($paths.ContainsKey($relative) -or $relative -eq 'bundle-manifest.json') { continue }
    if ($Installed -and $relative -match '^unins\d{3}\.(exe|dat|msg)$') { continue }
    if ($Installed -and $relative -eq $shortcutIcon) {
      if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $paths['zhike.ico'].sha256) { throw 'Installer shortcut icon differs from the staged icon.' }
      continue
    }
    throw "Unexpected payload file: $relative in $Root"
  }
  return [pscustomobject]@{ manifestFilesVerified = $paths.Count; actualFiles = $files.Count; manifestSha256 = $manifestHash }
}
function Assert-Sentinel {
  if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf) -or
      (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $sentinelHash) { throw 'External synthetic data sentinel was changed or removed.' }
}

if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Run this smoke only on a disposable GitHub-hosted Windows runner.'
}
$installer = Get-WorkPath $InstallerPath
$stage = Get-WorkPath $StageDir
$out = Get-WorkPath $OutputDir
if ($out -eq $stage -or $out.StartsWith($stage + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $stage.StartsWith($out + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'StageDir and OutputDir must not overlap.' }
New-Item -ItemType Directory -Path $out -Force | Out-Null
$runRoot = Join-Path $out ('run-' + [Guid]::NewGuid().ToString('N'))
$install = Join-Path $runRoot 'installed'
$sentinel = Join-Path $runRoot 'external-synthetic-data\sentinel.json'
$resultPath = Join-Path $out 'installer-smoke-result.json'
$result = [ordered]@{
  status = 'failed'; startedAtUtc = [DateTime]::UtcNow.ToString('o'); completedAtUtc = $null
  scope = 'install-overwrite-uninstall-payload-only'; applicationLaunched = $false
  realUserDataAccessed = $false; installer = $installer; stage = $stage; installDirectory = $install
  externalSyntheticData = $sentinel; checks = [ordered]@{}; error = $null; cleanup = $null
}
$installationAttempted = $false
$uninstalled = $false
$failure = $null
try {
  if (@(Get-Registrations).Count) { throw 'An existing Zhike installation is registered in HKCU/HKLM; refusing to run.' }
  foreach ($root in @($env:LOCALAPPDATA, $env:APPDATA)) {
    foreach ($name in @('Zhike', 'Zhike6', 'zhike-workbench', 'zhike-desktop')) {
      if (Test-Path -LiteralPath (Join-Path $root $name)) { throw 'A real or historical Zhike data directory exists; refusing to run.' }
    }
  }
  foreach ($name in @('Programs\ZhikeNative', 'Programs\Zhike', 'Programs\ZhikeWorkbench')) {
    if (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA $name)) { throw 'An existing Zhike application directory exists; refusing to run.' }
  }
  Assert-NoApplicationProcess
  $result.checks.webView2 = Get-WebViewRuntime
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf) -or [IO.Path]::GetExtension($installer) -ne '.exe') { throw 'InstallerPath must identify an existing .exe.' }
  $result.installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
  $manifestPath = Join-Path $stage 'bundle-manifest.json'
  $manifestHash = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $manifest.version -or @($manifest.files).Count -eq 0) { throw 'Bundle manifest needs a version and nonempty file list.' }
  $paths = @{}
  foreach ($entry in $manifest.files) {
    $relative = ([string]$entry.path).Replace('\', '/')
    if (-not $relative -or [IO.Path]::IsPathRooted($relative) -or $relative -match '[<>:"|?*\x00-\x1f]' -or
        @($relative.Split('/') | Where-Object { $_ -in @('', '.', '..') -or $_ -match '[. ]$' }).Count -or
        $relative -eq 'bundle-manifest.json' -or $paths.ContainsKey($relative) -or
        [string]$entry.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or [long]$entry.bytes -lt 0) { throw "Invalid or duplicate manifest entry: $relative" }
    $paths[$relative] = $entry
  }
  if (-not $paths.ContainsKey('Zhike.Desktop.exe') -or -not $paths.ContainsKey('zhike.ico')) { throw 'Manifest does not contain the application and icon.' }
  $setupSource = Get-Content -LiteralPath (Join-Path $repo 'zhike-desktop-setup.iss') -Raw -Encoding UTF8
  if ($setupSource -notmatch '(?m)^UninstallDisplayIcon=\{app\}\\([a-zA-Z0-9._-]+\.ico)\s*$') { throw 'Cannot determine the Inno-generated shortcut icon.' }
  $shortcutIcon = $Matches[1]
  $result.version = [string]$manifest.version
  $result.sourceCommit = [string]$manifest.sourceCommit
  $result.checks.stage = Assert-Payload $stage

  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($sentinel)) | Out-Null
  [ordered]@{ synthetic = $true; purpose = 'installer external-data retention'; nonce = [Guid]::NewGuid().ToString('N') } |
    ConvertTo-Json | Set-Content -LiteralPath $sentinel -Encoding UTF8
  $sentinelHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash
  $installationAttempted = $true
  $result.checks.firstInstallExitCode = Invoke-SilentInstaller $installer (Join-Path $runRoot 'install-first.log')
  $null = Get-OwnedUninstaller
  $result.checks.firstInstall = Assert-Payload $install -Installed
  Assert-Sentinel

  # An obsolete application module must be removed by the verified upgrade
  # cleanup. The external synthetic data file must survive unchanged.
  $obsolete = Join-Path $install 'resources\app\installer-smoke-obsolete.tmp'
  Set-Content -LiteralPath $obsolete -Value 'Synthetic obsolete application payload.' -Encoding UTF8
  $result.checks.overwriteExitCode = Invoke-SilentInstaller $installer (Join-Path $runRoot 'install-overwrite.log')
  $uninstaller = Get-OwnedUninstaller
  if (Test-Path -LiteralPath $obsolete) { throw 'Overwrite installation retained obsolete application payload.' }
  $result.checks.overwrite = Assert-Payload $install -Installed
  Assert-Sentinel
  $result.checks.overwriteExternalDataPreserved = $true
  $result.checks.uninstallExitCode = Invoke-SilentInstaller $uninstaller (Join-Path $runRoot 'uninstall.log') -Uninstall
  $uninstalled = $true
  if (@(Get-Registrations).Count) { throw 'Uninstall left a Zhike registry entry.' }
  if ((Test-Path -LiteralPath $install) -and @(Get-ChildItem -LiteralPath $install -Recurse -Force -File).Count) { throw 'Uninstall left application payload files.' }
  Assert-Sentinel
  $result.checks.uninstallExternalDataPreserved = $true
  $result.checks.externalSyntheticDataSha256 = $sentinelHash
  Assert-NoApplicationProcess
  $result.status = 'passed'
} catch {
  $failure = $_
  $result.error = $_.Exception.Message
} finally {
  if ($installationAttempted -and -not $uninstalled) {
    try {
      $ownedUninstaller = Get-OwnedUninstaller
      $null = Invoke-SilentInstaller $ownedUninstaller (Join-Path $runRoot 'cleanup-uninstall.log') -Uninstall
      $result.cleanup = 'Owned installation uninstalled after smoke failure.'
    } catch { $result.cleanup = 'Cleanup did not run or failed: ' + $_.Exception.Message }
  }
  $result.completedAtUtc = [DateTime]::UtcNow.ToString('o')
  $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding UTF8
}
Write-Output $resultPath
if ($failure) { throw $failure }
