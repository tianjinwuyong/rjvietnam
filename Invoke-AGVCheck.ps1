# Invoke-AGVCheck.ps1 - AGV fleet health check
param(
    [string]$LineTokenFile = 'services/worker/line_token.txt'
)

$ErrorActionPreference = 'Continue'
$PROJECT_ROOT = 'C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system'

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
    Write-Host '[Invoke-AGVCheck] ERROR: node not found'
    exit 1
}

$QUERY_SCRIPT = Join-Path $PROJECT_ROOT 'services\worker\mes-query.js'
if (-not (Test-Path $QUERY_SCRIPT)) {
    Write-Host '[Invoke-AGVCheck] ERROR: mes-query.js not found'
    exit 1
}

function Get-MesQuery($scope) {
    $raw = & $nodeExe $QUERY_SCRIPT $scope 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    try { return $raw | ConvertFrom-Json } catch { return $null }
}

$fleet = Get-MesQuery 'agv-fleet'
$tasks = Get-MesQuery 'agv-tasks'
$kpi   = Get-MesQuery 'agv-kpi'

$alerts = @()

if ($fleet) {
    $s = $fleet.summary
    Write-Host '=== AGV Fleet ==='
    Write-Host ('总计:' + $s.total + ' 空闲:' + $s.idle + ' 作业:' + $s.busy + ' 充电:' + $s.charging + ' 维护:' + $s.maintenance + ' 离线:' + $s.offline)
    if ($s.low_battery -gt 0) {
        $lowBatt = $fleet.fleet | Where-Object { $_.battery_pct -le $_.low_battery_threshold }
        foreach ($agv in $lowBatt) {
            $alerts += ('[AGV低电量] ' + $agv.code + ' ' + $agv.battery_pct + '%%')
        }
    }
    if ($s.offline -gt 0) {
        $offline = $fleet.fleet | Where-Object { $_.status -eq 'offline' }
        foreach ($agv in $offline) {
            $alerts += ('[AGV离线] ' + $agv.code)
        }
    }
}

if ($tasks) {
    $s = $tasks.summary
    Write-Host '=== AGV Tasks ==='
    Write-Host ('待派:' + $s.pending + ' 执行中:' + $s.in_progress + ' 完成:' + $s.completed + ' 失败:' + $s.failed)
    $failed = $tasks.tasks | Where-Object { $_.status -eq 'failed' }
    foreach ($t in $failed) {
        $alerts += ('[AGV任务失败] ' + $t.task_code)
    }
}

if ($kpi -and $kpi.task_kpi) {
    Write-Host '=== AGV KPI ==='
    Write-Host ('完成率:' + $kpi.task_kpi.completion_rate + '%%')
}

if ($alerts.Count -gt 0) {
    foreach ($a in $alerts) { Write-Host  }
    if (Test-Path $LineTokenFile) {
        $token = (Get-Content $LineTokenFile -Raw).Trim()
        if ($token) {
            $body = $alerts -join '
'
            $msgText = '[AGV Check]' + '
' + $body
            try {
                Invoke-RestMethod -Uri 'https://notify-api.line.me/api/notify' -Method Post -Headers @{ Authorization = 'Bearer ' + $token } -ContentType 'application/x-www-form-urlencoded' -Body @{ message = $msgText } | Out-Null
                Write-Host '[LINE] Alert sent'
            } catch { Write-Host '[LINE] Failed' }
        }
    }
}

Write-Host ('Alerts: ' + $alerts.Count)
exit 0
