#Requires -Version 7.0
Set-StrictMode -Version Latest

function Get-RequiredReleaseProperty {
  param(
    [Parameter(Mandatory)][object]$InputObject,
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Context
  )
  if ($InputObject -is [Collections.IDictionary]) {
    if (!$InputObject.Contains($Name)) { throw "$Context is missing $Name." }
    return $InputObject[$Name]
  }
  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property) { throw "$Context is missing $Name." }
  return $property.Value
}

function Assert-ExactPrereleaseDraft {
  param(
    [Parameter(Mandatory)][object]$Draft,
    [Parameter(Mandatory)][long]$ExpectedId,
    [Parameter(Mandatory)][string]$ExpectedTag,
    [Parameter(Mandatory)][string]$ExpectedCommit,
    [Parameter(Mandatory)][string]$ExpectedName,
    [Parameter(Mandatory)][string]$ExpectedBody,
    [Parameter(Mandatory)][string]$ExpectedUploadUrl
  )
  $actualId = 0L
  if (![long]::TryParse([string](Get-RequiredReleaseProperty $Draft 'id' 'Prerelease draft'), [ref]$actualId) -or $actualId -ne $ExpectedId) {
    throw 'Prerelease draft id does not match the explicitly approved draft.'
  }
  $draftState = Get-RequiredReleaseProperty $Draft 'draft' 'Prerelease draft'
  $prereleaseState = Get-RequiredReleaseProperty $Draft 'prerelease' 'Prerelease draft'
  if ($draftState -isnot [bool] -or !$draftState -or $prereleaseState -isnot [bool] -or !$prereleaseState) {
    throw 'The explicitly approved release is not an unpublished prerelease draft.'
  }
  if ([string](Get-RequiredReleaseProperty $Draft 'tag_name' 'Prerelease draft') -cne $ExpectedTag) {
    throw 'Prerelease draft tag does not match the candidate tag.'
  }
  if ([string](Get-RequiredReleaseProperty $Draft 'target_commitish' 'Prerelease draft') -cne $ExpectedCommit) {
    throw 'Prerelease draft target does not match the gated source commit.'
  }
  if ([string](Get-RequiredReleaseProperty $Draft 'name' 'Prerelease draft') -cne $ExpectedName) {
    throw 'Prerelease draft name does not match the candidate name.'
  }
  if ([string](Get-RequiredReleaseProperty $Draft 'body' 'Prerelease draft') -cne $ExpectedBody) {
    throw 'Prerelease draft body does not exactly match the source, installer hash and signature evidence.'
  }
  if ([string](Get-RequiredReleaseProperty $Draft 'upload_url' 'Prerelease draft') -cne $ExpectedUploadUrl) {
    throw 'Prerelease draft returned an unexpected asset upload endpoint.'
  }
}

function Get-ExactReleaseAssetPlan {
  param(
    [Parameter(Mandatory)][object[]]$ExpectedAssets,
    [AllowEmptyCollection()][object[]]$ExistingAssets = @()
  )
  $expectedByName = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
  foreach ($asset in @($ExpectedAssets)) {
    $name = [string](Get-RequiredReleaseProperty $asset 'Name' 'Expected asset')
    $hash = [string](Get-RequiredReleaseProperty $asset 'Hash' "Expected asset $name")
    $bytes = 0L
    if ([string]::IsNullOrWhiteSpace($name) -or $expectedByName.ContainsKey($name)) { throw 'Expected release asset names must be nonempty and unique.' }
    if (![long]::TryParse([string](Get-RequiredReleaseProperty $asset 'Bytes' "Expected asset $name"), [ref]$bytes) -or $bytes -le 0) {
      throw "Expected release asset size is invalid for $name."
    }
    if ($hash -notmatch '^[0-9a-fA-F]{64}$') { throw "Expected release asset SHA-256 is invalid for $name." }
    $expectedByName[$name] = [pscustomobject]@{
      Asset = $asset
      Name = $name
      Bytes = $bytes
      Digest = 'sha256:' + $hash.ToLowerInvariant()
    }
  }
  if ($expectedByName.Count -eq 0) { throw 'At least one expected release asset is required.' }

  $existingByName = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
  foreach ($remoteAsset in @($ExistingAssets)) {
    if ($null -eq $remoteAsset) { throw 'The prerelease draft contains an unreadable asset entry.' }
    $name = [string](Get-RequiredReleaseProperty $remoteAsset 'name' 'Existing release asset')
    if (!$expectedByName.ContainsKey($name)) { throw "The prerelease draft contains an unknown asset: $name. Assets are never deleted or overwritten." }
    if ($existingByName.ContainsKey($name)) { throw "The prerelease draft contains duplicate assets named $name." }
    $state = [string](Get-RequiredReleaseProperty $remoteAsset 'state' "Existing release asset $name")
    $size = 0L
    if (![long]::TryParse([string](Get-RequiredReleaseProperty $remoteAsset 'size' "Existing release asset $name"), [ref]$size)) {
      throw "Existing release asset size is invalid for $name."
    }
    $digest = [string](Get-RequiredReleaseProperty $remoteAsset 'digest' "Existing release asset $name")
    $expected = $expectedByName[$name]
    if ($state -cne 'uploaded' -or $size -ne $expected.Bytes -or $digest -notmatch '^sha256:[0-9a-fA-F]{64}$' -or
        $digest.ToLowerInvariant() -cne $expected.Digest) {
      throw "Existing release asset does not exactly match name, size, uploaded state and SHA-256 digest: $name. Assets are never deleted or overwritten."
    }
    $existingByName[$name] = $remoteAsset
  }

  foreach ($asset in @($ExpectedAssets)) {
    $name = [string](Get-RequiredReleaseProperty $asset 'Name' 'Expected asset')
    [pscustomobject]@{
      Name = $name
      Action = if ($existingByName.ContainsKey($name)) { 'skip' } else { 'upload' }
      Asset = $asset
    }
  }
}
