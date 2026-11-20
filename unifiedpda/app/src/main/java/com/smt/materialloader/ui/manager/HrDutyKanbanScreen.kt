package com.smt.materialloader.ui.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HrDutyItem(val id: String, val number: String, val employee: String, val code: String, val type: String, val risk: String, val status: String, val date: String)
data class HrDutyState(val online: Boolean = false, val items: List<HrDutyItem> = emptyList(), val pending: Int = 0, val appealed: Int = 0, val approved: Int = 0, val executedToday: Int = 0, val error: String? = null)

class HrDutyKanbanViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService
    private val _state = MutableStateFlow(HrDutyState())
    val state = _state.asStateFlow()

    fun refresh() = viewModelScope.launch {
        try {
            val response = api.hrGovernanceDashboard()
            val root = response.body()
            val data = root?.getAsJsonObject("data") ?: root
            val metrics = data?.getAsJsonObject("metrics")
            _state.value = HrDutyState(
                online = response.isSuccessful,
                items = data?.getAsJsonArray("actions")?.map { e ->
                    val o = e.asJsonObject
                    HrDutyItem(o.s("id"), o.s("actionNo"), o.s("employeeName"), o.s("employeeCode"), o.s("actionType"), o.s("riskLevel"), o.s("status").uppercase(), o.s("effectiveDate"))
                } ?: emptyList(),
                pending = metrics?.s("pending")?.toIntOrNull() ?: 0,
                appealed = metrics?.s("appealed")?.toIntOrNull() ?: 0,
                approved = metrics?.s("approved")?.toIntOrNull() ?: 0,
                executedToday = metrics?.s("executed_today")?.toIntOrNull() ?: 0,
                error = if (response.isSuccessful) null else "MES/HR 返回 HTTP ${response.code()}"
            )
        } catch (e: Exception) { _state.value = _state.value.copy(online = false, error = "MES/HR 连接失败：${e.message}") }
    }

    private fun JsonObject.s(name: String): String = get(name)?.takeUnless { it.isJsonNull }?.asString ?: "-"
}

@Composable
fun HrDutyKanbanScreen(onBack: () -> Unit, viewModel: HrDutyKanbanViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    var filter by remember { mutableStateOf("全部") }
    LaunchedEffect(Unit) { viewModel.refresh(); while (true) { delay(10_000); viewModel.refresh() } }

    Column(Modifier.fillMaxSize().background(Color(0xFFF1F5F9))) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("HR 值班 Kanban", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                Text(if (state.online) "MES/HR 在线 · 10 秒刷新" else "MES/HR 未连接", color = if (state.online) Color(0xFF166534) else Color(0xFF991B1B), fontSize = 12.sp)
            }
            androidx.compose.material3.TextButton(onClick = onBack) { Text("返回") }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric("待审批", state.pending, Color(0xFFFEF3C7)); Metric("申诉", state.appealed, Color(0xFFFFE4E6)); Metric("已批准", state.approved, Color(0xFFDBEAFE)); Metric("今日执行", state.executedToday, Color(0xFFDCFCE7))
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("全部", "PENDING_APPROVAL", "APPEALED", "APPROVED", "EXECUTED").forEach { option ->
                androidx.compose.material3.FilterChip(selected = filter == option, onClick = { filter = option }, label = { Text(option) })
            }
        }
        if (state.error != null) Text(state.error!!, color = Color(0xFF991B1B), modifier = Modifier.padding(horizontal = 16.dp))
        Row(Modifier.fillMaxSize().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            listOf("PENDING_APPROVAL" to "待审批", "APPEALED" to "申诉", "APPROVED" to "已批准", "EXECUTED" to "已执行").forEach { (status, title) ->
                val records = state.items.filter { it.status == status && (filter == "全部" || filter == status) }
                Column(Modifier.padding(bottom = 16.dp).verticalScroll(rememberScrollState())) {
                    Text("$title (${records.size})", fontWeight = FontWeight.Bold, color = Color(0xFF334155), modifier = Modifier.padding(bottom = 8.dp))
                    records.forEach { HrDutyCard(it) }
                }
            }
        }
    }
}

@Composable private fun Metric(label: String, value: Int, color: Color) {
    Card(colors = CardDefaults.cardColors(containerColor = color), modifier = Modifier.padding(end = 4.dp)) { Column(Modifier.padding(12.dp)) { Text(label, color = Color(0xFF475569), fontSize = 12.sp); Text(value.toString(), fontSize = 22.sp, fontWeight = FontWeight.Bold) } }
}

@Composable private fun HrDutyCard(item: HrDutyItem) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.padding(bottom = 10.dp).fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(item.number, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
            Text("员工：${item.employee} (${item.code})", color = Color(0xFF334155))
            Text("事项：${item.type}    风险：${item.risk}", color = Color(0xFF475569))
            Text("生效/截止：${item.date}", color = Color(0xFF64748B), fontSize = 12.sp)
        }
    }
}
