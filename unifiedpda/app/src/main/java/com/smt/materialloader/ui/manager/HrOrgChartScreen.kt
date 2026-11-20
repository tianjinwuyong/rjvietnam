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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HrOrgNode(val id: String, val parentId: String?, val code: String, val name: String, val manager: String, val title: String, val members: String, val status: String, val level: Int)
data class HrOrgState(val online: Boolean = false, val nodes: List<HrOrgNode> = emptyList(), val error: String? = null)

class HrOrgChartViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService
    private val _state = MutableStateFlow(HrOrgState())
    val state = _state.asStateFlow()
    fun refresh() = viewModelScope.launch {
        try {
            val response = api.hrOrgChart(); val root = response.body(); val data = root?.getAsJsonObject("data") ?: root
            _state.value = HrOrgState(response.isSuccessful, data?.getAsJsonArray("items")?.map { e ->
                val o = e.asJsonObject
                HrOrgNode(o.s("id"), o.s("parentId").ifBlank { null }, o.s("code"), o.s("nameZh"), o.s("managerNameZh").ifBlank { "未设置" }, o.s("managerTitleZh"), o.s("memberCount"), o.s("status"), o.s("level").toIntOrNull() ?: 1)
            } ?: emptyList(), if (response.isSuccessful) null else "HR 组织接口 HTTP ${response.code()}")
        } catch (e: Exception) { _state.value = _state.value.copy(online = false, error = "HR 组织接口连接失败：${e.message}") }
    }
    private fun JsonObject.s(name: String): String = get(name)?.takeUnless { it.isJsonNull }?.asString ?: "-"
}

@Composable
fun HrOrgChartScreen(onBack: () -> Unit, viewModel: HrOrgChartViewModel = viewModel()) {
    val state by viewModel.state.collectAsState(); var onlyActive by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) { viewModel.refresh(); while (true) { delay(10_000); viewModel.refresh() } }
    val nodes = state.nodes.filter { !onlyActive || it.status.equals("ACTIVE", true) }
    Column(Modifier.fillMaxSize().background(Color(0xFFF1F5F9))) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Column { Text("HR 实时组织结构", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A)); Text(if (state.online) "HR 在线 · 10 秒刷新" else "HR 未连接", color = if (state.online) Color(0xFF166534) else Color(0xFF991B1B), fontSize = 12.sp) }
            TextButton(onClick = onBack) { Text("返回") }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("部门总数：${nodes.size}", color = Color(0xFF475569)); TextButton(onClick = { onlyActive = !onlyActive }) { Text(if (onlyActive) "显示全部部门" else "只看在用部门") }
        }
        state.error?.let { Text(it, color = Color(0xFF991B1B), modifier = Modifier.padding(horizontal = 16.dp)) }
        LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(nodes, key = { it.id }) { node ->
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth().padding(start = (node.level - 1).coerceAtLeast(0).dp * 18)) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("${if (node.level > 1) "↳ " else ""}${node.name}  [${node.code}]", fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                        Text("负责人：${node.manager}${if (node.title != "-") " · ${node.title}" else ""}", color = Color(0xFF334155))
                        Text("在职人数：${node.members} · 状态：${node.status}", color = Color(0xFF64748B), fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
