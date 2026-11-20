package com.smt.materialloader.ui.employee

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.gson.JsonObject
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.MaterialLoaderApp

/** Shared employee module. Every role can use this page; HR/MES remains authoritative. */
@Composable
fun EmployeeSelfServiceScreen(onBack: () -> Unit, onLogout: () -> Unit) {
    val user = MaterialLoaderApp.instance.prefs.getUser()
    val viewModel: EmployeeSelfServiceViewModel = viewModel()
    val state by viewModel.state.collectAsState()
    var leaveStart by rememberSaveable { mutableStateOf("") }
    var leaveEnd by rememberSaveable { mutableStateOf("") }
    var leaveReason by rememberSaveable { mutableStateOf("") }
    var grievance by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(Unit) { viewModel.refresh() }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text("员工中心 / Employee", style = MaterialTheme.typography.headlineMedium)
                    Text(
                        "${user?.username ?: "Employee"} · ${user?.roleKey ?: "EMPLOYEE"} · ${user?.lineCode ?: "未分配"}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 13.sp
                    )
                }
                Button(onClick = onLogout, modifier = Modifier.heightIn(min = 48.dp)) { Text("退出") }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("今日工作状态 / Today", style = MaterialTheme.typography.titleLarge)
                    Text("权限 ${user?.permissions?.size ?: 0} 项 · 考勤 ${state.attendance.size} 条 · 请假 ${state.leaveRequests.size} 条 · 申诉 ${state.grievances.size} 条")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { viewModel.clockIn() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("上班打卡") }
                        Button(onClick = { viewModel.clockOut() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("下班打卡") }
                        Button(onClick = { viewModel.refresh() }, enabled = !state.loading, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (state.loading) "同步中" else "同步") }
                    }
                    state.message?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp) }
                }
            }
        }
        item {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("员工二维码 / Employee QR", style = MaterialTheme.typography.titleLarge)
                    Text("用于考勤、身份确认和授权业务；二维码由 HR 签发。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(onClick = { viewModel.generateEmployeeQr() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("生成 / 刷新二维码") }
                    state.employeeQr?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        item {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("请假申请 / Leave request", style = MaterialTheme.typography.titleLarge)
                    OutlinedTextField(leaveStart, { leaveStart = it }, Modifier.fillMaxWidth(), label = { Text("开始日期 YYYY-MM-DD") }, singleLine = true)
                    OutlinedTextField(leaveEnd, { leaveEnd = it }, Modifier.fillMaxWidth(), label = { Text("结束日期 YYYY-MM-DD") }, singleLine = true)
                    OutlinedTextField(leaveReason, { leaveReason = it }, Modifier.fillMaxWidth(), label = { Text("原因") }, minLines = 2)
                    Button(
                        onClick = { viewModel.submitLeave("ANNUAL", leaveStart, leaveEnd, leaveReason) },
                        enabled = leaveStart.isNotBlank() && leaveEnd.isNotBlank() && leaveReason.isNotBlank(),
                        modifier = Modifier.heightIn(min = 48.dp)
                    ) { Text("提交请假") }
                }
            }
        }
        item {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("保密申诉 / Grievance", style = MaterialTheme.typography.titleLarge)
                    OutlinedTextField(grievance, { grievance = it }, Modifier.fillMaxWidth(), label = { Text("描述问题") }, minLines = 3)
                    Button(
                        onClick = { viewModel.submitGrievance(user?.username.orEmpty(), user?.lineCode.orEmpty(), "GENERAL", grievance) },
                        enabled = grievance.isNotBlank(),
                        modifier = Modifier.heightIn(min = 48.dp)
                    ) {
                        Text("提交给 HR")
                    }
                }
            }
        }
        if (state.leaveRequests.isNotEmpty()) item {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("请假审批状态 / Leave decisions", style = MaterialTheme.typography.titleLarge)
                    state.leaveRequests.take(5).forEach { leave ->
                        val status = leave.text("status", "approvalStatus", "decision")
                        val decidedBy = leave.text("decidedBy", "approver", "approverName")
                        val validUntil = leave.text("validUntil", "expiresAt", "approvalExpiry")
                        Text(
                            "${leave.text("leaveType", "type")} · ${leave.text("startDate", "fromDate")} → ${leave.text("endDate", "toDate")}",
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            buildString {
                                append(status.ifBlank { "PENDING" })
                                if (decidedBy.isNotBlank()) append(" · ").append(decidedBy)
                                if (validUntil.isNotBlank()) append(" · ").append(validUntil)
                            },
                            color = if (status.contains("APPROVED", true)) Color(0xFF166534) else Color(0xFF9A3412),
                            fontSize = 12.sp
                        )
                    }
                    Text("审批由 MES/HR 决定；PDA 只显示结果，不在本地批准。", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                }
            }
        }
        if (state.grievances.isNotEmpty()) item {
            Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("申诉处理结果 / Grievance outcome", style = MaterialTheme.typography.titleLarge)
                    state.grievances.take(5).forEach { case ->
                        val caseId = case.text("id", "caseNo")
                        val status = case.text("status")
                        val requiresAck = case.get("employeeAckRequired")?.takeUnless { it.isJsonNull }?.asBoolean == true
                            || (status.contains("RESOLVED", true) || status.contains("CLOSED", true))
                        Text("${case.text("allegationCategory", "category")} · ${case.text("createdAt", "openedAt")}", fontWeight = FontWeight.Bold)
                        Text("$status · ${case.text("resolution", "outcome", "conclusion")}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                        if (requiresAck && caseId.isNotBlank()) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = { viewModel.acknowledgeGrievance(caseId, true) },
                                    modifier = Modifier.heightIn(min = 48.dp)
                                ) { Text("接受结果") }
                                Button(
                                    onClick = { viewModel.acknowledgeGrievance(caseId, false) },
                                    modifier = Modifier.heightIn(min = 48.dp)
                                ) { Text("不接受 / 升级") }
                            }
                        }
                    }
                }
            }
        }
        item { EmployeeCard("业务工作台 / Role workspace", "当前账号按角色显示 SMT 上料、WMS、MES、PMC、IQC、工程、组长、线长或厂长工作台。") }
        item { EmployeeCard("审计与同步 / Audit", "员工资料、打卡、请假、申诉和二维码只通过 HR/MES API 变更；离线时不本地批准。") }
        item { Button(onClick = onBack, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("返回统一 PDA") } }
    }
}

@Composable
private fun EmployeeCard(title: String, description: String) {
    Card {
        Column(Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            Spacer(Modifier.height(5.dp))
            Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        }
    }
}

private fun JsonObject.text(vararg names: String): String =
    names.asSequence().mapNotNull { name ->
        get(name)?.takeUnless { it.isJsonNull }?.let { element ->
            runCatching { element.asString }.getOrNull()
        }
    }.firstOrNull { it.isNotBlank() }.orEmpty()
