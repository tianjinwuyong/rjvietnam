param(
  [string]$Repo = (Get-Location).Path,
  [string]$Target = "fef5c26"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $Repo
if (-not (git cat-file -e "$Target^{commit}" 2>$null)) {
  throw "Rollback target '$Target' is not present in the local repository. Fetch the approved Git remote first."
}
git diff --quiet
if ($LASTEXITCODE -ne 0) { throw "Refusing rollback with tracked working-tree changes. Preserve them before continuing." }
git switch --detach $Target
Write-Output "Rolled back staging checkout to $Target. No production endpoint or database was touched."
