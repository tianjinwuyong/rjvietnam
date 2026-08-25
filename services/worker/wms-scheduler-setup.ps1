# WMS Manager Task Scheduler setup
# schtasks /tr needs an executable path — use .bat (ASCII) calling a .ps1 launcher (UTF-8 BOM).
# The .ps1 is written by the Write tool (bypasses shell encoding).
#
# Run:    powershell -ExecutionPolicy Bypass -File wms-scheduler-setup.ps1
# Delete: powershell -ExecutionPolicy Bypass -File wms-scheduler-setup.ps1 -DeleteOnly

param([switch]$DeleteOnly)

$ErrorActionPreference = 'Continue'
$ProjectRoot = $PSScriptRoot -replace '\\services\\worker$', ''
$wmsMgr = Join-Path $ProjectRoot "services\worker\wms-manager.js"
$nodeExe = (Get-Command node).Source
$tempDir = $env:TEMP

# 8.3 short path for the project (ASCII-safe, avoids Chinese in batch files)
$wmsMgrShort = "$env:USERPROFILE\Desktop\越南工~1\SMT-FA~1\services\WORKER~1\WMS-MA~1.JS"

$tasks = @(
    @{ Name = 'WMS-Manager-Morning'; Desc = 'Morning digest 07:30'; Args = 'morning'; Schedule = 'DAILY'; Start = '07:30'; BatFile = "$tempDir\wms-mgr.bat"; Ps1File = "$tempDir\wms-mgr-morning.ps1" },
    @{ Name = 'WMS-Manager-Evening'; Desc = 'Evening digest 17:00'; Args = 'morning'; Schedule = 'DAILY'; Start = '17:00'; BatFile = "$tempDir\wms-mgr2.bat"; Ps1File = "$tempDir\wms-mgr-evening.ps1" },
    @{ Name = 'WMS-Manager-Patrol';  Desc = 'Patrol every 30min';  Args = 'patrol'; Schedule = 'MINUTE'; Start = '07:00'; Modifier = '30'; BatFile = "$tempDir\wms-mgr3.bat"; Ps1File = "$tempDir\wms-mgr-patrol.ps1" }
)

if ($DeleteOnly) {
    Write-Host "Deleting WMS Manager scheduled tasks..." -ForegroundColor Yellow
    foreach ($t in $tasks) {
        Start-Process schtasks -ArgumentList '/delete','/tn',$t.Name,'/f' -NoNewWindow -Wait | Out-Null
        @($t.BatFile, $t.Ps1File) | ForEach-Object { Remove-Item $_ -Force -EA SilentlyContinue }
        Write-Host "  Deleted $($t.Name)" -ForegroundColor Green
    }
    exit 0
}

Write-Host ""
Write-Host "WMS Manager - Task Scheduler Setup" -ForegroundColor Cyan
Write-Host "WMS Mgr  : $wmsMgr"
Write-Host "Node     : $nodeExe"
Write-Host "Temp dir : $tempDir"
Write-Host ""

# ── Write .ps1 launchers (UTF-8 BOM — the Write tool handles this) ─────
# Note: The actual UTF-8 BOM files are created by the Write tool.
# The ps1Content here is written to Ps1File by PowerShell — we must use OEM encoding
# since that's what cmd.exe uses to read the file when the .bat runs.
# Solution: use [System.Text.Encoding]::UTF8 to write the .ps1, but PowerShell's
# -File parameter auto-detects UTF-8 BOM, so this works.
# However, the real fix is: write via cmd /c type CON, which reads OEM.
# For now: the .ps1 files need UTF-8 BOM to be read correctly by powershell.exe -File
# We'll handle this in the step below by calling the Write tool.

foreach ($t in $tasks) {
    # .bat calls: powershell -ExecutionPolicy Bypass -File "C:\Users\..\wms-mgr-morning.ps1"
    # The .ps1 path is ASCII (TEMP dir), so no encoding issues
    $batContent = "@echo off`r`npowershell -ExecutionPolicy Bypass -File `"$($t.Ps1File)`""
    [System.IO.File]::WriteAllText($t.BatFile, $batContent, [System.Text.Encoding]::ASCII)
    Write-Host "  .bat OK: $($t.BatFile)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "NOTE: Use the Write tool to create the .ps1 launcher files with UTF-8 BOM." -ForegroundColor Yellow
Write-Host "The .ps1 files should contain (with correct UTF-8 encoding):" -ForegroundColor Yellow
Write-Host "  & `"$nodeExe`" `"$wmsMgr`" <args>" -ForegroundColor Gray
Write-Host ""
Write-Host "Example .ps1 content for morning:" -ForegroundColor Cyan
Write-Host "  & `"$nodeExe`" `"$wmsMgr`" morning" -ForegroundColor Gray
Write-Host ""
