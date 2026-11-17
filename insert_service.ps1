# Read all lines
$lines = Get-Content 'apps/web/src/agents/agentData.ts' -Encoding UTF8

# Find line index of "MES 产线层"
$idx = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line.IndexOf('MES') -ge 0 -and $line.IndexOf('产线层') -ge 0) {
        $idx = $i
        Write-Host "Found at line $($i+1): $line"
        break
    }
}

if ($idx -eq -1) {
    Write-Host "ERROR: MES 产线层 not found"
    exit 1
}

# New service director entry
$serviceEntry = @"

  // ── 客服服务层 ─────────────────────────────────────────────
  {
    id: "dir-service-001",
    name_zh: "客服虚拟主管",
    name_en: "Service Virtual Manager",
    name_vi: "Quản lý dịch vụ khách hàng ảo",
    gender: "female",
    role: "service-coordinator",
    level: 2,
    domain: "service",
    parentId: "ceo-001",
    childIds: ["service-agent-adrian", "service-agent-derek", "service-agent-ryan", "service-agent-bella", "service-agent-chloe", "service-agent-emily"],
    responsibilities_zh: "管理客服团队日常运作，监督服务质量，协调客户投诉处理与售后支持，维护客户满意度指标。",
    responsibilities_en: "Manage daily CS team operations, supervise service quality, coordinate complaint handling and after-sales support, maintain CSAT metrics.",
    responsibilities_vi: "Quản lý hoạt động hàng ngày của đội CS, giám sát chất lượng dịch vụ, điều phối xử lý khiếu nại và hỗ trợ sau bán hàng.",
    reportChannels: ["客户投诉处理", "服务满意度", "售后问题追踪", "月度服务质量报告"],
    status: "active",
    counterpartName: "客服主管",
    counterpartContact: "内线 8601",
    reports: ["客户投诉履历", "服务响应时效统计", "客户满意度趋势", "月度服务质量报告"],
    capabilities: ["投诉处理", "客户安抚", "服务流程优化", "服务质量监控"],
    agentName: "RuiJing-Service-Manager",
    api: "/api/service/agents",
    skills: ["complaint-handling", "customer-soothing", "service-quality", "cSat-analysis"],
    currentTasks: [
      { task: "RMA 退货处理流程优化", plan: "分析近30天退货数据，优化处理SLA", completion: 40 },
      { task: "客服KPI体系完善", plan: "建立响应率、解决率、满意度三维指标", completion: 20 },
    ],
    knowledgeBase: ["客户档案库", "投诉处理案例库", "SLA协议", "售后服务手册"],
  },
"@

# Build new content: insert before the MES 产线层 line
$newLines = @()
for ($i = 0; $i -lt $idx; $i++) {
    $newLines += $lines[$i]
}
$newLines += $serviceEntry
for ($i = $idx; $i -lt $lines.Count; $i++) {
    $newLines += $lines[$i]
}

# Write back
[System.IO.File]::WriteAllLines('apps/web/src/agents/agentData.ts', $newLines, [System.Text.Encoding]::UTF8)
Write-Host "Done. Inserted dir-service-001 at line $idx. Total lines: $($newLines.Count)"
