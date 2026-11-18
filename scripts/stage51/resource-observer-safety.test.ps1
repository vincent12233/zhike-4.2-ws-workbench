$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('zhike-stage51-native-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $testRoot)
$marker = Join-Path $testRoot '.stage51-isolated'
$evidence = Join-Path $testRoot 'identity.jsonl'
$encoding = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($marker, 'zhike-stage51-isolated-ui-v1', $encoding)
$current = Get-Process -Id $PID
$record = [ordered]@{ processes = @([ordered]@{ pid = $PID; startedUtc = $current.StartTime.ToUniversalTime().ToString('o') }) }
$current.Dispose()
try {
    [IO.File]::WriteAllText($evidence, ($record | ConvertTo-Json -Depth 4 -Compress), $encoding)
    $live = (& (Join-Path $PSScriptRoot 'resource-check-cleanup.ps1') -TestRoot $testRoot -SourceName 'identity.jsonl') | ConvertFrom-Json
    if ($live.remainingCount -ne 1 -or $live.status -ne 'ObservedProcessesRemain') { throw 'Live process identity was not detected.' }
    $record.processes[0].startedUtc = ([DateTime]::UtcNow.AddHours(-1)).ToString('o')
    [IO.File]::WriteAllText($evidence, ($record | ConvertTo-Json -Depth 4 -Compress), $encoding)
    $reused = (& (Join-Path $PSScriptRoot 'resource-check-cleanup.ps1') -TestRoot $testRoot -SourceName 'identity.jsonl') | ConvertFrom-Json
    if ($reused.remainingCount -ne 0) { throw 'A mismatched creation timestamp was attributed to the observed process.' }
    $record.processes[0].startedUtc = 'malformed-timestamp'
    [IO.File]::WriteAllText($evidence, ($record | ConvertTo-Json -Depth 4 -Compress), $encoding)
    $unknown = (& (Join-Path $PSScriptRoot 'resource-check-cleanup.ps1') -TestRoot $testRoot -SourceName 'identity.jsonl') | ConvertFrom-Json
    if ($unknown.status -ne 'Blocked' -or $unknown.unverifiedCount -ne 1) { throw 'Unverifiable live process identity was incorrectly marked clean.' }
    [IO.File]::WriteAllText($marker, 'invalid-marker', $encoding)
    $rejected = $false
    try { [void](& (Join-Path $PSScriptRoot 'resource-check-cleanup.ps1') -TestRoot $testRoot -SourceName 'identity.jsonl') } catch { $rejected = $true }
    if (-not $rejected) { throw 'Invalid isolation marker was accepted.' }
    'Stage 5.1 resource identity: live PID detection, creation-time mismatch rejection, unverifiable identity fail-closed and marker rejection Passed'
} finally {
    Remove-Item -LiteralPath $evidence -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $marker -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $testRoot
}
