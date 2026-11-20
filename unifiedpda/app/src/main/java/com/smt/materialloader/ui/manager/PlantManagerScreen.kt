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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.BuildConfig
import com.smt.materialloader.R
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class PlantException(val id: String, val no: String, val type: String, val severity: String, val wo: String, val material: String, val status: String, val authorizationId: String?, val authorizationNo: String?, val authorizationValidUntil: String? = null)
data class RepairWorkOrderStatus(val id: String, val wo: String, val sn: String, val quantity: String, val status: String, val destination: String, val sendMode: String, val bucket: String)
data class PlantLoadingItem(val bindingId: String, val workOrder: String, val material: String, val materialSn: String, val machine: String, val slot: String, val plantDecision: String)
data class PlantManagerState(val online: Boolean = false, val exceptions: List<PlantException> = emptyList(), val repairOrders: List<RepairWorkOrderStatus> = emptyList(), val loadingItems: List<PlantLoadingItem> = emptyList(), val message: String? = null, val ok: Boolean = false)

class PlantManagerViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService
    private val _state = MutableStateFlow(PlantManagerState())
    val state = _state.asStateFlow()

    fun refresh() = viewModelScope.launch {
        try {
            val response = api.plantManagerExceptionRequests()
            val woResponse = api.pmcWorkOrders(status = "RUNNING", limit = 200, lineCode = MaterialLoaderApp.instance.prefs.getLineCode().ifBlank { null })
            val loadingResponse = api.plantLoadingApprovalQueue(MaterialLoaderApp.instance.prefs.getLineCode().ifBlank { null })
            _state.value = _state.value.copy(online = response.isSuccessful && woResponse.isSuccessful && loadingResponse.isSuccessful, exceptions = parseExceptions(response.body()), repairOrders = parseRepairOrders(woResponse.body()), loadingItems = parseLoadingItems(loadingResponse.body()), message = if (response.isSuccessful && woResponse.isSuccessful && loadingResponse.isSuccessful) null else "MES approval data unavailable", ok = response.isSuccessful && woResponse.isSuccessful && loadingResponse.isSuccessful)
        } catch (e: Exception) { _state.value = _state.value.copy(online = false, message = e.message, ok = false) }
    }

    fun approveLoadingItem(bindingId: String) {
        viewModelScope.launch {
            val response = api.plantLoadingItemApproval(bindingId, mapOf("approvalCode" to "PLANT_MANAGER", "decision" to "APPROVED", "reason" to "Plant Manager approval"))
            _state.value = _state.value.copy(message = if (response.isSuccessful) "Material item approved" else "MES rejected item approval: HTTP ${response.code()}", ok = response.isSuccessful)
            if (response.isSuccessful) refresh()
        }
    }

    fun bindSite(siteCode: String, lineCode: String, stationCode: String, supervisorId: String) {
        if (siteCode.isBlank() || lineCode.isBlank() || stationCode.isBlank()) return
        viewModelScope.launch {
            val response = api.managerCreateLineAssignment(mapOf("payload" to mapOf(
                "assignmentType" to "SITE_BINDING",
                "siteCode" to siteCode.trim(),
                "lineCode" to lineCode.trim(),
                "stationCode" to stationCode.trim(),
                "supervisorEmployeeId" to supervisorId.trim(),
                "assignedBy" to "PLANT_MANAGER_PDA"
            )))
            _state.value = _state.value.copy(
                message = if (response.isSuccessful) "站点绑定已提交 MES / Site binding submitted to MES" else "MES 拒绝站点绑定 / MES rejected site binding: HTTP ${response.code()}",
                ok = response.isSuccessful
            )
            if (response.isSuccessful) MaterialLoaderApp.instance.prefs.saveSiteCode(siteCode)
        }
    }

    fun createPmcWorkOrder(code: String, product: String, line: String, quantity: Int) {
        if (code.isBlank() || product.isBlank() || line.isBlank() || quantity <= 0) return
        viewModelScope.launch {
            val response = api.pmcCreateWorkOrder(mapOf("payload" to mapOf(
                "code" to code.trim(), "productCode" to product.trim(), "lineCode" to line.trim(),
                "plannedQty" to quantity, "createdBy" to "PLANT_MANAGER_MOBILE"
            )))
            _state.value = _state.value.copy(message = if (response.isSuccessful) "PMC work order created" else "PMC rejected work order: HTTP ${response.code()}", ok = response.isSuccessful)
            if (response.isSuccessful) refresh()
        }
    }

    fun authorize(exceptionId: String, reason: String, durationHours: Int) {
        if (reason.isBlank()) return
        viewModelScope.launch {
            val response = api.plantManagerAuthorizeException(exceptionId, mapOf("authorizationType" to "TEMPORARY_PRODUCTION_EXCEPTION", "reason" to reason.trim(), "durationHours" to durationHours, "validFrom" to iso(Date())))
            _state.value = _state.value.copy(message = if (response.isSuccessful) "MES authorization issued" else "MES rejected authorization: HTTP ${response.code()}", ok = response.isSuccessful)
            if (response.isSuccessful) refresh()
        }
    }

    fun closeAuthorization(authorizationId: String, result: String) {
        if (result.isBlank()) return
        viewModelScope.launch {
            val response = api.plantManagerCloseAuthorization(authorizationId, mapOf("result" to result.trim()))
            _state.value = _state.value.copy(message = if (response.isSuccessful) "MES closed the authorization" else "MES rejected closure: HTTP ${response.code()}", ok = response.isSuccessful)
            if (response.isSuccessful) refresh()
        }
    }

    fun revokeAuthorization(authorizationId: String) {
        viewModelScope.launch {
            val response = api.plantManagerRevokeAuthorization(authorizationId, mapOf("reason" to "Plant Manager revoke"))
            _state.value = _state.value.copy(
                message = if (response.isSuccessful) "MES revoked the authorization" else "MES rejected revoke: HTTP ${response.code()}",
                ok = response.isSuccessful
            )
            if (response.isSuccessful) refresh()
        }
    }

    private fun parseExceptions(root: JsonObject?): List<PlantException> = root?.getAsJsonArray("data")?.map { e ->
        val o = e.asJsonObject
        PlantException(o.s("id"), o.s("exceptionNo"), o.s("exceptionType"), o.s("severity"), o.s("workOrderCode"), o.s("materialCode"), o.s("status"), o.s("authorizationId").ifBlank { null }, o.s("authorizationNo").ifBlank { null }, o.s("authorizationValidUntil").ifBlank { null })
    } ?: emptyList()

    private fun parseRepairOrders(root: JsonObject?): List<RepairWorkOrderStatus> {
        val rows = root?.getAsJsonArray("data") ?: root?.getAsJsonArray("items") ?: return emptyList()
        return rows.map { e ->
            val o = e.asJsonObject
            RepairWorkOrderStatus(o.s("id"), o.s("code").ifBlank { o.s("workOrderCode") }.ifBlank { o.s("workOrderNo") }, o.s("sn").ifBlank { o.s("productSn") }, o.s("plannedQuantity").ifBlank { o.s("quantity") }, o.s("status"), o.s("lineCode").ifBlank { o.s("productionLine") }, o.s("scheduleMode").ifBlank { o.s("dispatchMode") }, o.s("planVersion").ifBlank { o.s("version") })
        }
    }

    private fun parseLoadingItems(root: JsonObject?): List<PlantLoadingItem> {
        val rows = root?.getAsJsonObject("data")?.getAsJsonArray("items") ?: return emptyList()
        return rows.map { e ->
            val o = e.asJsonObject
            val approvals = o.getAsJsonArray("approvals")
            val plant = approvals?.firstOrNull { it.asJsonObject.s("approvalCode") == "PLANT_MANAGER" }?.asJsonObject?.s("decision") ?: "PENDING"
            PlantLoadingItem(o.s("bindingId"), o.s("workOrderCode"), o.s("materialCode"), o.s("materialSn"), o.s("machineCode"), o.s("slotNo"), plant)
        }
    }

    private fun iso(date: Date) = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(date)
    private fun JsonObject.s(name: String): String = get(name)?.takeUnless { it.isJsonNull }?.asString ?: "-"
}

@Composable
fun PlantManagerScreen(onBack: () -> Unit, viewModel: PlantManagerViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    var filter by remember { mutableStateOf("OPEN") }
    var reason by remember { mutableStateOf("") }
    var result by remember { mutableStateOf("") }
    var duration by remember { mutableStateOf(1) }
    var woCode by remember { mutableStateOf("") }
    var productCode by remember { mutableStateOf("") }
    var lineCode by remember { mutableStateOf(MaterialLoaderApp.instance.prefs.getLineCode()) }
    var siteCode by remember { mutableStateOf(MaterialLoaderApp.instance.prefs.getSiteCode()) }
    var stationCode by remember { mutableStateOf("manual_line") }
    var supervisorId by remember { mutableStateOf("") }
    var plannedQty by remember { mutableStateOf("1") }
    val currentUser = MaterialLoaderApp.instance.prefs.getUser()
    val rights = com.smt.materialloader.ui.login.RuntimeRights.of(MaterialLoaderApp.instance.prefs)
    val canFinalRelease = rights.allows("approval.final.release")
    val isJunior = currentUser?.seniority?.equals("JUNIOR", ignoreCase = true) == true
    LaunchedEffect(Unit) { viewModel.refresh(); while (true) { delay(10_000); viewModel.refresh() } }
    Column(Modifier.fillMaxSize().background(Color(0xFFF1F5F9))) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Column { Text(stringResource(R.string.pm_title), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A)); Text(if (state.online) stringResource(R.string.pm_mes_online) else stringResource(R.string.pm_mes_offline), color = if (state.online) Color(0xFF166534) else Color(0xFF991B1B), fontSize = 12.sp) }
            TextButton(onClick = onBack) { Text(stringResource(R.string.manager_back)) }
        }
        state.message?.let { Text(it, color = if (state.ok) Color(0xFF166534) else Color(0xFF991B1B), modifier = Modifier.padding(horizontal = 16.dp)) }
        if (isJunior) Text("初级厂长 / JUNIOR · 可查看和协同；最终审批与异常授权由高级厂长执行", color = Color(0xFF92400E), modifier = Modifier.padding(horizontal = 16.dp), fontSize = 12.sp)
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = filter == "OPEN", onClick = { filter = "OPEN" }, label = { Text(stringResource(R.string.pm_open)) })
            FilterChip(selected = filter == "ALL", onClick = { filter = "ALL" }, label = { Text(stringResource(R.string.pm_all)) })
        }
        // The header, status message, test-build banner and filter chips are
        // outside the list. Keep the list in the remaining viewport so it
        // cannot draw underneath those controls on small PDAs.
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE0F2FE)), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("厂长站点绑定 / PLANT MANAGER SITE BINDING", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                        Text("先绑定站点、产线和工站；之后本 PDA 的告警、工单和上料数据都按该范围从 MES 读取。", color = Color(0xFF334155), fontSize = 12.sp)
                        OutlinedTextField(siteCode, { siteCode = it }, label = { Text("Site code / 厂区代码") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                        OutlinedTextField(lineCode, { lineCode = it }, label = { Text("Line code / 产线") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                        OutlinedTextField(stationCode, { stationCode = it }, label = { Text("Station scope / 工站范围") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                        OutlinedTextField(supervisorId, { supervisorId = it }, label = { Text("Plant manager employee ID / 厂长工号") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                        Button(enabled = state.online && rights.allows("plant.exception.authorize") && siteCode.isNotBlank() && lineCode.isNotBlank() && stationCode.isNotBlank(), onClick = { viewModel.bindSite(siteCode, lineCode, stationCode, supervisorId) }, modifier = Modifier.fillMaxWidth()) {
                            Text("绑定站点并同步 MES / BIND SITE")
                        }
                    }
                }
            }
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("手机创建 PMC 工单 / CREATE PMC WO", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                        Text("Plant Manager permission required; PMC remains the authority.", color = Color(0xFF475569), fontSize = 12.sp)
                        OutlinedTextField(woCode, { woCode = it }, label = { Text("WO code") }, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(productCode, { productCode = it }, label = { Text("Product code") }, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(lineCode, { lineCode = it }, label = { Text("Line") }, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(plannedQty, { plannedQty = it.filter(Char::isDigit) }, label = { Text("Planned quantity") }, modifier = Modifier.fillMaxWidth())
                        Button(enabled = state.online && rights.allows("pmc.workorder.control") && woCode.isNotBlank() && productCode.isNotBlank() && lineCode.isNotBlank() && (plannedQty.toIntOrNull() ?: 0) > 0, onClick = { viewModel.createPmcWorkOrder(woCode, productCode, lineCode, plannedQty.toIntOrNull() ?: 0) }, modifier = Modifier.fillMaxWidth()) { Text("CREATE PMC WO") }
                    }
                }
            }
            item {
                Text("逐项上料审批 / MATERIAL ITEM APPROVAL", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                Text("Each material SN requires all departments. Plant Manager is the final approval.", color = Color(0xFF475569), fontSize = 12.sp)
            }
            if (state.loadingItems.isEmpty()) item { Text("No active material items returned by MES", color = Color(0xFF64748B)) }
            items(state.loadingItems, key = { it.bindingId }) { item ->
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("WO ${item.workOrder} · ${item.material}", fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                        Text("SN ${item.materialSn} · ${item.machine} · ${item.slot}", color = Color(0xFF334155))
                        Text("Plant Manager: ${item.plantDecision}", color = if (item.plantDecision == "APPROVED") Color(0xFF166534) else Color(0xFF9A3412), fontWeight = FontWeight.Bold)
                        if (item.plantDecision != "APPROVED") {
                            Button(enabled = canFinalRelease && rights.allows("plant.loading.approve") && state.online, onClick = { viewModel.approveLoadingItem(item.bindingId) }) { Text(if (canFinalRelease) "APPROVE THIS MATERIAL" else "REVIEW ONLY · SENIOR APPROVAL") }
                        }
                    }
                }
            }
            item {
                Text("PMC 工单状态 / PMC WO STATUS", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                Text("PMC-owned status: WO · SN/product · planned quantity · line · plan version", color = Color(0xFF475569), fontSize = 12.sp)
            }
            if (state.repairOrders.isEmpty()) item { Text("No running PMC work orders returned by MES", color = Color(0xFF64748B)) }
            items(state.repairOrders, key = { it.id }) { wo ->
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("${wo.status} · WO ${wo.wo}", fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                        Text("SN ${wo.sn} · QTY ${wo.quantity} · SEND ${wo.sendMode}", color = Color(0xFF334155))
                Text("PMC LINE ${wo.destination} · PLAN ${wo.bucket}", color = Color(0xFF1D4ED8), fontWeight = FontWeight.Bold)
                    }
                }
            }
            item { Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) { Text(stringResource(R.string.pm_rules_title), fontWeight = FontWeight.Bold); Text(stringResource(R.string.pm_rules_detail), color = Color(0xFF475569), fontSize = 13.sp) } } }
            item { OutlinedTextField(reason, { reason = it }, label = { Text(stringResource(R.string.pm_reason)) }, modifier = Modifier.fillMaxWidth(), minLines = 2) }
            item { OutlinedTextField(result, { result = it }, label = { Text(stringResource(R.string.pm_result)) }, modifier = Modifier.fillMaxWidth(), minLines = 2) }
            item { Text(stringResource(R.string.pm_duration), fontWeight = FontWeight.Bold); Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf(1, 2, 4, 24, 48).forEach { hours -> FilterChip(selected = duration == hours, onClick = { duration = hours }, label = { Text("${hours}h") }) } } }
            val records = state.exceptions.filter { filter == "ALL" || it.status == "OPEN" || it.status == "INVESTIGATING" }
            if (records.isEmpty()) item { Text(stringResource(R.string.pm_no_requests), color = Color(0xFF64748B)) }
            items(records, key = { it.id }) { exception ->
                val blocked = exception.type == "IQC_BLOCKED" || exception.type == "EXPIRY_BLOCKED"
                Card(colors = CardDefaults.cardColors(containerColor = if (exception.severity == "CRITICAL") Color(0xFFFFE4E6) else Color.White), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text("${exception.severity} · ${exception.no}", fontWeight = FontWeight.Bold); Text(exception.type); Text("WO: ${exception.wo} · Material: ${exception.material}"); Text("${exception.status}${exception.authorizationNo?.let { " · $it" } ?: ""}", color = Color(0xFF64748B), fontSize = 12.sp)
                        if (exception.authorizationValidUntil != null) Text(stringResource(R.string.pm_valid_until, exception.authorizationValidUntil), color = Color(0xFF166534), fontSize = 12.sp)
                        if (blocked) Text(stringResource(R.string.pm_quality_block), color = Color(0xFF991B1B), fontWeight = FontWeight.Bold)
                        if (exception.authorizationId == null && !blocked) Button(enabled = canFinalRelease && state.online && reason.isNotBlank(), onClick = { viewModel.authorize(exception.id, reason, duration) }) { Text(if (canFinalRelease) stringResource(R.string.pm_authorize) else "REVIEW ONLY · SENIOR AUTHORIZATION") }
                        else if (exception.authorizationId != null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(enabled = canFinalRelease && state.online && result.isNotBlank(), onClick = { viewModel.closeAuthorization(exception.authorizationId, result) }) { Text(if (canFinalRelease) stringResource(R.string.pm_close) else "REVIEW ONLY · SENIOR CLOSE") }
                            Button(enabled = canFinalRelease && state.online, onClick = { viewModel.revokeAuthorization(exception.authorizationId) }) { Text("REVOKE / 撤销授权") }
                        }
                    }
                }
            }
        }
    }
}
