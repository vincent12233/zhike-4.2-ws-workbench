[CmdletBinding()]
param(
  [ValidateSet('backup','restore')][string]$Action = 'backup',
  [string]$BackupRoot,
  [string]$Source,
  [string]$TargetDatabase,
  [int]$Retention = 14,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
  $backupBase = if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) { (Get-Location).Path } else { $PSScriptRoot }
  $BackupRoot = Join-Path $backupBase 'snapshots'
}
$resolvedRoot = [IO.Path]::GetFullPath($BackupRoot)
New-Item -ItemType Directory -Force -Path $resolvedRoot | Out-Null

function Get-PostgresEnvironmentNames() {
  return @(
    'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE',
    'PGAPPNAME', 'PGCONNECT_TIMEOUT', 'PGOPTIONS', 'PGTARGETSESSIONATTRS',
    'PGSERVICE', 'PGPASSFILE', 'PGHOSTADDR', 'PGSSLROOTCERT', 'PGSSLCERT',
    'PGSSLKEY', 'PGSSLCRL', 'PGSSLCRLDIR', 'PGSSLNEGOTIATION', 'PGSSLSNI',
    'PGSSLCOMPRESSION', 'PGSSLMINPROTOCOLVERSION', 'PGSSLMAXPROTOCOLVERSION',
    'PGREQUIRESSL'
  )
}

function Decode-UriComponent([string]$Value) {
  if ($null -eq $Value) { return $null }
  return [Uri]::UnescapeDataString($Value)
}

function Decode-UriQueryComponent([string]$Value) {
  if ($null -eq $Value) { return $null }
  return Decode-UriComponent ($Value.Replace('+', ' '))
}

function Parse-PostgresConnectionString([string]$ConnectionString) {
  if ($ConnectionString -match '^(?i)postgres(?:ql)?://') {
    $uri = [Uri]$ConnectionString
    $values = @{}
    if (-not [string]::IsNullOrWhiteSpace($uri.Host)) { $values['host'] = $uri.Host }
    if ($uri.Port -gt 0) { $values['port'] = [string]$uri.Port }
    $database = $uri.AbsolutePath.TrimStart('/')
    if (-not [string]::IsNullOrWhiteSpace($database)) { $values['database'] = Decode-UriComponent $database }
    if (-not [string]::IsNullOrWhiteSpace($uri.UserInfo)) {
      $separator = $uri.UserInfo.IndexOf(':')
      if ($separator -lt 0) {
        $values['username'] = Decode-UriComponent $uri.UserInfo
      } else {
        $values['username'] = Decode-UriComponent $uri.UserInfo.Substring(0, $separator)
        $values['password'] = Decode-UriComponent $uri.UserInfo.Substring($separator + 1)
      }
    }
    if (-not [string]::IsNullOrWhiteSpace($uri.Query)) {
      foreach ($parameter in $uri.Query.TrimStart('?') -split '&') {
        if ([string]::IsNullOrWhiteSpace($parameter)) { continue }
        $separator = $parameter.IndexOf('=')
        if ($separator -lt 1) { continue }
        $key = Decode-UriQueryComponent $parameter.Substring(0, $separator)
        $value = Decode-UriQueryComponent $parameter.Substring($separator + 1)
        if (-not [string]::IsNullOrWhiteSpace($key)) { $values[$key.ToLowerInvariant()] = $value }
      }
    }
    return $values
  }

  # Npgsql values may contain semicolons when quoted.  A plain -split ';'
  # silently truncates such passwords and can make a valid backup fail.
  $segments = [Collections.Generic.List[string]]::new()
  $buffer = [Text.StringBuilder]::new()
  $quote = [char]0
  $closingQuote = [char]0
  for ($i = 0; $i -lt $ConnectionString.Length; $i++) {
    $character = $ConnectionString[$i]
    if ($quote -ne [char]0) {
      [void]$buffer.Append($character)
      if ($character -eq $closingQuote) {
        if ($i + 1 -lt $ConnectionString.Length -and $ConnectionString[$i + 1] -eq $closingQuote) {
          [void]$buffer.Append($ConnectionString[$i + 1])
          $i++
        } else {
          $quote = [char]0
        }
      }
      continue
    }
    if ($character -eq [char]34 -or $character -eq [char]39) {
      $quote = $character
      $closingQuote = $character
      [void]$buffer.Append($character)
      continue
    }
    if ($character -eq '{') {
      $quote = $character
      $closingQuote = '}'
      [void]$buffer.Append($character)
      continue
    }
    if ($character -eq ';') {
      [void]$segments.Add($buffer.ToString())
      [void]$buffer.Clear()
      continue
    }
    [void]$buffer.Append($character)
  }
  [void]$segments.Add($buffer.ToString())

  $values = @{}
  foreach ($segment in $segments) {
    if ([string]::IsNullOrWhiteSpace($segment)) { continue }
    $separator = $segment.IndexOf('=')
    if ($separator -lt 1) { continue }
    $key = $segment.Substring(0, $separator).Trim().ToLowerInvariant()
    $value = $segment.Substring($separator + 1).Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq [char]34 -and $value[$value.Length - 1] -eq [char]34) -or ($value[0] -eq [char]39 -and $value[$value.Length - 1] -eq [char]39) -or ($value[0] -eq '{' -and $value[$value.Length - 1] -eq '}'))) {
      $quoteCharacter = $value[0]
      $value = $value.Substring(1, $value.Length - 2)
      if ($quoteCharacter -eq '{') {
        $value = $value.Replace('}}', '}')
      } else {
        $escapedQuote = [string]$quoteCharacter + [string]$quoteCharacter
        $value = $value.Replace($escapedQuote, [string]$quoteCharacter)
      }
    }
    $values[$key] = $value
  }
  return $values
}

function Save-PostgresEnvironment() {
  $state = @{}
  foreach ($name in (Get-PostgresEnvironmentNames)) {
    $state[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  return $state
}

function Restore-PostgresEnvironment([hashtable]$State) {
  foreach ($name in (Get-PostgresEnvironmentNames)) {
    [Environment]::SetEnvironmentVariable($name, $State[$name], 'Process')
  }
}

function Set-PostgresEnvironment([string]$ConnectionString) {
  $values = Parse-PostgresConnectionString $ConnectionString
  foreach ($name in (Get-PostgresEnvironmentNames)) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
  $aliases = @{
    host = 'PGHOST'; server = 'PGHOST'
    port = 'PGPORT'
    database = 'PGDATABASE'; 'initial catalog' = 'PGDATABASE'
    username = 'PGUSER'; 'user id' = 'PGUSER'; user = 'PGUSER'
    password = 'PGPASSWORD'
    sslmode = 'PGSSLMODE'; 'ssl mode' = 'PGSSLMODE'
    applicationname = 'PGAPPNAME'; 'application name' = 'PGAPPNAME'
    'connect timeout' = 'PGCONNECT_TIMEOUT'; timeout = 'PGCONNECT_TIMEOUT'
    options = 'PGOPTIONS'
    'target session attrs' = 'PGTARGETSESSIONATTRS'; target_session_attrs = 'PGTARGETSESSIONATTRS'
    service = 'PGSERVICE'; passfile = 'PGPASSFILE'; hostaddr = 'PGHOSTADDR'
    'root certificate' = 'PGSSLROOTCERT'; rootcertificate = 'PGSSLROOTCERT'; root_certificate = 'PGSSLROOTCERT'; sslrootcert = 'PGSSLROOTCERT'
    'ssl certificate' = 'PGSSLCERT'; sslcertificate = 'PGSSLCERT'; ssl_certificate = 'PGSSLCERT'; sslcert = 'PGSSLCERT'
    'ssl key' = 'PGSSLKEY'; sslkey = 'PGSSLKEY'
    'ssl crl' = 'PGSSLCRL'; sslcrl = 'PGSSLCRL'
    'ssl crl dir' = 'PGSSLCRLDIR'; sslcrldir = 'PGSSLCRLDIR'; ssl_crl_dir = 'PGSSLCRLDIR'
    'ssl negotiation' = 'PGSSLNEGOTIATION'; sslnegotiation = 'PGSSLNEGOTIATION'
    'ssl sni' = 'PGSSLSNI'; sslsni = 'PGSSLSNI'
    'ssl compression' = 'PGSSLCOMPRESSION'; sslcompression = 'PGSSLCOMPRESSION'
    'ssl min protocol version' = 'PGSSLMINPROTOCOLVERSION'; sslminprotocolversion = 'PGSSLMINPROTOCOLVERSION'; ssl_min_protocol_version = 'PGSSLMINPROTOCOLVERSION'
    'ssl max protocol version' = 'PGSSLMAXPROTOCOLVERSION'; sslmaxprotocolversion = 'PGSSLMAXPROTOCOLVERSION'; ssl_max_protocol_version = 'PGSSLMAXPROTOCOLVERSION'
    'require ssl' = 'PGREQUIRESSL'; requiressl = 'PGREQUIRESSL'; require_ssl = 'PGREQUIRESSL'
  }
  foreach ($entry in $aliases.GetEnumerator()) {
    if ($values.ContainsKey($entry.Key) -and -not [string]::IsNullOrWhiteSpace($values[$entry.Key])) {
      [Environment]::SetEnvironmentVariable($entry.Value, $values[$entry.Key], 'Process')
    }
  }
}

function Get-SafeTargetLabel([string]$Target) {
  if ($Target -notmatch '=' -and $Target -notmatch '^(?i)postgres(?:ql)?://') { return $Target }
  $values = Parse-PostgresConnectionString $Target
  $database = $null
  foreach ($key in @('database', 'initial catalog')) {
    if ($values.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($values[$key])) {
      $database = $values[$key]
      break
    }
  }
  if ([string]::IsNullOrWhiteSpace($database)) { return '[connection string]' }
  return "[connection string; database=$database]"
}

if ($Action -eq 'backup') {
  $stamp = "{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), ([guid]::NewGuid().ToString('N').Substring(0,8))
  $dump = Join-Path $resolvedRoot ("zhike-{0}.dump" -f $stamp)
  if ($DryRun) {
    Write-Output (ConvertTo-Json @{ action = 'backup'; output = $dump; dryRun = $true })
    exit 0
  }
  if ([string]::IsNullOrWhiteSpace($env:ConnectionStrings__Postgres)) { throw 'ConnectionStrings__Postgres is required' }
  $temporaryDump = "$dump.$PID.tmp"
  $previousPostgresEnvironment = Save-PostgresEnvironment
  try {
    Set-PostgresEnvironment $env:ConnectionStrings__Postgres
    & pg_dump --format=custom --file $temporaryDump
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
  } catch {
    if (Test-Path -LiteralPath $temporaryDump) { Remove-Item -LiteralPath $temporaryDump -Force -ErrorAction SilentlyContinue }
    throw
  } finally {
    Restore-PostgresEnvironment $previousPostgresEnvironment
  }
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
$safeTargetLabel = Get-SafeTargetLabel $TargetDatabase
if ($DryRun) {
  Write-Output (ConvertTo-Json @{ action = 'restore'; source = $resolvedSource; target = $safeTargetLabel; dryRun = $true; deleteUnrelated = $false })
  exit 0
}
$previousPostgresEnvironment = Save-PostgresEnvironment
try {
  if ($TargetDatabase -match '=' -or $TargetDatabase -match '^(?i)postgres(?:ql)?://') {
    Set-PostgresEnvironment $TargetDatabase
    $restoreTarget = $env:PGDATABASE
    if ([string]::IsNullOrWhiteSpace($restoreTarget)) { throw 'TargetDatabase connection string must include Database' }
  } else {
    $restoreTarget = $TargetDatabase
  }
  & pg_restore --exit-on-error --dbname $restoreTarget $resolvedSource
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE" }
} finally {
  Restore-PostgresEnvironment $previousPostgresEnvironment
}
Write-Output (ConvertTo-Json @{ action = 'restore'; source = $resolvedSource; target = $safeTargetLabel; dryRun = $false; deleteUnrelated = $false })
