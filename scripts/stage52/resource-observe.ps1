[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$RootPid,
    [Parameter(Mandatory = $true)][string]$TestRoot,
    [ValidateRange(1, 120)][int]$IntervalSeconds = 10,
    [ValidateRange(1, 3600)][int]$Samples = 91,
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]*\.jsonl$')][string]$OutputName = 'stage52-resource-samples.jsonl',
    [ValidateSet('Release','Debug')][string]$BuildConfiguration = 'Release',
    [ValidateRange(0, 60)][int]$ExitTailSamples = 0
)
$ErrorActionPreference = 'Stop'
$collector = Join-Path $PSScriptRoot '..\stage51\resource-observe.ps1'
$process = Get-Process -Id $RootPid -ErrorAction Stop
try {
    $binary = $process.Path
    $binaryVersion = (Get-Item -LiteralPath $binary).VersionInfo
    $startUtc = $process.StartTime.ToUniversalTime().ToString('o')
} finally { $process.Dispose() }
$os = Get-CimInstance Win32_OperatingSystem
$resultText = & $collector -RootPid $RootPid -TestRoot $TestRoot -IntervalSeconds $IntervalSeconds -Samples $Samples -OutputName $OutputName -Detailed -ExitTailSamples $ExitTailSamples
$result = $resultText | ConvertFrom-Json -ErrorAction Stop
$records = @(Get-Content -LiteralPath (Join-Path $TestRoot $OutputName) | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop })
$context = [ordered]@{
    stage = '5.2'; status = 'Observed'; checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    rootPid = $RootPid; rootStartedUtc = $startUtc
    windowsCaption = $os.Caption; windowsVersion = $os.Version; architecture = $os.OSArchitecture
    appProductVersion = $binaryVersion.ProductVersion; appFileVersion = $binaryVersion.FileVersion
    configurationDeclaredByRunner = $BuildConfiguration; webView2RuntimeFileVersion = $result.webView2RuntimeFileVersion
    logicalProcessorCount = [Environment]::ProcessorCount
    requestedIntervalSeconds = $IntervalSeconds; requestedSamples = $Samples; requestedExitTailSamples = $ExitTailSamples; actualSamples = $records.Count
    elapsedMs = $result.durationMs; completedRequestedObservation = ($records.Count -eq $Samples -and $result.rootAliveAtEnd)
    resourceObservation = $result
    contextLimitations = 'Page/account/data-size counts must come from the real operation ledger; no performance threshold is invented.'
    privateConnectionRead = $false; processMemoryContentsRead = $false; productionDataRead = $false
}
$contextPath = Join-Path $TestRoot ([IO.Path]::GetFileNameWithoutExtension($OutputName) + '.context.json')
$file = [IO.File]::Open($contextPath, [IO.FileMode]::CreateNew)
$writer = [IO.StreamWriter]::new($file, [Text.UTF8Encoding]::new($false))
try { $writer.Write(($context | ConvertTo-Json -Depth 7)) } finally { $writer.Dispose() }
$context | ConvertTo-Json -Depth 7 -Compress
