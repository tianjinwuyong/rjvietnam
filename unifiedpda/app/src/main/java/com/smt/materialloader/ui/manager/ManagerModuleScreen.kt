package com.smt.materialloader.ui.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import com.smt.materialloader.R
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.ui.login.RuntimeRights
import androidx.lifecycle.viewmodel.compose.viewModel

enum class ManagerModule(val title: String, val endpoint: String, val description: String) {
    ALERTS("Alerts", "/api/manager/alerts", "Critical, overdue, blocked and offline work requiring attention."),
    REPAIR("Repair center", "/api/manager/alerts?type=MAINTENANCE_PICKUP_READY", "MES-owned NG repair pickup, repair status, return handover and SLA alerts."),
    DECISIONS("Decisions", "/api/manager/decisions", "MES-authorized requests for exceptions, stop/resume, changeover and rework."),
    APPROVALS("Applications approval", "/api/manager/decisions?scope=all-departments", "Cross-department applications requiring plant manager approval."),
    ORG_CHART("HR organization", "/hr/org-chart", "Real-time HR department tree, managers and active headcount."),
    COMMUNICATIONS("Communication center", "/api/manager/channels", "MES-routed communication with line managers and departments."),
    TEAM("Team", "/api/manager/team", "HR employee identity joined to MES line assignment, PDA health, messages and acknowledgement."),
    ASSIGNMENTS("Daily assignments", "/api/manager/line-assignments", "Line manager assigns HR employees to today's line positions, product/work order and loading permission."),
    HIRING_REQUESTS("Staffing requests", "/api/manager/hiring-requests", "Line manager requests missing positions; HR and plant manager sign before publication."),
    GRIEVANCE_CASES("HR investigations", "/api/manager/grievance-cases", "Confidential HR cases requiring the line manager's explanation."),
    TARGETS("Targets", "/api/manager/targets", "Output, quality, on-time, downtime and material-readiness achievement."),
    LINE_STATUS("Line status", "/mes/lines/{lineCode} + /api/pda/heartbeats", "Work order timeline, stations, operators, equipment and material status."),
    LOADING_STATUS("Material loading status", "/api/smt/loading/work-orders", "MES work-order material loading progress and PDA status."),
    WORK_ORDERS("PMC work orders", "/pmc/work-orders", "PMC plan lock, unlock and controlled completion with MES audit."),
    HANDOVER("Handover", "/api/manager/handover", "Open issues, unfinished work, next-shift priorities and confirmation."),
    PROFILE("Profile & diagnostics", "/auth/session + /api/manager/audit", "Identity, authorized scope, expiry, audit and connection diagnostics.")
    ,PLANT_MANAGER("All line managers PDA", "/api/plant-manager/exception-requests + /api/manager/channels", "Shared PDA for manual, auto and SMT line managers; MES controls plant-only authority.")
}

@Composable
fun ManagerModuleScreen(module: ManagerModule, onBack: () -> Unit, viewModel: ManagerModuleViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    val prefs = MaterialLoaderApp.instance.prefs
    val rights = remember { RuntimeRights.of(prefs) }
    var recordId by remember { mutableStateOf("") }
    var comment by remember { mutableStateOf("") }
    var owner by remember { mutableStateOf("") }
    val canFinalRelease = rights.allows("approval.final.release")
    LaunchedEffect(module) { viewModel.load(module) }

    Column(Modifier.fillMaxSize().background(Color(0xFFF1F5F9))) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(moduleTitle(module), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
            Text(stringResource(R.string.manager_back), color = Color(0xFF2563EB), modifier = Modifier.padding(top = 6.dp).clickable { onBack() })
        }
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(R.string.manager_scope), fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                        Text(moduleDescription(module), color = Color(0xFF475569))
                        Text("MES interface: ${module.endpoint}", color = Color(0xFF64748B), fontSize = 12.sp)
                        Text(if (state.mesOnline) "MES connected · ${state.lastUpdated}" else stringResource(R.string.manager_no_local_write), color = if (state.mesOnline) Color(0xFF166534) else Color(0xFF991B1B), fontSize = 12.sp)
                        if (state.error != null) Text(state.error!!, color = Color(0xFF991B1B), fontSize = 12.sp)
                        if (module == ManagerModule.LINE_STATUS && state.kpiSummary.isNotBlank()) Text("平均/实时 KPI：${state.kpiSummary}", color = Color(0xFF0F766E), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
            }
            if (module in actionModules) {
                item {
                    OutlinedTextField(recordId, { recordId = it }, label = { Text(stringResource(R.string.manager_record_id)) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    if (module == ManagerModule.ALERTS || module == ManagerModule.REPAIR) {
                        OutlinedTextField(owner, { owner = it }, label = { Text(stringResource(R.string.manager_assign_owner)) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    }
                    OutlinedTextField(comment, { comment = it }, label = { Text(stringResource(R.string.manager_comment)) }, modifier = Modifier.fillMaxWidth())
                    if (state.pendingAction) Text("MES …", color = Color(0xFF2563EB), fontSize = 12.sp)
                    ActionButtons(module, recordId, comment, owner, viewModel, state.mesOnline && !state.pendingAction, canFinalRelease, rights)
                }
            }
            if (module == ManagerModule.LOADING_STATUS) item {
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE0F2FE)), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("MES 速度与消耗公式", fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                        Text("产品/分钟 = 生产数量 ÷ 生产分钟数", color = Color(0xFF334155), fontSize = 12.sp)
                        Text("物料/分钟 = 产品/分钟 × BOM 单台用量", color = Color(0xFF334155), fontSize = 12.sp)
                        Text("手动线计划模拟会明确标记；线长只读查看 MES 结果。", color = Color(0xFF475569), fontSize = 12.sp)
                    }
                }
            }
            if (state.items.isEmpty()) item { EmptyModuleCard(module) }
            else items(state.items) { item ->
                ModuleItemCard(
                    item = item,
                    selected = item.recordId.isNotBlank() && item.recordId == recordId,
                    onSelect = {
                        if (item.recordId.isNotBlank()) {
                            recordId = item.recordId
                        }
                    }
                )
            }
            state.actionMessage?.let { message -> item { Text(message, color = if (state.actionSucceeded) Color(0xFF166534) else Color(0xFF991B1B)) } }
        }
    }
}

private val actionModules = setOf(
    ManagerModule.ALERTS,
    ManagerModule.REPAIR,
    ManagerModule.DECISIONS,
    ManagerModule.APPROVALS,
    ManagerModule.TEAM,
    ManagerModule.TARGETS,
    ManagerModule.WORK_ORDERS,
    ManagerModule.HANDOVER
)

@Composable
private fun ActionButtons(
    module: ManagerModule,
    recordId: String,
    comment: String,
    owner: String,
    viewModel: ManagerModuleViewModel,
    enabled: Boolean,
    canFinalRelease: Boolean,
    rights: com.smt.materialloader.ui.login.EmployeeRights
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
        when (module) {
            ManagerModule.ALERTS, ManagerModule.REPAIR -> {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = enabled && recordId.isNotBlank() && rights.allows("ng.alert.ack"),
                        onClick = { viewModel.perform(module, "acknowledge", recordId, comment) },
                        modifier = Modifier.heightIn(min = 48.dp)
                    ) { Text(stringResource(R.string.manager_acknowledge)) }
                    Button(
                        enabled = enabled && recordId.isNotBlank() && owner.isNotBlank() && rights.allows("manager.alert.assign"),
                        onClick = { viewModel.perform(module, "assign", recordId, comment, owner) },
                        modifier = Modifier.heightIn(min = 48.dp)
                    ) { Text(stringResource(R.string.manager_assign)) }
                }
                Button(
                    enabled = enabled && recordId.isNotBlank() && comment.isNotBlank(),
                    onClick = { viewModel.perform(module, "escalate", recordId, comment) },
                    modifier = Modifier.heightIn(min = 48.dp)
                ) { Text(stringResource(R.string.manager_escalate)) }
            }
            ManagerModule.DECISIONS, ManagerModule.APPROVALS -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val canDecide = if (module == ManagerModule.APPROVALS) canFinalRelease else rights.allows("manager.decision.review")
                Button(
                    enabled = enabled && canDecide && recordId.isNotBlank(),
                    onClick = { viewModel.perform(module, "approve", recordId, comment) },
                    modifier = Modifier.heightIn(min = 48.dp)
                ) { Text(if (canDecide) stringResource(R.string.manager_approve) else "SENIOR ONLY") }
                Button(
                    enabled = enabled && (if (module == ManagerModule.APPROVALS) canFinalRelease else rights.allows("manager.decision.review")) && recordId.isNotBlank() && comment.isNotBlank(),
                    onClick = { viewModel.perform(module, "reject", recordId, comment) },
                    modifier = Modifier.heightIn(min = 48.dp)
                ) { Text(stringResource(R.string.manager_reject)) }
                Button(
                    enabled = enabled && recordId.isNotBlank() && comment.isNotBlank(),
                    onClick = { viewModel.perform(module, "information", recordId, comment) },
                    modifier = Modifier.heightIn(min = 48.dp)
                ) { Text(stringResource(R.string.manager_ask)) }
            }
            ManagerModule.TEAM -> Button(
                enabled = enabled && comment.isNotBlank() && rights.allows("manager.team.message"),
                onClick = { viewModel.perform(module, "message", recordId, comment) },
                modifier = Modifier.heightIn(min = 48.dp)
            ) { Text(stringResource(R.string.manager_send)) }
            ManagerModule.TARGETS -> Button(
                enabled = enabled && recordId.isNotBlank() && comment.isNotBlank() && rights.allows("manager.target.recovery"),
                onClick = { viewModel.perform(module, "recovery", recordId, comment) },
                modifier = Modifier.heightIn(min = 48.dp)
            ) { Text(stringResource(R.string.manager_recovery)) }
            ManagerModule.WORK_ORDERS -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    enabled = enabled && recordId.isNotBlank() && rights.allows("pmc.workorder.control"),
                    onClick = { viewModel.perform(module, "lock", recordId, comment) },
                    modifier = Modifier.heightIn(min = 48.dp)
                ) { Text(stringResource(R.string.manager_wo_lock)) }
                Button(
                    enabled = enabled && recordId.isNotBlank() && rights.allows("pmc.workorder.control"),
                    onClick = { viewModel.perform(module, "unlock", recordId, comment) },
                    modifier = Modifier.heightIn(min = 48.dp)
                ) { Text(stringResource(R.string.manager_wo_unlock)) }
                Button(
                    enabled = enabled && recordId.isNotBlank() && comment.isNotBlank() && rights.allows("pmc.workorder.control"),
                    onClick = { viewModel.perform(module, "complete", recordId, comment) },
                    modifier = Modifier.heightIn(min = 48.dp)
                ) { Text(stringResource(R.string.manager_wo_complete)) }
            }
            ManagerModule.HANDOVER -> Button(
                enabled = enabled && recordId.isNotBlank() && comment.isNotBlank() && rights.allows("manager.handover.confirm"),
                onClick = { viewModel.perform(module, "confirm", recordId, comment) },
                modifier = Modifier.heightIn(min = 48.dp)
            ) { Text(stringResource(R.string.manager_handover_confirm)) }
            else -> Unit
        }
    }
}

@Composable
private fun EmptyModuleCard(module: ManagerModule) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.manager_no_records), fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
            Text("${moduleTitle(module)} · ${stringResource(R.string.manager_no_local_write)}", color = Color(0xFF475569))
        }
    }
}

@Composable
private fun ModuleItemCard(item: ManagerModuleItem, selected: Boolean, onSelect: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (selected) Color(0xFFDBEAFE) else Color.White
        ),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onSelect)
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.fillMaxWidth()) {
                Text(item.title, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
            }
            Text(item.detail, color = Color(0xFF475569))
            Text(item.status, color = Color(0xFF64748B), fontSize = 12.sp)
            if (item.recordId.isNotBlank()) Text("MES ID: ${item.recordId}", color = Color(0xFF2563EB), fontSize = 11.sp)
        }
    }
}

data class ManagerModuleItem(
    val title: String,
    val detail: String,
    val status: String,
    val recordId: String = ""
)

@Composable private fun moduleTitle(module: ManagerModule): String = when (module) {
    ManagerModule.ALERTS -> stringResource(R.string.manager_alerts)
    ManagerModule.REPAIR -> "Repair center / 回修中心"
    ManagerModule.DECISIONS -> stringResource(R.string.manager_decisions_page)
    ManagerModule.APPROVALS -> stringResource(R.string.manager_approvals_page)
    ManagerModule.ORG_CHART -> stringResource(R.string.manager_org_chart_page)
    ManagerModule.COMMUNICATIONS -> stringResource(R.string.manager_communications_page)
    ManagerModule.TEAM -> stringResource(R.string.manager_team_page)
    ManagerModule.ASSIGNMENTS -> stringResource(R.string.manager_line_assignments)
    ManagerModule.HIRING_REQUESTS -> stringResource(R.string.manager_hiring_requests)
    ManagerModule.GRIEVANCE_CASES -> stringResource(R.string.manager_grievance_cases)
    ManagerModule.TARGETS -> stringResource(R.string.manager_targets_page)
    ManagerModule.LINE_STATUS -> stringResource(R.string.manager_line_status_page)
    ManagerModule.LOADING_STATUS -> stringResource(R.string.manager_loading_status_page)
    ManagerModule.WORK_ORDERS -> stringResource(R.string.manager_work_orders_page)
    ManagerModule.HANDOVER -> stringResource(R.string.manager_handover_page)
    ManagerModule.PROFILE -> stringResource(R.string.manager_profile_page)
    ManagerModule.PLANT_MANAGER -> stringResource(R.string.manager_plant_manager_page)
}

@Composable private fun moduleDescription(module: ManagerModule): String = when (module) {
    ManagerModule.ALERTS -> stringResource(R.string.manager_desc_alerts)
    ManagerModule.REPAIR -> stringResource(R.string.manager_desc_repair)
    ManagerModule.DECISIONS -> stringResource(R.string.manager_desc_decisions)
    ManagerModule.APPROVALS -> stringResource(R.string.manager_desc_approvals)
    ManagerModule.ORG_CHART -> stringResource(R.string.manager_desc_org_chart)
    ManagerModule.COMMUNICATIONS -> stringResource(R.string.manager_desc_communications)
    ManagerModule.TEAM -> stringResource(R.string.manager_desc_team)
    ManagerModule.ASSIGNMENTS -> stringResource(R.string.manager_line_assignments)
    ManagerModule.HIRING_REQUESTS -> stringResource(R.string.manager_desc_hiring_requests)
    ManagerModule.GRIEVANCE_CASES -> stringResource(R.string.manager_desc_grievance_cases)
    ManagerModule.TARGETS -> stringResource(R.string.manager_desc_targets)
    ManagerModule.LINE_STATUS -> stringResource(R.string.manager_desc_line_status)
    ManagerModule.LOADING_STATUS -> stringResource(R.string.manager_desc_loading_status)
    ManagerModule.WORK_ORDERS -> stringResource(R.string.manager_desc_work_orders)
    ManagerModule.HANDOVER -> stringResource(R.string.manager_desc_handover)
    ManagerModule.PROFILE -> stringResource(R.string.manager_desc_profile)
    ManagerModule.PLANT_MANAGER -> stringResource(R.string.manager_desc_plant_manager)
}
