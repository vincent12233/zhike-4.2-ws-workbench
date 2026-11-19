#requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Execute the production discovery statements, stopping before any build or
# executable invocation. Get-Command is the only mocked command; Test-Path,
# path normalization and PowerShell pipeline/cardinality behavior remain real.
$sourcePath = Join-Path $PSScriptRoot '..\scripts\build-winui-bundle.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "Bundle script has parse errors: $($parseErrors.Message -join '; ')" }
$statements = @($ast.EndBlock.Statements)
$first = @($statements | Where-Object {
  $_ -is [Management.Automation.Language.AssignmentStatementAst] -and
  $_.Left.Extent.Text.Trim().EndsWith('$dotnetCandidates', [StringComparison]::Ordinal)
})
$last = @($statements | Where-Object {
  $_ -is [Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text.Trim() -eq '$dotnet'
})
if ($first.Count -ne 1 -or $last.Count -ne 1 -or $last[0].Extent.StartOffset -le $first[0].Extent.StartOffset) {
  throw 'Cannot identify the production dotnet discovery block.'
}
$blockStatements = @($statements | Where-Object {
  $_.Extent.StartOffset -ge $first[0].Extent.StartOffset -and $_.Extent.EndOffset -le $last[0].Extent.EndOffset
})
if ($blockStatements.Count -ne 3 -or $blockStatements[1] -isnot [Management.Automation.Language.IfStatementAst]) {
  throw 'SDK discovery boundaries changed; review the extraction before executing it.'
}
$source = [IO.File]::ReadAllText($sourcePath)
$discovery = [scriptblock]::Create($source.Substring($first[0].Extent.StartOffset,
  $last[0].Extent.EndOffset - $first[0].Extent.StartOffset) + "`nreturn `$dotnet")
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('zhike sdk discovery ' + [Guid]::NewGuid().ToString('N'))

function Invoke-Discovery([string]$Fixture, [AllowNull()][string]$PathSdk) {
  $repo = $Fixture
  $fixturePathSdk = $PathSdk
  function Get-Command {
    [CmdletBinding()]
    param([Parameter(Position = 0)][string]$Name)
    if ($Name -ne 'dotnet') { throw "Unexpected command discovery: $Name" }
    if ($fixturePathSdk) { [pscustomobject]@{ Source = $fixturePathSdk } }
  }
  & $discovery
}
function Assert-SelectedPath([string]$Name, [object]$Actual, [string]$Expected) {
  if ($Actual -isnot [string] -or $Actual -cne [IO.Path]::GetFullPath($Expected)) {
    throw "$Name selected '$Actual'; expected the complete SDK path '$Expected'."
  }
  Write-Output "PASS $Name"
}

try {
  $pathOnly = Join-Path $fixtureRoot 'path only'
  $both = Join-Path $fixtureRoot 'repository and path'
  $missing = Join-Path $fixtureRoot 'no sdk'
  $pathSdk = Join-Path $fixtureRoot 'path sdk\dotnet.exe'
  $repositorySdk = Join-Path $both '.tools\dotnet10\dotnet.exe'
  foreach ($directory in @($pathOnly, $missing, [IO.Path]::GetDirectoryName($pathSdk), [IO.Path]::GetDirectoryName($repositorySdk))) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  # Plain text placeholders are inspected only and can never be executed by
  # this extraction. A single PATH candidate previously became its first char.
  Set-Content -LiteralPath $pathSdk -Value 'Fixture PATH SDK; never execute.'
  Set-Content -LiteralPath $repositorySdk -Value 'Fixture repository SDK; never execute.'
  Assert-SelectedPath 'PATH-only SDK remains a full path' (Invoke-Discovery $pathOnly $pathSdk) $pathSdk
  Assert-SelectedPath 'Repository SDK takes priority over PATH' (Invoke-Discovery $both $pathSdk) $repositorySdk
  $missingError = $null
  try { $null = Invoke-Discovery $missing $null } catch { $missingError = $_.Exception.Message }
  if ($missingError -cne 'dotnet SDK was not found; install .NET 10 SDK before building WinUI.') {
    throw "Missing SDK did not produce the actionable production error: $missingError"
  }
  Write-Output 'PASS Missing SDK fails with an explicit installation instruction'
  Write-Output 'Passed 3 production SDK discovery regressions.'
} finally {
  if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}
