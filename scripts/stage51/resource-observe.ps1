[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$RootPid,
    [Parameter(Mandatory = $true)][string]$TestRoot,
    [ValidateRange(1, 120)][int]$IntervalSeconds = 10,
    [ValidateRange(1, 3600)][int]$Samples = 31,
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]*\.jsonl$')][string]$OutputName = 'resource-samples.jsonl',
    [switch]$Detailed,
    [ValidateRange(0, 60)][int]$ExitTailSamples = 0
)

$ErrorActionPreference = 'Stop'
$testPath = [IO.Path]::GetFullPath($TestRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$tempPath = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $testPath.StartsWith($tempPath, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($testPath) -notmatch '^zhike-stage51-native-[a-f0-9]{32}$') { throw 'Stage 5.1 test directory is outside the required temporary root.' }
$current = Get-Item -LiteralPath $testPath
while ($null -ne $current -and $current.FullName.Length -ge $tempPath.Length) {
    if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse-point temporary roots are forbidden.' }
    $current = $current.Parent
}
$markerPath = Join-Path $testPath '.stage51-isolated'
$eventPath = Join-Path $testPath 'native-events.jsonl'
if ($Detailed) {
    foreach ($itemPath in @($markerPath, $eventPath)) {
        if (((Get-Item -LiteralPath $itemPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse-point diagnostic inputs are forbidden.' }
    }
}
if ((Get-Content -LiteralPath $markerPath -Raw) -cne 'zhike-stage51-isolated-ui-v1') { throw 'Isolated native test marker is missing or invalid.' }
$rootProcess = Get-Process -Id $RootPid
if ($rootProcess.ProcessName -notin @('Zhike.Desktop', 'Zhike.Stage51.Acceptance')) { throw 'Root process is not an expected isolated Zhike desktop application.' }
$rootStarted = $rootProcess.StartTime.ToUniversalTime()
$rootProcess.Dispose()
$attested = @(Get-Content -LiteralPath $eventPath | ForEach-Object { try { ConvertFrom-Json -InputObject $_ } catch {} } | Where-Object {
    $_.pid -eq $RootPid -and (-not $Detailed -or ($_.kind -eq 'application-start' -and ([DateTimeOffset]$_.at).UtcDateTime -ge $rootStarted))
}).Count -gt 0
if (-not $attested) { throw 'The supplied PID has not written an isolated native event in this test directory.' }
if ($ExitTailSamples -gt 0 -and -not $Detailed) { throw 'Exit tail samples require detailed identity states.' }
if ($Detailed -and -not ('ZhikeResourceGui' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class ZhikeResourceGui
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetGuiResources(IntPtr process, uint flag);

    public static uint? Count(IntPtr process, uint flag)
    {
        uint count = GetGuiResources(process, flag);
        return count == 0 && Marshal.GetLastWin32Error() != 0 ? (uint?)null : count;
    }
}
'@
}
$outputPath = Join-Path $testPath $OutputName
if (Test-Path -LiteralPath $outputPath) { throw 'Resource output already exists; use a new output name to preserve prior evidence.' }
$encoding = [Text.UTF8Encoding]::new($false)
$file = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$stream = [IO.StreamWriter]::new($file, $encoding)
$watch = [Diagnostics.Stopwatch]::StartNew()
$observedPids = [Collections.Generic.HashSet[int]]::new()
$observedStarts = @{}
$observedCpu = @{}
$initialCpuSeconds = 0.0
$exitSamples = 0
$runtimeVersion = $null
if ($Detailed) {
    [void]$observedPids.Add($RootPid)
    $observedStarts[$RootPid] = $rootStarted.Ticks
}
try {
    for ($sample = 0; $sample -lt ($Samples + $ExitTailSamples); $sample++) {
        $probeStarted = [Diagnostics.Stopwatch]::GetTimestamp()
        $rootNow = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
        $rootState = 'exited'
        try {
            if ($null -ne $rootNow) {
                $rootState = if ($rootNow.StartTime.ToUniversalTime() -eq $rootStarted) { 'alive' } else { 'pid-reused' }
            }
        } catch { $rootState = 'unverified' }
        finally { if ($null -ne $rootNow) { $rootNow.Dispose() } }
        $probeEnded = [Diagnostics.Stopwatch]::GetTimestamp()
        $probeEndedUtc = [DateTime]::UtcNow.ToString('o')
        $rootAlive = $rootState -eq 'alive'
        $tree = [Collections.Generic.HashSet[int]]::new()
        [void]$tree.Add($RootPid)
        $processes = if ($rootAlive) { @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId) } else { @() }
        if (-not $rootAlive) { foreach ($previousId in $observedPids) { [void]$tree.Add($previousId) } }
        do {
            $added = $false
            foreach ($process in $processes) {
                if ($tree.Contains([int]$process.ParentProcessId) -and $tree.Add([int]$process.ProcessId)) { $added = $true }
            }
        } while ($added)
        # Previously observed descendants may outlive their intermediate parent.
        if ($Detailed) { foreach ($previousId in $observedPids) { [void]$tree.Add($previousId) } }
        $rows = @()
        $unverified = @()
        $counterUnavailable = @()
        $remaining = @()
        foreach ($processId in $tree) {
            $item = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($null -eq $item) { continue }
            try {
                $started = $item.StartTime.ToUniversalTime()
                $startedTicks = $started.Ticks
                if ($Detailed -and ($started -lt $rootStarted -or ($processId -eq $RootPid -and $started -ne $rootStarted))) { continue }
                if ($observedStarts.ContainsKey($processId) -and $observedStarts[$processId] -ne $startedTicks) { continue }
                if (-not $rootAlive -and -not $observedStarts.ContainsKey($processId)) { continue }
                $observedStarts[$processId] = $startedTicks
            } catch { $unverified += $processId; $item.Dispose(); continue }
            [void]$observedPids.Add($processId)
            $remaining += $processId
            try {
                $cpuKey = "$processId`:$startedTicks"
                $cpuSeconds = $item.TotalProcessorTime.TotalSeconds
                $observedCpu[$cpuKey] = [Math]::Max([double]$observedCpu[$cpuKey], $cpuSeconds)
                if ($sample -eq 0) { $initialCpuSeconds += $cpuSeconds }
                $row = [ordered]@{ pid = $processId; name = $item.ProcessName; startedUtc = $started.ToString('o'); workingSetBytes = $item.WorkingSet64; privateBytes = $item.PrivateMemorySize64; threads = $item.Threads.Count; handles = $item.HandleCount; cpuSeconds = $cpuSeconds }
                if ($Detailed) {
                    $row.gdiObjects = $null; $row.userObjects = $null
                    try {
                        $handle = $item.Handle
                        $row.gdiObjects = [ZhikeResourceGui]::Count($handle, 0)
                        $row.userObjects = [ZhikeResourceGui]::Count($handle, 1)
                    } catch { } # Null identifies a GUI count unavailable for this process.
                    if (-not $runtimeVersion -and $row.name -like 'msedgewebview2*') {
                        try { $runtimeVersion = (Get-Item -LiteralPath $item.Path).VersionInfo.FileVersion } catch { }
                    }
                }
                $rows += [pscustomobject]$row
            } catch { $counterUnavailable += $processId } finally { $item.Dispose() }
        }
        $record = [ordered]@{
            schemaVersion = 1; atUtc = [DateTime]::UtcNow.ToString('o'); elapsedMs = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1); sample = $sample; rootPid = $RootPid; rootAlive = $rootAlive
            processCount = $rows.Count; webViewProcessCount = @($rows | Where-Object { $_.name -like 'msedgewebview2*' }).Count
            workingSetBytes = ($rows | Measure-Object -Property workingSetBytes -Sum).Sum; privateBytes = ($rows | Measure-Object -Property privateBytes -Sum).Sum
            threads = ($rows | Measure-Object -Property threads -Sum).Sum; handles = ($rows | Measure-Object -Property handles -Sum).Sum; processes = $rows
            scope = 'isolated application process counters only'; performanceThreshold = $null
        }
        if ($Detailed) {
            $record.schemaVersion = 2
            $record.rootStartedUtc = $rootStarted.ToString('o')
            $record.rootIdentityState = $rootState
            $record.rootIdentityProbeStartedTicks = $probeStarted
            $record.rootIdentityProbeEndedTicks = $probeEnded
            $record.rootIdentityProbeEndedUtc = $probeEndedUtc
            $record.monotonicTicks = [Diagnostics.Stopwatch]::GetTimestamp()
            $record.monotonicFrequency = [Diagnostics.Stopwatch]::Frequency
            $record.remainingObservedPids = $remaining
            $record.unverifiedPids = $unverified
            $record.counterUnavailablePids = $counterUnavailable
        }
        $stream.WriteLine(($record | ConvertTo-Json -Depth 6 -Compress)); $stream.Flush()
        if (-not $rootAlive) {
            $exitSamples++
            if ($exitSamples -ge $ExitTailSamples -or ($rootState -ne 'unverified' -and $remaining.Count -eq 0 -and $unverified.Count -eq 0)) { break }
        } elseif ($sample -ge $Samples - 1) { break }
        Start-Sleep -Seconds $IntervalSeconds
    }
} finally { $stream.Dispose(); $watch.Stop() }
$records = @(Get-Content -LiteralPath $outputPath | ForEach-Object { ConvertFrom-Json -InputObject $_ })
$first = $records[0]; $last = $records[-1]
$result = [ordered]@{
    status = 'Observed'; evidenceFile = $OutputName; samples = $records.Count; durationMs = $last.elapsedMs
    rootAliveAtEnd = $last.rootAlive; workingSetFirstBytes = $first.workingSetBytes; workingSetLastBytes = $last.workingSetBytes; workingSetDeltaBytes = $last.workingSetBytes - $first.workingSetBytes
    workingSetPeakBytes = ($records | Measure-Object -Property workingSetBytes -Maximum).Maximum
    privatePeakBytes = ($records | Measure-Object -Property privateBytes -Maximum).Maximum
    privateFirstBytes = $first.privateBytes; privateLastBytes = $last.privateBytes; threadsFirst = $first.threads; threadsLast = $last.threads; handlesFirst = $first.handles; handlesLast = $last.handles
    threadsPeak = ($records | Measure-Object -Property threads -Maximum).Maximum; handlesPeak = ($records | Measure-Object -Property handles -Maximum).Maximum
    observedCpuDeltaSeconds = [Math]::Round((($observedCpu.Values | Measure-Object -Sum).Sum - $initialCpuSeconds), 4)
    webViewProcessCountFirst = $first.webViewProcessCount; webViewProcessCountLast = $last.webViewProcessCount; observedProcessCount = $observedPids.Count
    scope = 'process counters; no window input or application memory/credential inspection'; threshold = 'NotDefined'; gateInference = 'No automatic performance pass is inferred'
}
if ($Detailed) {
    $result.exitSamples = $exitSamples
    $result.webView2RuntimeFileVersion = $runtimeVersion
}
$result | ConvertTo-Json -Depth 4 -Compress
