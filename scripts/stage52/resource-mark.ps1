[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$RootPid,
    [Parameter(Mandatory = $true)][string]$TestRoot,
    [Parameter(Mandatory = $true)][ValidateSet('startup-idle','ten-page-switch','account-switch','member-load','ai-refresh','crm-refresh','long-idle','before-close','crm-ws-page','group-page','member-page','dialog','minimize-restore','dpi-change','wheel','steady-idle')][string]$Phase,
    [ValidateSet('begin','end','snapshot')][string]$Boundary = 'snapshot',
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]*\.jsonl$')][string]$ObservationName,
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$')][string]$OperationId,
    [ValidateSet('completed','no-change','timed-out','aborted','unverified')][string]$Outcome
)
$enteredTimestamp = [Diagnostics.Stopwatch]::GetTimestamp()
$enteredUtc = [DateTime]::UtcNow.ToString('o')
$ErrorActionPreference = 'Stop'

if ($ObservationName) {
    if (-not $OperationId) { throw 'An observation marker requires an operation ID.' }
    if (($Boundary -eq 'end') -ne [bool]$Outcome) { throw 'An outcome is required exactly for end markers.' }
    $testPath = [IO.Path]::GetFullPath($TestRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $temporaryPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not [string]::Equals([IO.Path]::GetDirectoryName($testPath), $temporaryPath, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($testPath) -notmatch '^zhike-stage51-native-[a-f0-9]{32}$') {
        throw 'An explicit isolated native test root is required.'
    }
    $markerPath = Join-Path $testPath '.stage51-isolated'
    $observationPath = Join-Path $testPath $ObservationName
    foreach ($itemPath in @($testPath, $markerPath, $observationPath)) {
        if (((Get-Item -LiteralPath $itemPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are forbidden in observation markers.' }
    }
    if ((Get-Content -LiteralPath $markerPath -Raw) -cne 'zhike-stage51-isolated-ui-v1') { throw 'Isolated root marker is invalid.' }
    $first = Get-Content -LiteralPath $observationPath -TotalCount 1 | ConvertFrom-Json
    $identity = @($first.processes | Where-Object { $_.pid -eq $RootPid })
    if ($first.rootPid -ne $RootPid -or -not $first.rootAlive -or $identity.Count -ne 1) { throw 'Observation does not attest the requested root PID.' }
    $observedStart = ([DateTimeOffset]$identity[0].startedUtc).UtcDateTime
    $process = Get-Process -Id $RootPid
    try {
        if ($process.StartTime.ToUniversalTime().Ticks -ne $observedStart.Ticks) { throw 'Observed root process identity has changed.' }
    } finally { $process.Dispose() }

    $ledgerPath = Join-Path $testPath ([IO.Path]::GetFileNameWithoutExtension($ObservationName) + '.operations.jsonl')
    if ((Test-Path -LiteralPath $ledgerPath) -and ((Get-Item -LiteralPath $ledgerPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Operation ledger is a reparse point.' }
    $entry = [ordered]@{
        schemaVersion = 2; rootPid = $RootPid; rootStartedUtc = $observedStart.ToString('o'); observationFile = $ObservationName
        operationId = $OperationId; phase = $Phase; boundary = $Boundary; outcome = $Outcome
        atUtc = $(if ($Boundary -eq 'begin') { [DateTime]::UtcNow.ToString('o') } else { $enteredUtc })
        monotonicTicks = $(if ($Boundary -eq 'begin') { [Diagnostics.Stopwatch]::GetTimestamp() } else { $enteredTimestamp })
        monotonicFrequency = [Diagnostics.Stopwatch]::Frequency
    }
    $json = $entry | ConvertTo-Json -Compress
    [IO.File]::AppendAllText($ledgerPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    $json
    return
}
if ($OperationId -or $Outcome) { throw 'Operation IDs and outcomes require an observation name.' }

# A one-sample invocation applies all existing root/PID safeguards before any
# operation marker is written. It neither sends UI input nor changes app state.
$name = 'stage52-' + $Phase + '-' + $Boundary + '-' + [Guid]::NewGuid().ToString('N') + '.jsonl'
$resultText = & (Join-Path $PSScriptRoot '..\stage51\resource-observe.ps1') -RootPid $RootPid -TestRoot $TestRoot -Samples 1 -OutputName $name
$result = $resultText | ConvertFrom-Json -ErrorAction Stop
$counterFile = Join-Path $TestRoot "native-event-counts-$RootPid.json"
$counterSnapshot = $null
if (Test-Path -LiteralPath $counterFile) {
    $counterSnapshot = Get-Content -LiteralPath $counterFile -Raw | ConvertFrom-Json -ErrorAction Stop
    if ($counterSnapshot.pid -ne $RootPid) { throw 'Diagnostic counter snapshot belongs to a different test PID.' }
    foreach ($property in $counterSnapshot.counts.PSObject.Properties) {
        $value = $property.Value
        $total = 0L; $emitted = 0L; $suppressed = 0L
        if (-not [long]::TryParse([string]$value.total, [ref]$total) -or -not [long]::TryParse([string]$value.emitted, [ref]$emitted) -or -not [long]::TryParse([string]$value.suppressed, [ref]$suppressed) -or $total -lt 0 -or $emitted -lt 0 -or $suppressed -lt 0 -or ($emitted + $suppressed) -ne $total) { throw 'Diagnostic counter snapshot is inconsistent.' }
    }
}
$entry = [ordered]@{
    schemaVersion = 1; stage = '5.2'; atUtc = [DateTime]::UtcNow.ToString('o'); rootPid = $RootPid
    phase = $Phase; boundary = $Boundary; snapshotFile = $name
    diagnosticCounterSnapshot = $counterSnapshot
    diagnosticCounterLimitation = 'Snapshot includes suppressed totals but may lag the last partial flush; final sidecar-stopped counters are authoritative for the completed session.'
    note = 'The operator must confirm that the named native interaction was actually performed; this marker alone is not a pass.'
}
[IO.File]::AppendAllText((Join-Path $TestRoot 'stage52-operation-ledger.jsonl'), (($entry | ConvertTo-Json -Depth 12 -Compress) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
[ordered]@{ operation = $entry; resourceSnapshot = $result } | ConvertTo-Json -Depth 12 -Compress
