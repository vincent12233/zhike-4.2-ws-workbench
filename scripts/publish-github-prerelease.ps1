#Requires -Version 7.0
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Commit,
  [Parameter(Mandatory)][string]$ArtifactDirectory,
  [ValidatePattern('^v\d+\.\d+\.\d+-rc\.[1-9]\d*$')][string]$Tag = 'v6.1.0-rc.1',
  [string]$NotesPath,
  [switch]$Publish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$DebugPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$slug = 'vincent12233/zhike-4.2-ws-workbench'
$api = "https://api.github.com/repos/$slug"
$work = Join-Path $repo 'work'

function Get-OwnedArtifact([string]$Path, [switch]$Directory) {
  $full = [IO.Path]::GetFullPath($Path, $repo)
  if (!$full.StartsWith($work + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Release inputs must be inside a fresh workspace work/ directory.'
  }
  $item = Get-Item -LiteralPath $full -Force
  if ($item.PSIsContainer -ne $Directory.IsPresent) { throw 'Unexpected release input type.' }
  for ($ancestor = $full; $ancestor -ne $repo; $ancestor = [IO.Path]::GetDirectoryName($ancestor)) {
    $attributes = [IO.File]::GetAttributes($ancestor)
    if ($attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release inputs cannot traverse a reparse point.' }
  }
  return $item
}

$version = (Get-Content -LiteralPath (Join-Path $repo 'resources/app/package.json') -Raw | ConvertFrom-Json).version
if ($Tag -notmatch ('^v' + [regex]::Escape($version) + '-rc\.[1-9]\d*$')) { throw 'Tag does not match the source version.' }

$directory = Get-OwnedArtifact $ArtifactDirectory -Directory
$manifestFile = Get-OwnedArtifact (Join-Path $directory.FullName 'release-output-manifest.json')
$manifest = Get-Content -LiteralPath $manifestFile.FullName -Raw | ConvertFrom-Json
$installerName = "知客-$version-WinUI桌面版.exe"
$assetName = "zhike-$version-win-x64-setup.exe"
if ($manifest.version -ne $version -or $manifest.sourceCommit -cne $Commit -or $manifest.releaseGate -ne 'passed' -or
    $manifest.installer -cne $installerName -or $manifest.releaseAsset -cne $assetName) {
  throw 'Installer manifest does not match the exact gated source commit and artifact names.'
}
$installer = Get-OwnedArtifact (Join-Path $directory.FullName $installerName)
$installerHash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash
if ($installer.Length -le 0 -or $installer.Length -ne $manifest.bytes -or $installerHash -ne $manifest.sha256) {
  throw 'Installer size or SHA-256 does not match the manifest.'
}
$signature = (Get-AuthenticodeSignature -LiteralPath $installer.FullName).Status.ToString()
if (@{ Valid = 'signed-and-verified'; NotSigned = 'unsigned' }[$signature] -ne $manifest.signingStatus) {
  throw 'Installer Authenticode status does not match the manifest.'
}
$assets = @(
  @{ Name = $assetName; Path = $installer.FullName; Bytes = $installer.Length; Hash = $installerHash; ContentType = 'application/octet-stream' },
  @{ Name = $manifestFile.Name; Path = $manifestFile.FullName; Bytes = $manifestFile.Length; Hash = (Get-FileHash -LiteralPath $manifestFile.FullName -Algorithm SHA256).Hash; ContentType = 'application/json' }
)
$notes = if ($NotesPath) {
  [IO.File]::ReadAllText((Get-OwnedArtifact $NotesPath).FullName)
} else {
  $lines = @(git -C $repo show "${Commit}:docs/release/release-notes-$version.md" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'Release notes are missing from the artifact source commit.' }
  $lines -join "`n"
}
if ([string]::IsNullOrWhiteSpace($notes) -or $notes.Length -gt 60000) { throw 'Release notes must be a nonempty Markdown document of at most 60,000 characters.' }
$body = "$notes`n`nSource commit: $Commit`nInstaller SHA-256: $installerHash`nAuthenticode: $signature"

function Assert-OriginTag {
  $refs = @(git -C $repo ls-remote --exit-code origin "refs/tags/$Tag" "refs/tags/$Tag^{}" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'Push the exact candidate tag to origin before running the release preflight.' }
  $entries = @{}
  foreach ($ref in $refs) {
    $hash, $name = $ref -split '\s+', 2
    $entries[$name] = $hash
  }
  $target = $entries["refs/tags/$Tag^{}"] ?? $entries["refs/tags/$Tag"]
  if ($target -cne $Commit) { throw 'The remote candidate tag does not resolve to the artifact source commit.' }
}

function Invoke-ReleaseApi([string]$Step, [string]$Method, [string]$Uri, [hashtable]$Options = @{}) {
  try {
    Invoke-RestMethod -Uri $Uri -Method $Method -Headers $headers -UserAgent 'zhike-prerelease' -TimeoutSec 180 -MaximumRedirection 0 @Options
  } catch {
    $status = $_.Exception.PSObject.Properties['Response']?.Value?.StatusCode
    if ($null -eq $status) { throw "$Step failed without an HTTP status. Review the existing GitHub draft before retrying." }
    throw "$Step failed with HTTP $([int]$status). Review the existing GitHub draft before retrying."
  }
}

$priorPrompt = $env:GIT_TERMINAL_PROMPT
$priorInteraction = $env:GCM_INTERACTIVE
$headers = $null
$credential = $null
try {
  $env:GIT_TERMINAL_PROMPT = '0'
  $env:GCM_INTERACTIVE = 'never'
  $origin = git -C $repo remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0 -or $origin -cne "https://github.com/$slug.git") { throw 'Unexpected origin URL.' }
  Assert-OriginTag

  $credential = @("protocol=https", "host=github.com", "path=$slug.git", "") | git -C $repo credential fill 2>$null
  $code = $LASTEXITCODE
  $secret = $credential | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
  if ($code -ne 0 -or !$secret -or $secret.Length -le 9) { throw 'No noninteractive Git Credential Manager credential is available for origin.' }
  $headers = @{
    Authorization = 'Bearer ' + $secret.Substring(9)
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
  }
  $credential = $null
  $secret = $null
  $remote = Invoke-ReleaseApi 'Repository access check' 'GET' $api
  if ($remote.full_name -cne $slug -or !$remote.private -or !$remote.permissions.push) { throw 'Expected a private origin repository with push permission.' }

  $releasesUrl = "$api/releases"
  for ($page = 1; $page -le 100; $page++) {
    $listing = Invoke-ReleaseApi 'Check for an existing tag release' 'GET' ("${releasesUrl}?per_page=100&page=$page")
    $releases = @($listing | Where-Object { $null -ne $_ })
    if ($releases | Where-Object { $_.tag_name -ceq $Tag }) { throw 'A release or draft already exists for this tag. Existing releases are never overwritten.' }
    if ($releases.Count -lt 100) { break }
    if ($page -eq 100) { throw 'The release listing safety limit was reached.' }
  }
  if (!$Publish) {
    [pscustomobject]@{ preflight = 'passed'; tag = $Tag; commit = $Commit; assets = @($assets.Name); signature = $signature; remoteWrites = $false }
    return
  }

  $draftPayload = @{
    tag_name = $Tag; target_commitish = $Commit; name = "知客 $Tag"
    body = $body; draft = $true; prerelease = $true; make_latest = 'false'
  } | ConvertTo-Json -Compress
  $draft = Invoke-ReleaseApi 'Create prerelease draft' 'POST' $releasesUrl @{ ContentType = 'application/json; charset=utf-8'; Body = $draftPayload }
  $releaseId = [long]$draft.id
  if ($releaseId -le 0 -or !$draft.draft -or !$draft.prerelease -or $draft.tag_name -cne $Tag) {
    throw 'GitHub did not return the expected prerelease draft.'
  }
  $uploadBase = "https://uploads.github.com/repos/$slug/releases/$releaseId/assets"
  if ($draft.upload_url -cne "$uploadBase{?name,label}") { throw 'Unexpected GitHub asset upload endpoint.' }
  foreach ($asset in $assets) {
    $uri = "${uploadBase}?name=$([Uri]::EscapeDataString($asset.Name))"
    $uploaded = Invoke-ReleaseApi "Upload $($asset.Name)" 'POST' $uri @{ InFile = $asset.Path; ContentType = $asset.ContentType }
    if ($uploaded.name -cne $asset.Name -or $uploaded.state -ne 'uploaded' -or $uploaded.size -ne $asset.Bytes -or
        $uploaded.digest -ne ('sha256:' + $asset.Hash)) { throw "GitHub asset integrity verification failed for $($asset.Name). Draft retained." }
  }

  Assert-OriginTag
  $releaseUrl = "$releasesUrl/$releaseId"
  $release = Invoke-ReleaseApi 'Publish verified prerelease' 'PATCH' $releaseUrl @{
    ContentType = 'application/json; charset=utf-8'
    Body = '{"draft":false,"prerelease":true,"make_latest":"false"}'
  }
  if ($release.draft -or !$release.prerelease -or $release.tag_name -cne $Tag) { throw 'Unexpected GitHub release status. Review the remote release.' }
  [pscustomobject]@{ prerelease = $true; tag = $Tag; commit = $Commit; url = $release.html_url; assets = @($assets.Name) }
} finally {
  if ($headers) { $headers.Clear() }
  $credential = $null
  $secret = $null
  $env:GIT_TERMINAL_PROMPT = $priorPrompt
  $env:GCM_INTERACTIVE = $priorInteraction
}
