param(
    [switch]$Continuous,
    [switch]$Deploy,
    [int]$IntervalSeconds = 30,
    [string]$TargetHost = "100.116.166.118"
)

$ErrorActionPreference = "Stop"
$sourceRoot = $PSScriptRoot
$remote = "wy@$TargetHost"
$remoteRoot = "/home/wy/smt-factory-system"
$archive = Join-Path $env:TEMP "smt-factory-source-sync.tgz"
$webArchive = Join-Path $env:TEMP "smt-factory-web-dist.tgz"

function Invoke-Checked([scriptblock]$Command, [string]$Message) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Message (exit $LASTEXITCODE)" }
}

function Sync-Source {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 155 -> 122 source sync"
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    Push-Location $sourceRoot
    try {
        Invoke-Checked { tar -czf $archive --exclude=.git --exclude=node_modules --exclude=dist --exclude=.vite --exclude=.env --exclude='*.log' apps services packages scripts database app_rules tests package.json package-lock.json vite.config.ts tsconfig.base.json AGENTS.md } "Source archive failed"
    } finally { Pop-Location }
    Invoke-Checked { scp -o BatchMode=yes -o ConnectTimeout=12 $archive "${remote}:/tmp/smt-factory-source-sync.tgz" } "Upload to 122 failed"
    Invoke-Checked { ssh -o BatchMode=yes -o ConnectTimeout=12 $remote "mkdir -p '$remoteRoot' && tar -xzf /tmp/smt-factory-source-sync.tgz -C '$remoteRoot'" } "Source extraction on 122 failed"
    Write-Host "Source synchronized. Production database was not overwritten."
}

function Deploy-Production {
    Push-Location $sourceRoot
    try { Invoke-Checked { npm run build } "Web build failed" } finally { Pop-Location }
    if (Test-Path -LiteralPath $webArchive) { Remove-Item -LiteralPath $webArchive -Force }
    Invoke-Checked { tar -czf $webArchive -C (Join-Path $sourceRoot "apps/web/dist") . } "Web archive failed"
    Invoke-Checked { scp -o BatchMode=yes -o ConnectTimeout=12 $webArchive "${remote}:/tmp/smt-factory-web-dist.tgz" } "Web upload failed"
    Invoke-Checked { ssh -o BatchMode=yes -o ConnectTimeout=12 $remote "docker cp '$remoteRoot/services/api/server.js' smt-api:/app/services/api/server.js && docker restart smt-api && rm -rf /tmp/smt-factory-web-dist && mkdir -p /tmp/smt-factory-web-dist && tar -xzf /tmp/smt-factory-web-dist.tgz -C /tmp/smt-factory-web-dist && docker cp /tmp/smt-factory-web-dist/. smt-web:/usr/share/nginx/html/ && docker restart smt-web" } "Production deployment failed"
    Write-Host "122 production runtime deployed."
}

do {
    try {
        Sync-Source
        if ($Deploy) { Deploy-Production }
    } catch {
        Write-Error $_
        if (-not $Continuous) { exit 1 }
    }
    if ($Continuous) { Start-Sleep -Seconds ([Math]::Max(10, $IntervalSeconds)) }
} while ($Continuous)

