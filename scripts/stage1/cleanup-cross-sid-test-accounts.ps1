<#
Delete only the two Stage 1.7 accounts after an explicit SID manifest check.

Run elevated. The manifest is generated from the accounts verified during this
test. If a name, SID, or running process does not match the expected scope,
the script stops without deleting anything.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this cleanup from an elevated PowerShell window. No accounts were changed.'
    }
}

Assert-Administrator
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Manifest not found: $ManifestPath. No accounts were changed."
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($manifest.accounts.Count -ne 2) { throw 'Manifest must contain exactly two accounts.' }
$targets = @($manifest.accounts)
$names = @($targets | ForEach-Object { $_.name })
if ((@('ZhikeTestA', 'ZhikeTestB') | Where-Object { $names -notcontains $_ }).Count -gt 0) {
    throw 'Manifest names are not exactly ZhikeTestA and ZhikeTestB. No accounts were changed.'
}

$resolved = foreach ($target in $targets) {
    $user = Get-LocalUser -Name $target.name -ErrorAction SilentlyContinue
    if (-not $user) { throw "Expected account is missing: $($target.name). No accounts were changed." }
    if ($user.SID.Value -ne $target.sid) { throw "SID mismatch for $($target.name). No accounts were changed." }
    [pscustomobject]@{ Name = $user.Name; Sid = $user.SID.Value }
}

$running = @()
foreach ($process in Get-CimInstance Win32_Process) {
    try {
        $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction Stop
        $target = $resolved | Where-Object { $_.Name -eq $owner.User }
        if ($target) { $running += [pscustomobject]@{ ProcessId = $process.ProcessId; Name = $process.Name; User = $owner.User } }
    } catch { }
}
if ($running.Count -gt 0) {
    $running | Format-Table -AutoSize | Out-String | Write-Error
    throw 'A target user still owns a running process. Stop it and rerun; no accounts were changed.'
}

foreach ($target in $resolved) {
    Remove-LocalUser -Name $target.Name -Confirm:$false
}

foreach ($target in $resolved) {
    if (Get-LocalUser -Name $target.Name -ErrorAction SilentlyContinue) {
        throw "Cleanup verification failed for $($target.Name)."
    }
}
Write-Output 'Removed exactly the two manifest-matched Stage 1.7 accounts.'
