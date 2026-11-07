[CmdletBinding()]
param(
  [string]$OutputDir = (Join-Path $PSScriptRoot '..\work\winui-bundle'),
  [string]$Version = '5.0.0',
  [ValidateSet('Debug','Release')]
  [string]$Configuration = 'Release',
  [string]$RuntimeIdentifier = 'win-x64',
  [switch]$SelfContained
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$out = [IO.Path]::GetFullPath($OutputDir)
$stage = Join-Path $out "zhike-winui-$Version-$RuntimeIdentifier"
$archive = Join-Path $out "zhike-winui-$Version-$RuntimeIdentifier.zip"
$project = Join-Path $repo 'desktop\src\Zhike.Desktop\Zhike.Desktop.csproj'
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
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

& $dotnet restore $project -r $RuntimeIdentifier -p:RestoreLockedMode=false -v:minimal
if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed with exit code $LASTEXITCODE" }
$publishArgs = @('publish', $project, '-c', $Configuration, '-r', $RuntimeIdentifier, '--no-restore', '-o', $stage, '-v:minimal')
if ($SelfContained) { $publishArgs += '--self-contained'; $publishArgs += 'true' } else { $publishArgs += '--self-contained'; $publishArgs += 'false' }
& $dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

$exe = Join-Path $stage 'Zhike.Desktop.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "publish output missing Zhike.Desktop.exe: $exe" }
Copy-Item -LiteralPath (Join-Path $repo 'desktop\src\Zhike.Desktop\README.md') -Destination (Join-Path $stage 'README-desktop.md') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\server-version-deployment.md') -Destination (Join-Path $stage 'server-version-deployment.md') -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\server-version-troubleshooting.md') -Destination (Join-Path $stage 'server-version-troubleshooting.md') -Force

$manifest = @(
  Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object {
    [ordered]@{
      path = $_.FullName.Substring($stage.Length + 1).Replace('\','/')
      bytes = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  }
)
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'bundle-manifest.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
Write-Output (ConvertTo-Json @{ version = $Version; runtime = $RuntimeIdentifier; selfContained = [bool]$SelfContained; archive = $archive; sha256 = $hash; stage = $stage })
