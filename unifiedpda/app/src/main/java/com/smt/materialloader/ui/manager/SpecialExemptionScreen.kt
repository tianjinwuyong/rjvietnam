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
import kotlinx.coroutines.delay

private enum class ExemptionFilter(val label: String) {
    ALL("全部"), OPEN("待处理"), AUTHORIZED("已授权"), CLOSED("已关闭")
}

@Composable
fun SpecialExemptionScreen(
    onBack: () -> Unit,
    viewModel: PlantManagerViewModel = androidx.lifecycle.viewmodel.compose.viewModel()
) {
    val state by viewModel.state.collectAsState()
    var filter by remember { mutableStateOf(ExemptionFilter.ALL) }
    var selected by remember { mutableStateOf<PlantException?>(null) }
    var dialogMode by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    var durationHours by remember { mutableStateOf(1) }

    LaunchedEffect(Unit) {
        viewModel.refresh()
        while (true) {
            delay(10_000)
            viewModel.refresh()
        }
    }

    val filtered = state.exceptions.filter { exception ->
        when (filter) {
            ExemptionFilter.ALL -> true
            ExemptionFilter.OPEN -> exception.authorizationNo == null && exception.status.uppercase() != "CLOSED"
            ExemptionFilter.AUTHORIZED -> exception.authorizationNo != null && exception.status.uppercase() != "CLOSED"
            ExemptionFilter.CLOSED -> exception.status.uppercase() == "CLOSED" || exception.status.uppercase() == "RESOLVED"
        }
    }

    Column(Modifier.fillMaxSize().background(Color(0xFFF1F5F9))) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column {
                Text("特殊例外授权", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                Text(
                    if (state.online) "MES 在线 · 每 10 秒同步" else "MES 未连接 · 禁止授权操作",
                    color = if (state.online) Color(0xFF166534) else Color(0xFF991B1B),
                    fontSize = 12.sp
                )
            }
            TextButton(onClick = onBack) { Text("返回") }
        }

        state.message?.let {
            Text(it, modifier = Modifier.padding(horizontal = 16.dp), color = if (state.ok) Color(0xFF166534) else Color(0xFF991B1B))
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            ExemptionFilter.values().forEach { option ->
                FilterChip(
                    selected = filter == option,
                    onClick = { filter = option },
                    label = { Text(option.label) }
                )
            }
        }

        LazyColumn(
            Modifier.fillMaxSize().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("MES 例外闭环", fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                        Text("厂长只能在 MES 授权范围内临时放行；授权原因、有效期、执行结果和关闭记录全部回写 MES。", color = Color(0xFF475569), fontSize = 13.sp)
                    }
                }
            }
            if (filtered.isEmpty()) {
                item { Text("当前筛选没有特殊例外。", color = Color(0xFF64748B), modifier = Modifier.padding(vertical = 24.dp)) }
            } else {
                items(filtered, key = { it.id }) { exception ->
                    ExemptionCard(
                        exception = exception,
                        onAuthorize = { selected = exception; dialogMode = "authorize"; reason = ""; durationHours = 1 },
                        onClose = { selected = exception; dialogMode = "close"; result = "" }
                    )
                }
            }
        }
    }

    if (selected != null && dialogMode == "authorize") {
        AlertDialog(
            onDismissRequest = { selected = null; dialogMode = null },
            title = { Text("临时授权 1 小时") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("异常：${selected!!.no}\nMES 将校验质量门禁、WO、产线和当前身份。")
                    Text("授权有效期", fontWeight = FontWeight.Bold)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(1 to "1小时", 2 to "2小时", 3 to "3小时", 4 to "4小时", 24 to "1天", 48 to "2天").forEach { (hours, label) ->
                            FilterChip(selected = durationHours == hours, onClick = { durationHours = hours }, label = { Text(label, fontSize = 11.sp) })
                        }
                    }
                    OutlinedTextField(reason, { reason = it }, label = { Text("授权原因（必填）") }, minLines = 3)
                }
            },
            confirmButton = {
                Button(enabled = reason.isNotBlank() && state.online, onClick = {
                    viewModel.authorize(selected!!.id, reason, durationHours)
                    selected = null
                    dialogMode = null
                }) { Text("提交 MES 授权") }
            },
            dismissButton = { TextButton(onClick = { selected = null; dialogMode = null }) { Text("取消") } }
        )
    }

    if (selected != null && dialogMode == "close") {
        AlertDialog(
            onDismissRequest = { selected = null; dialogMode = null },
            title = { Text("关闭特殊例外") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${selected!!.no} 将被标记为已执行并关闭。")
                    OutlinedTextField(result, { result = it }, label = { Text("执行结果（必填）") }, minLines = 3)
                }
            },
            confirmButton = {
                Button(enabled = result.isNotBlank() && state.online, onClick = {
                    selected!!.authorizationId?.let { viewModel.closeAuthorization(it, result) }
                    selected = null
                    dialogMode = null
                }) { Text("关闭 MES 例外") }
            },
            dismissButton = { TextButton(onClick = { selected = null; dialogMode = null }) { Text("取消") } }
        )
    }
}

@Composable
private fun ExemptionCard(exception: PlantException, onAuthorize: () -> Unit, onClose: () -> Unit) {
    val critical = exception.severity.uppercase() == "CRITICAL"
    Card(
        colors = CardDefaults.cardColors(containerColor = if (critical) Color(0xFFFFE4E6) else Color.White),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(exception.no, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                Text(exception.severity, color = if (critical) Color(0xFFBE123C) else Color(0xFFB45309), fontWeight = FontWeight.Bold)
            }
            Text("异常类型：${exception.type}", color = Color(0xFF334155))
            Text("WO：${exception.wo}    物料：${exception.material}", color = Color(0xFF475569))
            Text("状态：${exception.status}", color = Color(0xFF64748B), fontSize = 12.sp)
            if (exception.authorizationNo == null && exception.status.uppercase() !in listOf("CLOSED", "RESOLVED")) {
                Button(onClick = onAuthorize, modifier = Modifier.fillMaxWidth()) { Text("申请临时授权") }
            } else if (exception.authorizationNo != null && exception.status.uppercase() !in listOf("CLOSED", "RESOLVED")) {
                Text("授权单：${exception.authorizationNo}", color = Color(0xFF166534), fontWeight = FontWeight.Bold)
                Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("填写结果并关闭 MES") }
            } else {
                Text("MES 已关闭", color = Color(0xFF166534), fontWeight = FontWeight.Bold)
            }
        }
    }
}
