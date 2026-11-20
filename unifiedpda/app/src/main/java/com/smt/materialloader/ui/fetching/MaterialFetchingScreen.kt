package com.smt.materialloader.ui.fetching

import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class FetchPackageRow(
    val packageNo: String, val qr: String, val po: String, val requisition: String,
    val workOrder: String, val line: String, val materialSummary: String, val lotSummary: String,
    val quantity: Double, val status: String, val plannedAt: String, val dueAt: String,
    val sender: String, val handedOverAt: String
)

data class MaterialFetchingState(val rows: List<FetchPackageRow> = emptyList(), val loading: Boolean = false, val error: String? = null, val message: String? = null)

class MaterialFetchingViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService
    private val _state = MutableStateFlow(MaterialFetchingState())
    val state = _state.asStateFlow()

    init { load() }

    fun load(query: String? = null) = viewModelScope.launch {
        _state.value = _state.value.copy(loading = true, error = null, message = null)
        try {
            val response = api.getMaterialFetchingQueue(query = query?.trim()?.takeIf { it.isNotEmpty() })
            if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code()}")
            val root = response.body() ?: JsonObject()
            val packages = root.getAsJsonArray("items") ?: root.getAsJsonObject("data")?.getAsJsonArray("items")
            val rows = mutableListOf<FetchPackageRow>()
            if (packages != null) for (element in packages) {
                val item = element.asJsonObject
                val contents = item.getAsJsonArray("contents")
                val materials = mutableListOf<String>(); val lots = mutableListOf<String>()
                if (contents != null) for (lineElement in contents) {
                    val line = lineElement.asJsonObject
                    line.text("material_code").takeIf { it.isNotBlank() }?.let(materials::add)
                    line.text("lot_no").takeIf { it.isNotBlank() }?.let(lots::add)
                }
                rows += FetchPackageRow(item.text("package_no"), item.text("qr_value"), item.text("source_po"), item.text("requisitionNo"), item.text("work_order_code"), item.text("line_code"), materials.distinct().joinToString(", "), lots.distinct().joinToString(", "), item.number("total_qty"), item.text("status"), item.text("planned_delivery_at"), item.text("delivery_due_at"), item.text("handed_over_by"), item.text("handed_over_at"))
            }
            _state.value = MaterialFetchingState(rows = rows)
        } catch (e: Exception) { _state.value = MaterialFetchingState(error = e.message ?: "Load failed") }
    }

    fun handOver(row: FetchPackageRow, scannedQr: String, confirmedQty: Double) = viewModelScope.launch {
        if (!scannedQr.trim().equals(row.qr, true) && !scannedQr.trim().equals(row.packageNo, true)) {
            _state.value = _state.value.copy(error = "扫描的配送包与所选任务不一致"); return@launch
        }
        if (confirmedQty != row.quantity) {
            _state.value = _state.value.copy(error = "确认数量必须与配送包数量 ${row.quantity} 一致"); return@launch
        }
        try {
            val app = MaterialLoaderApp.instance
            val actor = app.prefs.getUser()?.username ?: throw IllegalStateException("PDA 登录已失效")
            val device = Settings.Secure.getString(app.contentResolver, Settings.Secure.ANDROID_ID)
            val response = api.confirmMaterialFetch(row.qr, mapOf("payload" to mapOf("actor" to actor, "deviceCode" to device, "stationCode" to row.line, "confirmedQty" to confirmedQty)))
            if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code()}")
            _state.value = _state.value.copy(message = "${row.packageNo} 已由 $actor 交出", error = null)
            load()
        } catch (e: Exception) { _state.value = _state.value.copy(error = e.message ?: "Handover failed") }
    }

    private fun JsonObject.text(key: String) = get(key)?.takeUnless { it.isJsonNull }?.asString.orEmpty()
    private fun JsonObject.number(key: String) = get(key)?.takeUnless { it.isJsonNull }?.asDouble ?: 0.0
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaterialFetchingScreen(onLogout: () -> Unit, vm: MaterialFetchingViewModel = viewModel()) {
    val state by vm.state.collectAsState(); var query by remember { mutableStateOf("") }; var completed by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<FetchPackageRow?>(null) }; var scan by remember { mutableStateOf("") }; var quantity by remember { mutableStateOf("") }
    Scaffold(topBar = { TopAppBar(title = { Text("物料领料 / Material Fetching") }, actions = { TextButton(onClick = onLogout) { Text("退出") } }) }) { padding ->
        Column(Modifier.padding(padding).padding(12.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(query, { query = it.uppercase() }, label = { Text("PO / 领料单 / 工单 / 产线") }, modifier = Modifier.fillMaxWidth(), trailingIcon = { TextButton(onClick = { vm.load(query) }) { Text("查询") } })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { FilterChip(!completed, { completed = false }, label = { Text("待领配送包") }); FilterChip(completed, { completed = true }, label = { Text("完成记录") }) }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }; state.message?.let { Text(it, color = Color(0xFF047857)) }; if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            val visible = state.rows.filter { if (completed) it.status != "PREPARED" else it.status == "PREPARED" }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) { items(visible, key = { it.packageNo }) { row ->
                Card(onClick = { if (!completed) { selected = row; scan = ""; quantity = row.quantity.toString() } }, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${row.packageNo} · ${row.status}", fontWeight = FontWeight.Bold); Text("PO ${row.po.ifBlank { "—" }} · 领料单 ${row.requisition} · 工单 ${row.workOrder}"); Text("产线 ${row.line.ifBlank { "—" }} · 数量 ${row.quantity}"); Text("物料 ${row.materialSummary.ifBlank { "—" }} · 批次 ${row.lotSummary.ifBlank { "—" }}"); if (completed) Text("交出人 ${row.sender.ifBlank { "—" }} · ${row.handedOverAt.ifBlank { "—" }}", style = MaterialTheme.typography.bodySmall)
                } }
            } }
        }
    }
    selected?.let { row -> AlertDialog(onDismissRequest = { selected = null }, title = { Text("开始配送包交出") }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text("1. 扫描配送包 QR"); OutlinedTextField(scan, { scan = it }, label = { Text(row.packageNo) }); Text("2. 确认配送数量"); OutlinedTextField(quantity, { quantity = it }, label = { Text("数量 ${row.quantity}") }); Text("3. 使用当前 PDA 登录员工电子签名") } }, confirmButton = { Button(onClick = { vm.handOver(row, scan, quantity.toDoubleOrNull() ?: 0.0); selected = null }, enabled = scan.isNotBlank()) { Text("确认交出") } }, dismissButton = { TextButton(onClick = { selected = null }) { Text("取消") } }) }
}
