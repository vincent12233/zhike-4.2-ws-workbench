[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TestRoot,
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]*\.jsonl$')][string]$SourceName = 'native-ui-resource.jsonl'
)
$ErrorActionPreference = 'Stop'
$testPath = [IO.Path]::GetFullPath($TestRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$tempPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $testPath.StartsWith($tempPath, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($testPath) -notmatch '^zhike-stage51-native-[a-f0-9]{32}$') { throw 'An explicit isolated native test root is required.' }
$current = Get-Item -LiteralPath $testPath
while ($null -ne $current -and $current.FullName.Length -ge $tempPath.Length) { if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse-point temporary roots are forbidden.' }; $current = $current.Parent }
if ((Get-Content -LiteralPath (Join-Path $testPath '.stage51-isolated') -Raw) -cne 'zhike-stage51-isolated-ui-v1') { throw 'Isolated native test marker is invalid.' }
$records = @(Get-Content -LiteralPath (Join-Path $testPath $SourceName) | ForEach-Object { ConvertFrom-Json -InputObject $_ })
$identities = @{}
foreach ($record in $records) { foreach ($row in $record.processes) { $identities["$($row.pid):$($row.startedUtc)"] = $row } }
if ($records.Count -eq 0 -or $identities.Count -eq 0) { throw 'Cleanup cannot be verified without observed process identities.' }
$remaining = @()
$unverified = @()
foreach ($known in $identities.Values) {
    $process = Get-Process -Id $known.pid -ErrorAction SilentlyContinue
    if ($null -eq $process) { continue }
    try {
        $expectedStart = if ($known.startedUtc -is [DateTime]) { $known.startedUtc.ToUniversalTime() } elseif ($known.startedUtc -is [DateTimeOffset]) { $known.startedUtc.UtcDateTime } else { [DateTime]::ParseExact([string]$known.startedUtc, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() }
        if ($process.StartTime.ToUniversalTime().Ticks -eq $expectedStart.Ticks) { $remaining += [pscustomobject]@{ pid = $known.pid; name = $process.ProcessName; workingSetBytes = $process.WorkingSet64; threads = $process.Threads.Count; handles = $process.HandleCount } }
    } catch { $unverified += [pscustomobject]@{ pid = $known.pid; exceptionType = $_.Exception.GetType().FullName } } finally { $process.Dispose() }
}
[ordered]@{ status = $(if ($unverified.Count -gt 0) { 'Blocked' } elseif ($remaining.Count -eq 0) { 'Passed' } else { 'ObservedProcessesRemain' }); checkedAtUtc = [DateTime]::UtcNow.ToString('o'); evidenceFile = $SourceName; observedProcessIdentities = $identities.Count; remainingCount = $remaining.Count; remainingProcesses = $remaining; unverifiedCount = $unverified.Count; unverifiedProcesses = $unverified; processTerminatedByCheck = $false; scope = 'read-only process identity checks after application close' } | ConvertTo-Json -Depth 4 -Compress
