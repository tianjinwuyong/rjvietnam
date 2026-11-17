# Invoke-AGVDigest.ps1 - Morning AGV digest
param(
    [string]$LineTokenFile = 'services/worker/line_token.txt'
)

$ErrorActionPreference = 'Continue'
$PROJECT_ROOT = 'C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system'

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { Write-Host 'node not found'; exit 1 }

$QUERY = Join-Path $PROJECT_ROOT 'services\worker\mes-query.js'

function Get-MesQuery($scope) {
    $raw = & $nodeExe $QUERY $scope 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    try { return $raw | ConvertFrom-Json } catch { return $null }
}

$fleet = Get-MesQuery 'agv-fleet'
$tasks = Get-MesQuery 'agv-tasks'
$kpi   = Get-MesQuery 'agv-kpi'

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm'
$lines = @()

$lines += '=========================================='
$lines += '  AGV 车队晨间简报  ' + $ts
$lines += '=========================================='

if ($fleet) {
    $s = $fleet.summary
    $lines += ''
    $lines += '【车队状态】'
    $lines += ('  总计:' + $s.total + ' 空闲:' + $s.idle + ' 作业:' + $s.busy + ' 充电:' + $s.charging + ' 维护:' + $s.maintenance + ' 离线:' + $s.offline)
    $lines += ('  潜伏式:' + $s.shuttle_count + ' 叉式:' + $s.forklift_count)
    $lowBatt = $fleet.fleet | Where-Object { $_.battery_pct -le $_.low_battery_threshold }
    if ($lowBatt) {
        $lines += ''
        $lines += '  低电量:'
        foreach ($agv in $lowBatt) {
            $lines += ('    ' + $agv.code + ' ' + $agv.battery_pct + '%%')
        }
    }
}

if ($tasks) {
    $s = $tasks.summary
    $lines += ''
    $lines += '【任务队列】'
    $lines += ('  待派:' + $s.pending + ' 执行中:' + $s.in_progress + ' 完成:' + $s.completed + ' 失败:' + $s.failed)
    $inProg = $tasks.tasks | Where-Object { $_.status -eq 'in_progress' }
    if ($inProg) {
        $lines += '  当前作业:'
        foreach ($t in $inProg) {
            $lines += ('    ' + $t.task_code + ' ' + $t.task_type + ' ' + $t.agv_code)
        }
    }
}

if ($kpi -and $kpi.task_kpi) {
    $lines += ''
    $lines += '【30日KPI】'
    $lines += ('  完成率:' + $kpi.task_kpi.completion_rate + '%%  完成:' + $kpi.task_kpi.total_completed + ' 失败:' + $kpi.task_kpi.total_failed)
}

$lines += '=========================================='

$report = $lines -join '
'
Write-Host $report

if (Test-Path $LineTokenFile) {
    $token = (Get-Content $LineTokenFile -Raw).Trim()
    if ($token) {
        try {
            Invoke-RestMethod -Uri 'https://notify-api.line.me/api/notify' -Method Post -Headers @{ Authorization = 'Bearer ' + $token } -ContentType 'application/x-www-form-urlencoded' -Body @{ message = $report } | Out-Null
            Write-Host '[LINE] Digest sent'
        } catch { Write-Host '[LINE] Failed' }
    }
}

exit 0
