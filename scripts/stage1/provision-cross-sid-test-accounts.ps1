<#
Provision the two temporary, standard Windows users required by Stage 1.7.

Run this script only from an elevated PowerShell window. It never accepts a
password argument, never writes a password to disk/logs, refuses to overwrite
an existing account, and rolls back only accounts created by this invocation
if the second account cannot be created.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$names = @('ZhikeTestA', 'ZhikeTestB')
$created = New-Object System.Collections.Generic.List[string]

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this script from an elevated PowerShell window. No account changes were made.'
    }
}

function Get-ExistingUser([string]$Name) {
    return Get-LocalUser -Name $Name -ErrorAction SilentlyContinue
}

try {
    Assert-Administrator
    foreach ($name in $names) {
        if (Get-ExistingUser $name) {
            throw "Refusing to overwrite existing account '$name'. No account changes were made."
        }
    }

    foreach ($name in $names) {
        $password = Read-Host -AsSecureString -Prompt "Enter a temporary password for $name (not saved or printed)"
        $user = New-LocalUser -Name $name -Password $password -Description 'Zhike 6.1 Stage 1.7 temporary standard IPC test account' -AccountNeverExpires:$true -PasswordNeverExpires:$false -UserMayNotChangePassword:$false
        Add-LocalGroupMember -Group 'Users' -Member $user
        $created.Add($name)
    }

    foreach ($name in $names) {
        $user = Get-LocalUser -Name $name
        $adminMembership = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*\$name" })
        if ($adminMembership.Count -gt 0) {
            throw "Account '$name' unexpectedly belongs to Administrators. Cleanup will remove only accounts created by this run."
        }
        [pscustomobject]@{
            Name = $user.Name
            Enabled = [bool]$user.Enabled
            SID = $user.SID.Value
            AdministratorsMember = $false
        }
    }
    Write-Output 'Created two temporary standard users. Passwords were not stored or printed.'
}
catch {
    foreach ($name in $created) {
        try { Remove-LocalUser -Name $name -Confirm:$false -ErrorAction Stop } catch { Write-Warning "Could not remove account created by this run: $name" }
    }
    throw
}
