[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][int]$RootPid,
    [Parameter(Mandatory = $true)][string]$TestRoot
)
$ErrorActionPreference = 'Stop'
# Exercise the real guarded marker against an actual isolated process. Do not
# create a hand-written lookalike of the nested C# counter snapshot.
$output = & (Join-Path $PSScriptRoot 'resource-mark.ps1') -RootPid $RootPid -TestRoot $TestRoot -Phase startup-idle -Boundary snapshot
$returned = $output | ConvertFrom-Json -ErrorAction Stop
$last = Get-Content -LiteralPath (Join-Path $TestRoot 'stage52-operation-ledger.jsonl') -Tail 1 | ConvertFrom-Json -ErrorAction Stop
foreach ($entry in @($returned.operation, $last)) {
    if ($null -eq $entry.diagnosticCounterSnapshot -or $entry.diagnosticCounterSnapshot -is [string]) { throw 'The real counter snapshot was lost or stringified.' }
    if ($entry.diagnosticCounterSnapshot.pid -ne $RootPid -or $null -eq $entry.diagnosticCounterSnapshot.counts -or $entry.diagnosticCounterSnapshot.counts -is [string]) { throw 'Nested diagnostic counts were stringified.' }
    $properties = @($entry.diagnosticCounterSnapshot.counts.PSObject.Properties)
    if ($properties.Count -eq 0) { throw 'No actual native counter was available for verification.' }
    foreach ($property in $properties) {
        if ($property.Value -is [string] -or $null -eq $property.Value.total -or $property.Value.total -is [string]) { throw 'An actual nested numeric counter changed type.' }
        if ($property.Value.emitted + $property.Value.suppressed -ne $property.Value.total) { throw 'Nested diagnostic total mismatch.' }
    }
}
[ordered]@{ status='Passed'; test='real isolated native marker preserves nested numeric diagnostic counters in stdout and ledger'; rootPid=$RootPid; counters=@($last.diagnosticCounterSnapshot.counts.PSObject.Properties).Count; simulatedCounters=$false; productionDataRead=$false } | ConvertTo-Json -Compress
