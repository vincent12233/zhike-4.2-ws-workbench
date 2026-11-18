<#
Stage 1.6 cross-SID preflight and execution guide.

This script is intentionally non-destructive. It never creates users, resets
passwords, changes local security policy, starts a production Worker, opens a
production database, or connects to WhatsApp. Without an authorized second
Windows credential it reports NotTested; it must not be used to infer a
cross-SID pass from a same-SID run.
#>
[CmdletBinding()]
param(
    [string]$ClientUser,
    [switch]$VerifyCredentialIdentity,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-CurrentSid {
    return [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
}

function Write-Result([hashtable]$Result) {
    $json = $Result | ConvertTo-Json -Depth 6
    if ($OutputPath) {
        $json | Set-Content -LiteralPath $OutputPath -Encoding UTF8
    }
    $json
}

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
    Write-Result @{ status = 'NotTested'; reason = 'Windows is required for Named Pipe ACL validation.' }
    exit 0
}

$currentSid = Get-CurrentSid
$currentName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$accounts = @()
try {
    $accounts = @(Get-LocalUser | ForEach-Object {
        [pscustomobject]@{
            name = $_.Name
            sid = $_.Sid.Value
            enabled = [bool]$_.Enabled
            passwordRequired = [bool]$_.PasswordRequired
        }
    })
} catch {
    $accounts = @()
}

$candidates = @($accounts | Where-Object {
    $_.enabled -and $_.sid -and $_.sid -ne $currentSid
})

$base = [ordered]@{
    status = 'NotTested'
    currentUser = $currentName
    currentSid = ('...' + $currentSid.Substring([Math]::Max(0, $currentSid.Length - 6)))
    candidateAccounts = @($candidates | ForEach-Object {
        [ordered]@{
            name = $_.name
            sid = ('...' + $_.sid.Substring([Math]::Max(0, $_.sid.Length - 6)))
            enabled = $_.enabled
            passwordRequired = $_.passwordRequired
        }
    })
    productionWorkerStarted = $false
    productionDatabaseOpened = $false
    securityPolicyChanged = $false
    accountCreatedOrReset = $false
}

if (-not $ClientUser) {
    $base.reason = 'No authorized second-user credential was supplied; cross-SID pipe and application rejection remain NotTested.'
    $base.nextStep = 'Run again with -ClientUser <existing local account> -VerifyCredentialIdentity after obtaining authorization. Do not create or reset an account for this test.'
    Write-Result $base
    exit 0
}

$selected = $accounts | Where-Object { $_.name -eq $ClientUser } | Select-Object -First 1
if (-not $selected) {
    $base.reason = "ClientUser '$ClientUser' is not an existing local account. The script will not create it."
    Write-Result $base
    exit 0
}
if ($selected.sid -eq $currentSid) {
    $base.reason = 'The selected account has the same SID as the current user; this is not a cross-SID test.'
    Write-Result $base
    exit 0
}

$base.selectedClientUser = $selected.name
$base.selectedClientSid = ('...' + $selected.sid.Substring([Math]::Max(0, $selected.sid.Length - 6)))

if (-not $VerifyCredentialIdentity) {
    $base.reason = 'A different SID was found, but credential identity was not verified. Pass -VerifyCredentialIdentity to run an explicit whoami probe.'
    Write-Result $base
    exit 0
}

$credential = Get-Credential -UserName $selected.name -Message 'Enter the existing test-user credential. It is used only for an identity probe and is not stored.'
$probe = Join-Path $env:TEMP ('zhike-cross-sid-whoami-' + [guid]::NewGuid().ToString('N') + '.txt')
try {
    $process = Start-Process -FilePath "$env:SystemRoot\System32\whoami.exe" -ArgumentList '/user' -Credential $credential -WindowStyle Hidden -RedirectStandardOutput $probe -Wait -PassThru
    $output = Get-Content -LiteralPath $probe -Raw
    $base.credentialProbeExitCode = $process.ExitCode
    $base.credentialProbeMatchedSelectedSid = ($output -match [regex]::Escape($selected.sid))
    if ($base.credentialProbeMatchedSelectedSid) {
        $base.reason = 'Credential identity is verified, but the real Named Pipe host/client ACL test still requires the isolated cross-SID harness and remains NotTested.'
    } else {
        $base.reason = 'Credential probe did not prove the selected SID; cross-SID validation remains NotTested.'
    }
} finally {
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
}

Write-Result $base
exit 0
