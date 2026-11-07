[CmdletBinding()]
param(
  [ValidateSet('backup','restore')][string]$Action = 'backup',
  [string]$BackupRoot = (Join-Path $PSScriptRoot 'snapshots'),
  [string]$Source,
  [string]$TargetDatabase,
  [int]$Retention = 14,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$resolvedRoot = [IO.Path]::GetFullPath($BackupRoot)
New-Item -ItemType Directory -Force -Path $resolvedRoot | Out-Null

if ($Action -eq 'backup') {
  $stamp = "{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), ([guid]::NewGuid().ToString('N').Substring(0,8))
  $dump = Join-Path $resolvedRoot ("zhike-{0}.dump" -f $stamp)
  if ($DryRun) {
    Write-Output (ConvertTo-Json @{ action = 'backup'; output = $dump; dryRun = $true })
    exit 0
  }
  if ([string]::IsNullOrWhiteSpace($env:ConnectionStrings__Postgres)) { throw 'ConnectionStrings__Postgres is required' }
  $temporaryDump = "$dump.$PID.tmp"
  & pg_dump --format=custom --file $temporaryDump $env:ConnectionStrings__Postgres
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
  Move-Item -LiteralPath $temporaryDump -Destination $dump -Force
  $manifest = @{ dump = $dump; createdAt = (Get-Date).ToUniversalTime().ToString('o'); retention = $Retention }
  $manifestTemp = "$dump.json.$PID.tmp"
  $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestTemp -Encoding UTF8
  Move-Item -LiteralPath $manifestTemp -Destination "$dump.json" -Force
  Get-ChildItem -LiteralPath $resolvedRoot -Filter 'zhike-*.dump' -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -Skip ([Math]::Max(1, $Retention)) |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force
      $sidecar = "$($_.FullName).json"
      if (Test-Path -LiteralPath $sidecar) { Remove-Item -LiteralPath $sidecar -Force }
    }
  Write-Output (ConvertTo-Json @{ action = 'backup'; output = $dump; dryRun = $false })
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Source) -or [string]::IsNullOrWhiteSpace($TargetDatabase)) { throw 'restore requires -Source and -TargetDatabase' }
$resolvedSource = [IO.Path]::GetFullPath($Source)
if (-not (Test-Path -LiteralPath $resolvedSource -PathType Leaf)) { throw "backup file not found: $resolvedSource" }
if ($DryRun) {
  Write-Output (ConvertTo-Json @{ action = 'restore'; source = $resolvedSource; target = $TargetDatabase; dryRun = $true; deleteUnrelated = $false })
  exit 0
}
& pg_restore --exit-on-error --dbname $TargetDatabase $resolvedSource
if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE" }
Write-Output (ConvertTo-Json @{ action = 'restore'; source = $resolvedSource; target = $TargetDatabase; dryRun = $false; deleteUnrelated = $false })
