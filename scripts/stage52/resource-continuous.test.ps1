[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$NodePath)

$ErrorActionPreference = 'Stop'
# Node writes UTF-8. On a non-English Windows the console code page decodes it
# as the local ANSI code page, which corrupts non-ASCII captions and can swallow
# the closing quote of a JSON string. Pin both directions to UTF-8.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('zhike-stage51-native-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $testRoot)
$fixturePath = Join-Path $testRoot 'Zhike.Stage51.Acceptance.exe'
$sourceName = 'continuous-test.jsonl'
$sourcePath = Join-Path $testRoot $sourceName
$utf8 = [Text.UTF8Encoding]::new($false)
$fixture = $null
$job = $null
try {
    # Gather real Windows counters on a short-lived test process tree. This
    # fixture exercises the observer protocol without starting the application.
    Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\cmd.exe') -Destination $fixturePath
    [IO.File]::WriteAllText((Join-Path $testRoot '.stage51-isolated'), 'zhike-stage51-isolated-ui-v1', $utf8)
    $fixture = Start-Process -FilePath $fixturePath -ArgumentList '/d /c start "" /b ping.exe -n 26 127.0.0.1 >nul & ping.exe -n 20 127.0.0.1 >nul' -WindowStyle Hidden -PassThru
    $startup = [ordered]@{ at = [DateTime]::UtcNow.ToString('o'); pid = $fixture.Id; kind = 'application-start' }
    [IO.File]::WriteAllText((Join-Path $testRoot 'native-events.jsonl'), (($startup | ConvertTo-Json -Compress) + [Environment]::NewLine), $utf8)
    $collector = Join-Path $PSScriptRoot 'resource-observe.ps1'
    $job = Start-ThreadJob -ArgumentList $collector, $fixture.Id, $testRoot, $sourceName -ScriptBlock {
        param($scriptPath, $processId, $isolatedRoot, $observation)
        & $scriptPath -RootPid $processId -TestRoot $isolatedRoot -OutputName $observation -Samples 40 -IntervalSeconds 1 -ExitTailSamples 12
    }
    $ready = $null
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while (-not $ready -and $watch.Elapsed.TotalSeconds -lt 16 -and $job.State -notin @('Failed', 'Stopped', 'Completed')) {
        if (Test-Path -LiteralPath $sourcePath) { $ready = Get-Content -LiteralPath $sourcePath -TotalCount 1 }
        if (-not $ready) { Start-Sleep -Milliseconds 100 }
    }
    if (-not $ready) { Receive-Job $job; throw 'Continuous sampler did not emit its first sample.' }
    $marker = Join-Path $PSScriptRoot 'resource-mark.ps1'
    $operation = @{ RootPid = $fixture.Id; TestRoot = $testRoot; ObservationName = $sourceName; Phase = 'wheel'; OperationId = 'wheel-01' }
    $null = & $marker @operation -Boundary begin
    Start-Sleep -Milliseconds 50
    $null = & $marker @operation -Boundary end -Outcome no-change
    $operation.Phase = 'before-close'; $operation.OperationId = 'close-01'
    $null = & $marker @operation -Boundary begin
    if (-not (Wait-Job $job -Timeout 35)) { throw 'Continuous sampler did not finish after observed process exit.' }
    # The thread job can surface collector output before the final context line
    # under PowerShell 7, and a truncated deep object can make an earlier
    # candidate invalid JSON. Take the newest candidate that parses and carries
    # the observation status instead of trusting stream ordering.
    $observed = @(Receive-Job $job)
    $candidates = @($observed | Where-Object { $_ -is [string] } | ForEach-Object { $_.Trim() } | Where-Object { $_.StartsWith('{') })
    [array]::Reverse($candidates)
    $context = $null
    foreach ($candidate in $candidates) {
        try { $parsed = $candidate | ConvertFrom-Json -ErrorAction Stop } catch { continue }
        if ($parsed -and $parsed.PSObject.Properties.Name -contains 'status') { $context = $parsed; break }
    }
    if (-not $context) { throw 'Continuous sampler emitted no parsable observation context.' }
    if ($context.status -ne 'Observed' -or $context.actualSamples -lt 3) { throw 'Missing observation context.' }
    # PowerShell returns native stdout as one string per line; joining them is
    # required before ConvertFrom-Json, which parses each input object whole.
    $reportText = (& $NodePath (Join-Path $PSScriptRoot 'resource-summary.cjs') $testRoot $sourceName $fixture.Id --stdout) -join [Environment]::NewLine
    $report = $reportText | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Resource summary failed.' }
    if ($report.operations[0].outcome -ne 'no-change' -or $report.operations[0].durationMs -lt 50) { throw 'Operation duration or outcome was lost.' }
    if ($report.exit.status -ne 'observed-identities-released' -or $report.exit.closeToRootExitUpperBoundMs -le 0) { throw 'Observed exit or timing bounds were lost.' }
    $tail = @($report.resourceSeries | Where-Object { -not $_.rootAlive })
    if ($tail.Count -lt 2 -or $tail[0].processCount -lt 1 -or $tail[-1].processCount -ne 0) { throw 'A child that outlived the root was not observed through exit.' }
    if ($null -eq $report.liveObservationPeaks.machineCpuPercent -or $null -eq $report.liveObservationPeaks.gdiObjects -or $null -eq $report.liveObservationPeaks.userObjects) { throw 'CPU or GUI resource samples were not reported.' }
    'Stage 5.2 continuous resource observation, monotonic operation markers and child exit tail Passed (Windows process fixture)'
} finally {
    if ($job) { Remove-Job $job -Force }
    if ($fixture) { $fixture.Dispose() }
    foreach ($name in @('.stage51-isolated', 'native-events.jsonl', 'Zhike.Stage51.Acceptance.exe', $sourceName, 'continuous-test.context.json', 'continuous-test.operations.jsonl')) {
        Remove-Item -LiteralPath (Join-Path $testRoot $name) -ErrorAction SilentlyContinue
    }
    if (-not (Get-ChildItem -LiteralPath $testRoot -Force)) { Remove-Item -LiteralPath $testRoot }
}
