#Requires -Version 5.1
<#
.SYNOPSIS
    WMS Manager Dashboard — Human-in-the-loop approval UI

.DESCRIPTION
    Polls last-state.json + DB for pending manual actions recommended by Ornith.
    Presents a terminal menu for operators to approve/reject WMS decisions.
    Runs continuously; Ctrl+C to exit.

.PARAMETER RefreshSec
    Seconds between auto-refresh (default: 60)

.EXAMPLE
    .\wms-dashboard.ps1 -RefreshSec 30
#>

param(
    [int]$RefreshSec = 60
)

$ErrorActionPreference = 'Continue'
$ProjectRoot  = "C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system"
$StateFile    = "$ProjectRoot\services\worker\last-state.json"
$AuditFile    = "$ProjectRoot\services\worker\wms_manager_audit.jsonl"
$QueryScript  = "$ProjectRoot\services\worker\watchdog-query.js"
$ExecScript   = "$ProjectRoot\services\worker\wms-execute.js"
$ApiBase      = "http://127.0.0.1:8080"

function Write-Log {
    param([string]$Level, [string]$Msg)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts [$Level] $Msg"
}

function Get-PendingActions {
    # Return a hashtable of pending manual actions from the last Ornith analysis
    $pending = @{
        iqc    = @()
        issue  = @()
        pick   = @()
        putaway = @()
        return = @()
        scrap  = @()
        msd    = @()
    }
    if (-not (Test-Path $StateFile)) { return $pending }

    try {
        $state = Get-Content $StateFile -Raw | ConvertFrom-Json
    } catch { return $pending }

    # Last analysis is embedded in state by wms-manager.js
    # But we store separate pending files for items needing approval
    $pendingFile = "$ProjectRoot\services\worker\pending-approvals.json"
    if (Test-Path $pendingFile) {
        try {
            $p = Get-Content $pendingFile -Raw | ConvertFrom-Json
            if ($p.iqc)    { $pending.iqc    = @($p.iqc) }
            if ($p.issue)  { $pending.issue   = @($p.issue) }
            if ($p.pick)   { $pending.pick    = @($p.pick) }
            if ($p.putaway){ $pending.putaway  = @($p.putaway) }
            if ($p.return) { $pending.return   = @($p.return) }
            if ($p.scrap)  { $pending.scrap   = @($p.scrap) }
            if ($p.msd)    { $pending.msd     = @($p.msd) }
        } catch {}
    }
    return $pending
}

function Get-WmsSnapshot {
    try {
        $raw = & node $QueryScript all 2>&1
        if ($LASTEXITCODE -eq 0) { return ($raw | ConvertFrom-Json) }
    } catch {}
    return $null
}

function Show-Dashboard {
    param([object]$Snapshot, [hashtable]$Pending, [string]$LastCycle)

    Clear-Host
    $host.UI.RawUI.WindowTitle = "WMS Manager Dashboard — $(Get-Date -Format 'HH:mm:ss')"

    $border = "=" * 70
    Write-Host ""
    Write-Host "  WMS MANAGER DASHBOARD" -ForegroundColor Cyan
    Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')   |   Auto-refresh: ${RefreshSec}s   |   Last cycle: $LastCycle"
    Write-Host $border
    Write-Host ""

    # ── WMS Summary ──────────────────────────────────────────────────
    $lots = $Snapshot.iqcNg
    $wos  = $Snapshot.workOrders

    $pending = @($lots | Where-Object { $_.iqc_status -eq 'pending' }).Count
    $hold    = @($lots | Where-Object { $_.iqc_status -eq 'hold' }).Count
    $rejected= @($lots | Where-Object { $_.iqc_status -eq 'rejected' }).Count
    $released= @($lots | Where-Object { $_.iqc_status -eq 'released' }).Count

    $running  = @($wos | Where-Object { $_.status -eq 'running' }).Count
    $releasedWo = @($wos | Where-Object { $_.status -eq 'released' }).Count
    $completedWo= @($wos | Where-Object { $_.status -eq 'completed' }).Count

    Write-Host "  [ 库存总览 ]" -ForegroundColor Yellow
    Write-Host "  ─────────────────────────────────────────────────────────"
    Write-Host "  待检 (pending) : $pending".PadRight(40) "│  已检验 released : $released"
    Write-Host "  Hold           : $hold".PadRight(40) "│  工单进行中      : $running"
    Write-Host "  拒绝 (rejected): $rejected".PadRight(40) "│  工单已下达      : $releasedWo"
    Write-Host "  已完成工单     : $completedWo"
    Write-Host ""

    # ── NG Lots ───────────────────────────────────────────────────────
    $ngLots = @($lots | Where-Object { $_.iqc_status -ne 'released' })
    if ($ngLots.Count -gt 0) {
        Write-Host "  [ IQC 异常批次 ]" -ForegroundColor Red
        Write-Host "  ─────────────────────────────────────────────────────────"
        foreach ($l in $ngLots) {
            $color = if ($l.iqc_status -eq 'hold') { 'Yellow' } elseif ($l.iqc_status -eq 'rejected') { 'Red' } else { 'White' }
            $line = "  $($l.lot_no.PadRight(20)) [$($l.iqc_status.ToUpper().PadRight(10))] $($l.material_name_zh)"
            Write-Host $line -ForegroundColor $color
        }
        Write-Host ""
    }

    # ── Pending Approvals ─────────────────────────────────────────────
    $totalPending = $Pending.iqc.Count + $Pending.issue.Count + $Pending.pick.Count +
                    $Pending.putaway.Count + $Pending.return.Count + $Pending.scrap.Count +
                    $Pending.msd.Count

    if ($totalPending -gt 0) {
        Write-Host "  [ 待审批操作 ] ($totalPending 项)" -ForegroundColor Magenta
        Write-Host "  ─────────────────────────────────────────────────────────"

        $idx = 1
        $script:actionMap = @{}

        if ($Pending.iqc.Count -gt 0) {
            foreach ($d in $Pending.iqc) {
                Write-Host "  $idx) [IQC] $($d.lot_no) → $($d.action)" -ForegroundColor Yellow
                $script:actionMap["$idx"] = @{ type = 'iqc'; data = $d; label = "IQC $($d.action) $($d.lot_no)" }
                $idx++
            }
        }
        if ($Pending.issue.Count -gt 0) {
            foreach ($d in $Pending.issue) {
                Write-Host "  $idx) [ISSUE] $($d.lot_no) x$($d.qty) → WO:$($d.work_order_code)" -ForegroundColor Yellow
                $script:actionMap["$idx"] = @{ type = 'issue'; data = $d; label = "ISSUE $($d.lot_no) → WO:$($d.work_order_code)" }
                $idx++
            }
        }
        if ($Pending.pick.Count -gt 0) {
            foreach ($d in $Pending.pick) {
                Write-Host "  $idx) [PICK] $($d.lot_no) x$($d.qty) → WO:$($d.work_order_code)" -ForegroundColor Yellow
                $script:actionMap["$idx"] = @{ type = 'pick'; data = $d; label = "PICK $($d.lot_no) → WO:$($d.work_order_code)" }
                $idx++
            }
        }
        if ($Pending.putaway.Count -gt 0) {
            foreach ($d in $Pending.putaway) {
                Write-Host "  $idx) [PUT_AWAY] $($d.lot_no) → $($d.location)" -ForegroundColor Yellow
                $script:actionMap["$idx"] = @{ type = 'putaway'; data = $d; label = "PUT_AWAY $($d.lot_no) → $($d.location)" }
                $idx++
            }
        }
        if ($Pending.return.Count -gt 0) {
            foreach ($d in $Pending.return) {
                Write-Host "  $idx) [RETURN] $($d.lot_no) x$($d.qty) ← WO:$($d.work_order_code)" -ForegroundColor Yellow
                $script:actionMap["$idx"] = @{ type = 'return'; data = $d; label = "RETURN $($d.lot_no) ← WO:$($d.work_order_code)" }
                $idx++
            }
        }
        if ($Pending.scrap.Count -gt 0) {
            foreach ($d in $Pending.scrap) {
                Write-Host "  $idx) [SCRAP] $($d.lot_no) x$($d.qty)" -ForegroundColor Red
                $script:actionMap["$idx"] = @{ type = 'scrap'; data = $d; label = "SCRAP $($d.lot_no)" }
                $idx++
            }
        }
        if ($Pending.msd.Count -gt 0) {
            foreach ($d in $Pending.msd) {
                Write-Host "  $idx) [MSD] $($d.lot_no) — $($d.action) (暴露$($d.exposed_hours)h)" -ForegroundColor Cyan
                $script:actionMap["$idx"] = @{ type = 'msd'; data = $d; label = "MSD $($d.lot_no) → $($d.action)" }
                $idx++
            }
        }
        Write-Host ""
        Write-Host "  [A] 批准全部  [R] 拒绝全部  [P] 手动输入批次  [S] SOP  [Q] 退出" -ForegroundColor White
        Write-Host ""
        Write-Host $border
    } else {
        Write-Host "  [ 无待审批操作 ]" -ForegroundColor Green
        Write-Host "  所有 Ornith 建议已处理完毕"
        Write-Host ""
        Write-Host "  [R] 手动输入批次   [S] SOP管理   [Q] 退出" -ForegroundColor White
        Write-Host ""
        Write-Host $border
    }
}

function Approve-Action {
    param([hashtable]$Action)

    $type = $Action.type
    $d    = $Action.data

    switch ($type) {
        'iqc' {
            $act = $d.action -replace '^IQC_', ''
            Write-Host "    → 执行 IQC-$act $($d.lot_no) ..." -ForegroundColor Cyan
            $out = & node $ExecScript iqc-decide --lotno $d.lot_no --action $act --reason "OPERATOR_APPROVED" 2>&1
        }
        'issue' {
            Write-Host "    → 执行 ISSUE-TO-LINE $($d.lot_no) ..." -ForegroundColor Cyan
            $out = & node $ExecScript issue-to-line --lotno $d.lot_no --qty $d.qty --wocode $d.work_order_code 2>&1
        }
        'pick' {
            Write-Host "    → 执行 PICK $($d.lot_no) ..." -ForegroundColor Cyan
            $out = & node $ExecScript pick --lotno $d.lot_no --qty $d.qty --wocode $d.work_order_code 2>&1
        }
        'putaway' {
            Write-Host "    → 执行 PUT-AWAY $($d.lot_no) ..." -ForegroundColor Cyan
            $out = & node $ExecScript put-away --lotno $d.lot_no --location $d.location 2>&1
        }
        'return' {
            Write-Host "    → 执行 RETURN-LINE $($d.lot_no) ..." -ForegroundColor Cyan
            $out = & node $ExecScript return-line --lotno $d.lot_no --qty $d.qty --wocode $d.work_order_code --reason $d.reason 2>&1
        }
        'scrap' {
            Write-Host "    → 执行 SCRAP $($d.lot_no) ..." -ForegroundColor Red
            $out = & node $ExecScript scrap --lotno $d.lot_no --qty $d.qty --reason $d.reason 2>&1
        }
        'msd' {
            Write-Host "    → MSD 行动 $($d.action) $($d.lot_no) — 需人工确认烘烤流程" -ForegroundColor Cyan
            $out = "MSD action requires human operator setup"
        }
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "    ✓ 成功" -ForegroundColor Green
        $script:lastResult = "OK"
        # Operator approved Ornith's recommendation → record as "correct" feedback
        if ($d.lot_no -and $type) {
            Send-Feedback -LotNo $d.lot_no -Feedback "correct" -DecisionType $type
        }
    } else {
        Write-Host "    ✗ 失败: $out" -ForegroundColor Red
        $script:lastResult = "FAILED"
    }

    # Audit log
    $auditEntry = @{
        ts      = (Get-Date).ToString("o")
        type    = $type
        action  = $d.lot_no
        result  = $script:lastResult
        output  = $out
        operator= $env:USERNAME
    } | ConvertTo-Json -Compress
    Add-Content -Path $AuditFile -Value $auditEntry -Encoding UTF8
}

# ── Send Ornith feedback to PostgreSQL audit log ───────────────────────
function Send-Feedback {
    param([string]$LotNo, [string]$Feedback, [string]$DecisionType)

    # Map dashboard type to wms-execute decision_type
    $dbType = switch ($DecisionType) {
        'iqc'     { 'iqc' }
        'issue'   { 'issue_to_line' }
        'pick'    { 'pick' }
        'putaway' { 'put_away' }
        'return'  { 'return_to_line' }
        'scrap'   { 'scrap' }
        'msd'    { 'msd' }
        default   { 'iqc' }
    }

    try {
        $out = & node $ExecScript receive-feedback --lotno $LotNo --feedback $Feedback --type $dbType 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    [FEEDBACK recorded: $Feedback]" -ForegroundColor Gray
        }
    } catch {
        Write-Host "    [FEEDBACK failed: $_ ]" -ForegroundColor DarkGray
    }
}

function Reject-Action {
    param([hashtable]$Action)

    $d = $Action.data
    Write-Host "    → 已拒绝: $($Action.label)" -ForegroundColor Yellow

    $auditEntry = @{
        ts       = (Get-Date).ToString("o")
        type     = $Action.type
        action   = $d.lot_no
        result   = "REJECTED"
        operator = $env:USERNAME
    } | ConvertTo-Json -Compress
    Add-Content -Path $AuditFile -Value $auditEntry -Encoding UTF8

    # Operator rejected Ornith's recommendation → record as "incorrect" feedback
    if ($d.lot_no -and $Action.type) {
        Send-Feedback -LotNo $d.lot_no -Feedback "incorrect" -DecisionType $Action.type
    }
}

function Clear-Pending {
    param([string]$Type, [string]$LotNo)

    $pendingFile = "$ProjectRoot\services\worker\pending-approvals.json"
    if (-not (Test-Path $pendingFile)) { return }
    try {
        $p = Get-Content $pendingFile -Raw | ConvertFrom-Json
        $field = switch ($Type) {
            'iqc'     { 'iqc' }
            'issue'   { 'issue' }
            'pick'    { 'pick' }
            'putaway' { 'putaway' }
            'return'  { 'return' }
            'scrap'   { 'scrap' }
            'msd'     { 'msd' }
            default   { $null }
        }
        if ($field -and $p.$field) {
            $p.$field = @($p.$field | Where-Object { $_.lot_no -ne $LotNo })
            $p | ConvertTo-Json -Depth 5 | Set-Content $pendingFile -Encoding UTF8
        }
    } catch {}
}

# ── SOP Management ───────────────────────────────────────────────────────────

function Get-SOPState {
    $out = & node "$ProjectRoot\services\worker\wms-sop-manager.js" state 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    try { return $out | ConvertFrom-Json } catch { return $null }
}

function Get-SOPInfo {
    $sopFile = "$ProjectRoot\services\worker\wms-sop.json"
    if (-not (Test-Path $sopFile)) { return $null }
    try { return Get-Content $sopFile -Raw | ConvertFrom-Json } catch { return $null }
}

function Show-SOPStatus {
    $sop = Get-SOPInfo
    $state = Get-SOPState
    if (-not $sop) { Write-Host "  SOP文件未找到" -ForegroundColor Red; return }

    Clear-Host
    Write-Host ""
    Write-Host "  WMS SOP 管理器  v$($sop.version)" -ForegroundColor Cyan
    Write-Host "  编辑者: $($sop.updatedBy)   更新: $($sop.updatedAt.Substring(0,10))"
    Write-Host "  ─────────────────────────────────────────────────────────"

    if ($state -and -not $state.completed) {
        $cycle = $state.cycleId
        $curStep = $state.currentStepId
        $lot = $state.currentLotNo
        Write-Host "  当前周期: $cycle" -ForegroundColor Yellow
        Write-Host "  执行中: $curStep" -ForegroundColor Yellow
        if ($lot) { Write-Host "  当前批次: $lot" -ForegroundColor Yellow }
    } elseif ($state -and $state.completed) {
        $dt = [DateTime]::Parse($state.startedAt).ToLocalTime()
        Write-Host "  上次完成: $($dt.ToString('HH:mm:ss')) ($($state.cycleId))" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "  步骤列表:" -ForegroundColor White
    $iconMap = @{
        'QUERY' = '[QRY]'; 'SCRIPT' = '[SCR]'; 'LLM' = '[AI]'
        'BRANCH' = '[BR]'; 'EXECUTE' = '[EXE]'; 'EVALUATE' = '[EVAL]'
        'LINE' = '[LIN]'; 'SAVE_STATE' = '[SAV]'; 'PENDING' = '[PEN]'
        'ESCALATION' = '[ESC]'; 'BRANCH_VISION' = '[VIS]'
    }
    $idx = 1
    foreach ($step in $sop.steps) {
        $icon = $iconMap[$step.type] ?? '[---]'
        $disabled = if ($step.disabled) { "[禁用]" } else { "" }
        $current = if ($state.currentStepId -eq $step.id) { " ← 执行中" } else { "" }
        Write-Host "  $($idx.ToString().PadLeft(2)) $icon $($step.nameZh) $($step.id) $disabled$current" -ForegroundColor White
        $idx++
    }

    Write-Host ""
    Write-Host "  [D] 查看Mermaid流程图   [H] 查看历史   [E] 编辑SOP"
    Write-Host "  [R] 运行巡逻周期         [V] 验证SOP"
    Write-Host "  [Q] 返回" -ForegroundColor White
    Write-Host "  ─────────────────────────────────────────────────────────"
    $ch = Read-Host "  选择操作"
    switch ($ch.ToUpper()) {
        'D' { Show-SOPDiagram -SOP $sop -State $state }
        'H' { Show-SOPHistory }
        'E' { Edit-SOP -SOP $sop }
        'R' { Run-SOPCycle }
        'V' { Validate-SOP }
        'Q' { return }
        default { Show-SOPStatus }
    }
}

function Show-SOPDiagram {
    param([object]$SOP, [object]$State)
    Clear-Host
    Write-Host ""
    Write-Host "  WMS SOP 流程图 (Mermaid)" -ForegroundColor Cyan
    Write-Host "  版本: $($SOP.version)   周期: $($State.cycleId ?? '—')" -ForegroundColor Gray
    Write-Host "  ─────────────────────────────────────────────────────────"
    Write-Host "  在 https://mermaid.live 查看以下图表:" -ForegroundColor Yellow
    Write-Host ""
    $out = & node "$ProjectRoot\services\worker\wms-sop-manager.js" render-mermaid 2>&1
    if ($LASTEXITCODE -eq 0) {
        # Print simplified ASCII flow
        $idx = 1
        $stepMap = @{}
        foreach ($s in $SOP.steps) { $stepMap[$s.id] = $s }
        $curId = $State.currentStepId
        $done = @{}
        foreach ($h in $State.history) { $done[$h.stepId] = $h.status }

        # BFS from start
        $visited = @{}
        $queue = @($SOP.startStep)
        while ($queue.Count -gt 0) {
            $id = $queue[0]; $queue = $queue[0..-1]; $queue = @($queue[1..$queue.Length])
            if ($visited[$id] -or -not $stepMap[$id]) { continue }
            $visited[$id] = $true
            $s = $stepMap[$id]
            $icon = $s.mermaid.icon ?? '⬜'
            $isCurrent = ($id -eq $curId)
            $isDone = $done[$id] -eq 'OK'
            $status = if ($isCurrent) { "[执行中]" } elseif ($isDone) { "[OK]" } else { "" }
            $color = if ($isCurrent) { "Yellow" } elseif ($isDone) { "Green" } else { "White" }
            Write-Host "  $icon $($s.nameZh) $status" -ForegroundColor $color
            if ($s.type -eq 'BRANCH') {
                foreach ($b in $s.branches) {
                    if ($b.next -and -not $visited[$b.next]) { $queue += $b.next }
                    $cond = if ($b.condition) { $b.condition.Substring(0, [Math]::Min(25, $b.condition.Length)) } else { "default" }
                    Write-Host "     +-- $cond -> $($b.next)" -ForegroundColor DarkGray
                }
                if ($s.defaultNext -and -not $visited[$s.defaultNext]) { $queue += $s.defaultNext }
            } elseif ($s.next -and -not $visited[$s.next]) {
                $queue += $s.next
            }
        }
        Write-Host ""
        Write-Host "  Raw Mermaid:" -ForegroundColor Gray
        $out -split "`n" | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    } else {
        Write-Host "  渲染失败: $out" -ForegroundColor Red
    }
    Read-Host "  按 Enter 返回"
}

function Show-SOPHistory {
    Clear-Host
    Write-Host ""
    Write-Host "  SOP 执行历史" -ForegroundColor Cyan
    Write-Host "  ─────────────────────────────────────────────────────────"
    $out = & node "$ProjectRoot\services\worker\wms-sop-manager.js" history 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host $out
    } else {
        Write-Host "  无历史记录: $out" -ForegroundColor Gray
    }
    Read-Host "  按 Enter 返回"
}

function Validate-SOP {
    Write-Host ""
    Write-Host "  验证 SOP..." -ForegroundColor Cyan
    $out = & node "$ProjectRoot\services\worker\wms-sop-manager.js" validate 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Host "  $out" -ForegroundColor Green }
    else { Write-Host "  失败: $out" -ForegroundColor Red }
    Read-Host "  按 Enter 返回"
}

function Run-SOPCycle {
    Write-Host ""
    Write-Host "  启动 SOP 巡逻周期..." -ForegroundColor Yellow
    $out = & node "$ProjectRoot\services\worker\wms-sop-manager.js" run 2>&1
    Write-Host $out
    Read-Host "  按 Enter 返回"
}

function Edit-SOP {
    param([object]$SOP)
    Clear-Host
    Write-Host ""
    Write-Host "  编辑 SOP  —  v$($SOP.version)" -ForegroundColor Cyan
    Write-Host "  ─────────────────────────────────────────────────────────"
    Write-Host "  1) 重排步骤顺序     4) 启用/禁用步骤"
    Write-Host "  2) 修改超时时间     5) 查看SOP详情"
    Write-Host "  3) 保存并激活       0) 返回"
    Write-Host "  ─────────────────────────────────────────────────────────"
    $ch = Read-Host "  选择"
    if ($ch -eq '0') { Show-SOPStatus; return }

    if ($ch -eq '1') {
        Write-Host "  当前顺序:" -ForegroundColor White
        for ($i = 0; $i -lt $SOP.steps.Count; $i++) {
            Write-Host "    $($i+1)) $($SOP.steps[$i].id) ($($SOP.steps[$i].nameZh))"
        }
        Write-Host "  格式: 3,6 → 把第3步移到第6位   格式: 3,0 → 删除第3步"
        $move = Read-Host "  输入"
        if ($move -match '^\d+,\d+$') {
            $parts = $move.Split(',')
            $from = [int]$parts[0] - 1
            $to = [int]$parts[1]
            & node "$ProjectRoot\services\worker\wms-sop-manager.js" edit reorder "$($SOP.steps[$from].id),$to" 2>&1
            Write-Host "  预览已更新 (未保存)" -ForegroundColor Yellow
        }
    }
    elseif ($ch -eq '2') {
        Write-Host "  输入 stepId 和超时秒数，格式: step_ornith,180"
        $inp = Read-Host "  "
        if ($inp -match '^[^,]+,\d+$') {
            & node "$ProjectRoot\services\worker\wms-sop-manager.js" edit timeout $inp.Replace(',', ',') 2>&1
        }
    }
    elseif ($ch -eq '3') {
        & node "$ProjectRoot\services\worker\wms-sop-manager.js" edit save 2>&1
        Write-Host "  SOP 已保存并激活" -ForegroundColor Green
        Start-Sleep 2
        return
    }
    elseif ($ch -eq '4') {
        Write-Host "  输入要禁用的 stepId:"
        $id = Read-Host "  "
        & node "$ProjectRoot\services\worker\wms-sop-manager.js" edit toggle $id 2>&1
    }
    Read-Host "  按 Enter 继续编辑"
    $newSOP = Get-SOPInfo
    if ($newSOP) { Edit-SOP -SOP $newSOP }
}

function Manual-LotEntry {
    Write-Host ""
    Write-Host "  手动输入批次操作" -ForegroundColor Cyan
    Write-Host "  ─────────────────────────────────────────────────────────"
    Write-Host "  支持操作: iqc-decide | issue-to-line | pick | put-away | scrap | return-line"
    Write-Host ""

    $lotNo = Read-Host "  批次号 (lot_no)"
    if (-not $lotNo) { return }

    $action = Read-Host "  操作类型"
    if (-not $action) { return }

    Write-Host "  → 执行: $action $lotNo ..." -ForegroundColor Cyan
    $out = & node $ExecScript $action --lotno $lotNo 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ 成功" -ForegroundColor Green
    } else {
        Write-Host "  ✗ 失败: $out" -ForegroundColor Red
    }
    Read-Host "  按 Enter 继续"
}

# ── Main loop ─────────────────────────────────────────────────────────
$script:actionMap = @{}
$script:lastResult = $null

Write-Host ""
Write-Host "  WMS Manager Dashboard 启动中..." -ForegroundColor Cyan
Write-Host "  按 Ctrl+C 退出" -ForegroundColor Gray

$lastStateModified = $null

while ($true) {
    # Reload pending actions
    $pending = Get-PendingActions

    # Check if state file changed
    $curModified = (Get-Item $StateFile -EA SilentlyContinue).LastWriteTime
    $lastCycle = "—"
    if (Test-Path $StateFile) {
        try {
            $s = Get-Content $StateFile -Raw | ConvertFrom-Json
            if ($s.lastCycle) {
                $dt = [DateTime]::Parse($s.lastCycle)
                $lastCycle = $dt.ToString("HH:mm:ss")
            }
        } catch {}
    }

    # Get live WMS snapshot
    $snapshot = Get-WmsSnapshot

    # Show dashboard
    Show-Dashboard -Snapshot $snapshot -Pending $pending -LastCycle $lastCycle

    # Wait for operator input (with auto-refresh)
    Write-Host ""
    Write-Host "  选项 > " -NoNewline
    $key = $null
    if ([Console]::KeyAvailable) {
        $key = [Console]::ReadKey($true).KeyChar
    }

    if ($key -eq 'q' -or $key -eq 'Q') {
        Write-Host "Q"
        Write-Host ""
        Write-Host "  退出 dashboard" -ForegroundColor Cyan
        break
    }
    elseif ($key -eq 'r' -or $key -eq 'R') {
        Write-Host "R"
        Write-Host "  手动输入模式..." -ForegroundColor Yellow
        Manual-LotEntry
    }
    elseif ($key -eq 's' -or $key -eq 'S') {
        Write-Host "S"
        Show-SOPStatus
    }
    elseif ($key -eq 'a' -or $key -eq 'A') {
        Write-Host "A"
        Write-Host "  批准全部待审批项..." -ForegroundColor Yellow
        if ($script:actionMap.Count -eq 0) {
            Write-Host "  无待审批项" -ForegroundColor Gray
            Start-Sleep -Seconds 2
        } else {
            $approved = 0
            foreach ($k in ($script:actionMap.Keys | Sort-Object)) {
                $a = $script:actionMap[$k]
                Approve-Action $a
                Clear-Pending -Type $a.type -LotNo $a.data.lot_no
                $approved++
            }
            Write-Host ""
            Write-Host "  ✓ 已批准 $approved 项" -ForegroundColor Green
            $script:actionMap = @{}
            Start-Sleep -Seconds 3
        }
    }
    elseif ($key -match '^\d+$') {
        $k = $key
        if ($script:actionMap.ContainsKey($k)) {
            $a = $script:actionMap[$k]
            Write-Host "$k"
            Write-Host "  操作: $($a.label)" -ForegroundColor Cyan
            Write-Host "  [Y] 批准  [N] 拒绝  [其他] 跳过" -ForegroundColor White
            Write-Host "  > " -NoNewline
            $confirm = [Console]::ReadKey($true).KeyChar
            Write-Host $confirm
            if ($confirm -eq 'y' -or $confirm -eq 'Y') {
                Approve-Action $a
                Clear-Pending -Type $a.type -LotNo $a.data.lot_no
                $script:actionMap.Remove($k)
            } elseif ($confirm -eq 'n' -or $confirm -eq 'N') {
                Reject-Action $a
                Clear-Pending -Type $a.type -LotNo $a.data.lot_no
                $script:actionMap.Remove($k)
            }
            Read-Host "  按 Enter 继续"
        } else {
            Write-Host "$k — 无效选项" -ForegroundColor Red
            Start-Sleep -Seconds 1
        }
    }
    else {
        # Auto-refresh countdown
        for ($i = $RefreshSec; $i -gt 0; $i -= 5) {
            if ([Console]::KeyAvailable) { break }
            Write-Host "`r  下次刷新: ${i}s  [空格] 立即刷新  [Q] 退出    " -NoNewline
            Start-Sleep -Seconds 5
            if ([Console]::KeyAvailable) { break }
        }
        Write-Host "`r" + (" " * 70) + "`r" -NoNewline
    }
}
