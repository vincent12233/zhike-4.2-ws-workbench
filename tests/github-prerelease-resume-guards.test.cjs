'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const publishPath = path.join(repo, 'scripts', 'publish-github-prerelease.ps1');
const guardsPath = path.join(repo, 'scripts', 'publish-github-prerelease-guards.ps1');
const publish = fs.readFileSync(publishPath, 'utf8');
const guards = fs.readFileSync(guardsPath, 'utf8');

assert.match(publish, /\[long\]\$ResumeDraftId\s*=\s*0/);
assert.match(publish, /\[ValidateSet\(180, 600\)\]\[int\]\$UploadTimeoutSeconds\s*=\s*180/);
assert.match(publish, /\$Tag\s*=\s*'v6\.1\.0-rc\.2'/);
assert.match(publish, /publish-github-prerelease-guards\.ps1/);
assert.match(publish, /mode\s*=\s*'resume'/);
assert.match(publish, /remoteWrites\s*=\s*\$false/);
assert.match(publish, /Revalidate prerelease draft before publish/);
assert.match(publish, /Existing releases are never overwritten without an explicit exact draft id/);
assert.doesNotMatch(publish, /Invoke-ReleaseApi[^\r\n]*['"]DELETE['"]/i);
assert.doesNotMatch(guards, /Invoke-RestMethod|Invoke-WebRequest|\bgit\b/i,
  'resume guards must remain pure and make no network or repository calls');
const customTimeoutCalls = publish.match(/Invoke-ReleaseApi[^\r\n]*\$UploadTimeoutSeconds/g) || [];
assert.equal(customTimeoutCalls.length, 1, 'only one API call may opt into the upload timeout');
assert.match(customTimeoutCalls[0], /"Upload \$\(\$asset\.Name\)"\s+'POST'/,
  'only the release asset upload may use the extended timeout');
assert.match(publish, /function Invoke-ReleaseApi\([^\r\n]+\[int\]\$TimeoutSeconds\s*=\s*180\)/,
  'all non-upload API calls retain the 180-second default');

const ps = `
$ErrorActionPreference = 'Stop'
. '${guardsPath.replaceAll("'", "''")}'

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -cne $Expected) { throw "$Message (actual=$Actual expected=$Expected)" }
}
function Expect-Rejected([scriptblock]$Action, [string]$Pattern) {
  try { & $Action; throw "Expected rejection matching $Pattern" }
  catch {
    if ($_.Exception.Message -like 'Expected rejection matching*') { throw }
    if ($_.Exception.Message -notmatch $Pattern) { throw "Unexpected rejection: $($_.Exception.Message)" }
  }
}

$id = 451004886L
$tag = 'v6.1.0-rc.2'
$commit = '5a7dabe7321f7682b2cb518aeb9d4a1c2c89ace1'
$name = '知客 v6.1.0-rc.2'
$installerHash = ('a' * 64)
$manifestHash = ('b' * 64)
$body = @"
candidate notes

Source commit: $commit
Installer SHA-256: $installerHash
Authenticode: NotSigned
"@
$uploadUrl = "https://uploads.github.com/repos/example/private/releases/$id/assets{?name,label}"
function New-Draft([hashtable]$Changes = @{}) {
  $value = [ordered]@{ id=$id; draft=$true; prerelease=$true; tag_name=$tag; target_commitish=$commit; name=$name; body=$body; upload_url=$uploadUrl }
  foreach ($key in $Changes.Keys) { $value[$key] = $Changes[$key] }
  [pscustomobject]$value
}
function Check-Draft($Draft) {
  Assert-ExactPrereleaseDraft -Draft $Draft -ExpectedId $id -ExpectedTag $tag -ExpectedCommit $commit -ExpectedName $name -ExpectedBody $body -ExpectedUploadUrl $uploadUrl
}

Check-Draft (New-Draft)
Expect-Rejected { Check-Draft (New-Draft @{id=$id+1}) } 'id'
Expect-Rejected { Check-Draft (New-Draft @{draft=$false}) } 'unpublished prerelease draft'
Expect-Rejected { Check-Draft (New-Draft @{prerelease=$false}) } 'unpublished prerelease draft'
Expect-Rejected { Check-Draft (New-Draft @{tag_name='v6.1.0-rc.3'}) } 'tag'
Expect-Rejected { Check-Draft (New-Draft @{target_commitish=('c' * 40)}) } 'target'
Expect-Rejected { Check-Draft (New-Draft @{name='changed'}) } 'name'
Expect-Rejected { Check-Draft (New-Draft @{body=$body.Replace($commit, ('d' * 40))}) } 'body'
Expect-Rejected { Check-Draft (New-Draft @{body=$body.Replace($installerHash, ('e' * 64))}) } 'body'
Expect-Rejected { Check-Draft (New-Draft @{body=$body.Replace('NotSigned', 'Valid')}) } 'body'
Expect-Rejected { Check-Draft (New-Draft @{upload_url='https://invalid.example/assets'}) } 'upload endpoint'

$expected = @(
  [pscustomobject]@{Name='zhike-6.1.0-win-x64-setup.exe';Bytes=114280989L;Hash=$installerHash},
  [pscustomobject]@{Name='release-output-manifest.json';Bytes=512L;Hash=$manifestHash}
)
function Existing($Name, $Size, $Digest, $State='uploaded') { [pscustomobject]@{name=$Name;size=$Size;digest=$Digest;state=$State} }
$none = @(Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @())
Assert-Equal (($none.Action -join ',')) 'upload,upload' 'empty draft must upload both expected assets'
$oneRemote = Existing $expected[0].Name $expected[0].Bytes ('sha256:' + $installerHash.ToUpperInvariant())
$one = @(Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @($oneRemote))
Assert-Equal (($one.Action -join ',')) 'skip,upload' 'an exact completed asset is skipped and the missing asset is uploaded'
$twoRemote = Existing $expected[1].Name $expected[1].Bytes ('sha256:' + $manifestHash)
$complete = @(Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @($oneRemote, $twoRemote))
Assert-Equal (($complete.Action -join ',')) 'skip,skip' 'an exact complete draft skips both assets'
Expect-Rejected { Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @((Existing 'unknown.bin' 1 ('sha256:' + ('f' * 64)))) } 'unknown asset'
Expect-Rejected { Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @((Existing $expected[0].Name.ToUpperInvariant() $expected[0].Bytes ('sha256:' + $installerHash))) } 'unknown asset'
Expect-Rejected { Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @($oneRemote, $oneRemote) } 'duplicate assets'
Expect-Rejected { Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @((Existing $expected[0].Name ($expected[0].Bytes - 1) ('sha256:' + $installerHash))) } 'does not exactly match'
Expect-Rejected { Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @((Existing $expected[0].Name $expected[0].Bytes ('sha256:' + $installerHash) 'starter')) } 'does not exactly match'
Expect-Rejected { Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @((Existing $expected[0].Name $expected[0].Bytes ('sha256:' + ('f' * 64)))) } 'does not exactly match'
Expect-Rejected { Get-ExactReleaseAssetPlan -ExpectedAssets $expected -ExistingAssets @([pscustomobject]@{name=$expected[0].Name;size=$expected[0].Bytes;state='uploaded'}) } 'missing digest'

[pscustomobject]@{ok=$true;draftRejectCases=10;assetRejectCases=7;network=$false} | ConvertTo-Json -Compress
`;
const encoded = Buffer.from(ps, 'utf16le').toString('base64');
const result = childProcess.spawnSync(process.env.ZHIKE_TEST_PWSH || 'pwsh', [
  '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 30000 });
assert.equal(result.status, 0, `PowerShell resume guard fixture failed:\n${result.stdout}\n${result.stderr}`);
const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
const evidence = JSON.parse(line);
assert.deepEqual(evidence, { ok: true, draftRejectCases: 10, assetRejectCases: 7, network: false });

console.log('GitHub prerelease resume guards: exact draft, safe asset recovery and upload-only timeout pass');
