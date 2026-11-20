package com.smt.materialloader.ui.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import com.smt.materialloader.MaterialLoaderApp

@Composable
fun ApprovalApplicationsScreen(onBack: () -> Unit, viewModel: ManagerModuleViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    var filter by remember { mutableStateOf("全部") }
    var selected by remember { mutableStateOf<ManagerModuleItem?>(null) }
    var action by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }
    val canFinalRelease = com.smt.materialloader.ui.login.RuntimeRights.of(MaterialLoaderApp.instance.prefs).allows("approval.final.release")

    LaunchedEffect(Unit) {
        viewModel.load(ManagerModule.APPROVALS, force = true)
        while (true) { delay(10_000); viewModel.load(ManagerModule.APPROVALS, force = true) }
    }
    val records = state.items.filter { filter == "全部" || it.status.contains(filter, ignoreCase = true) }

    Column(Modifier.fillMaxSize().background(Color(0xFFF1F5F9))) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("跨部门申请审批", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                Text(if (state.mesOnline) "MES 在线 · 审批结果实时回写" else "MES 未连接 · 审批已锁定", color = if (state.mesOnline) Color(0xFF166534) else Color(0xFF991B1B), fontSize = 12.sp)
            }
            TextButton(onClick = onBack) { Text("返回") }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("全部", "PENDING", "OPEN").forEach { option -> FilterChip(selected = filter == option, onClick = { filter = option }, label = { Text(option) }) }
        }
        LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Text("申请来源：PMC、生产、质量、仓库、工程、HR", fontWeight = FontWeight.Bold)
                        Text("厂长只处理 MES 授权范围内的申请。批准、驳回和补资料都有审计记录。", color = Color(0xFF475569), fontSize = 13.sp)
                    }
                }
            }
            if (records.isEmpty()) item { Text("当前没有待审批申请。", color = Color(0xFF64748B), modifier = Modifier.padding(vertical = 24.dp)) }
            items(records, key = { it.recordId.ifBlank { it.title + it.detail } }) { record ->
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(record.title, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                        Text(record.detail, color = Color(0xFF475569))
                        Text("状态：${record.status}", color = Color(0xFF64748B), fontSize = 12.sp)
                        if (record.recordId.isNotBlank()) Text("MES ID: ${record.recordId}", color = Color(0xFF2563EB), fontSize = 11.sp)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(enabled = state.mesOnline && canFinalRelease && record.recordId.isNotBlank(), onClick = { selected = record; action = "approve"; reason = "" }) { Text(if (canFinalRelease) "批准" else "高级厂长审批") }
                            Button(enabled = state.mesOnline && canFinalRelease && record.recordId.isNotBlank(), onClick = { selected = record; action = "reject"; reason = "" }) { Text(if (canFinalRelease) "驳回" else "高级厂长审批") }
                            TextButton(enabled = state.mesOnline && record.recordId.isNotBlank(), onClick = { selected = record; action = "information"; reason = "" }) { Text("补资料") }
                        }
                    }
                }
            }
        }
    }

    if (selected != null && action != null) {
        val title = when (action) { "approve" -> "批准申请"; "reject" -> "驳回申请"; else -> "要求补充资料" }
        AlertDialog(
            onDismissRequest = { selected = null; action = null },
            title = { Text(title) },
            text = { OutlinedTextField(reason, { reason = it }, label = { Text(if (action == "approve") "审批意见（可选）" else "原因（必填）") }, minLines = 3) },
            confirmButton = { Button(enabled = state.mesOnline && canFinalRelease && selected?.recordId?.isNotBlank() == true && (action == "approve" || reason.isNotBlank()), onClick = { viewModel.perform(ManagerModule.APPROVALS, action!!, selected!!.recordId, reason); selected = null; action = null }) { Text("提交 MES") } },
            dismissButton = { TextButton(onClick = { selected = null; action = null }) { Text("取消") } }
        )
    }
}
