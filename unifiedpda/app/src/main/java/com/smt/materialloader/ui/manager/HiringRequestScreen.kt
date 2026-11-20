package com.smt.materialloader.ui.manager

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smt.materialloader.MaterialLoaderApp
import com.google.gson.JsonObject
import kotlinx.coroutines.launch

@Composable
fun HiringRequestScreen(onBack: () -> Unit) {
    val api = MaterialLoaderApp.instance.apiService
    val rights = com.smt.materialloader.ui.login.RuntimeRights.of(MaterialLoaderApp.instance.prefs)
    val scope = rememberCoroutineScope()
    var line by remember { mutableStateOf("") }
    var shift by remember { mutableStateOf("DAY") }
    var position by remember { mutableStateOf("") }
    var positionZh by remember { mutableStateOf("") }
    var positionEn by remember { mutableStateOf("") }
    var positionVi by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("1") }
    var requiredDate by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var skills by remember { mutableStateOf("") }
    var priority by remember { mutableStateOf("NORMAL") }
    var status by remember { mutableStateOf("") }
    var requests by remember { mutableStateOf<List<JsonObject>>(emptyList()) }

    fun load() { scope.launch { runCatching { api.managerHiringRequests() }.onSuccess { r ->
        if (r.isSuccessful) requests = r.body()?.getAsJsonArray("data")?.map { it.asJsonObject } ?: emptyList()
        else status = "MES/HR HTTP ${r.code()}"
    }.onFailure { status = it.message ?: "MES unavailable" } } }
    LaunchedEffect(Unit) { load() }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("岗位需求申请", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Button(onClick = onBack) { Text("返回") }
        } }
        item { Text("线长每天发现岗位缺口时提交；HR经理和厂长双签后，HR才可以发布招聘看板。", color = Color(0xFF475569), fontSize = 13.sp) }
        item { Card(colors = CardDefaults.cardColors(containerColor = Color.White)) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            HiringField(line, { line = it }, "产线 MES 编码")
            HiringField(shift, { shift = it }, "班次")
            HiringField(position, { position = it }, "岗位编码")
            HiringField(positionZh, { positionZh = it }, "岗位名称（中文）")
            HiringField(positionEn, { positionEn = it }, "岗位名称（English）")
            HiringField(positionVi, { positionVi = it }, "岗位名称（Tiếng Việt）")
            HiringField(quantity, { quantity = it }, "招聘人数")
            HiringField(requiredDate, { requiredDate = it }, "需要到岗日期 YYYY-MM-DD")
            HiringField(skills, { skills = it }, "技能/证书要求")
            HiringField(reason, { reason = it }, "缺口原因")
            HiringField(priority, { priority = it }, "优先级 LOW / NORMAL / HIGH / URGENT")
            Button(onClick = { scope.launch { val r = api.managerCreateHiringRequest(mapOf("payload" to mapOf(
                "lineCode" to line, "shiftCode" to shift, "positionCode" to position, "positionNameZh" to positionZh,
                "positionNameEn" to positionEn, "positionNameVi" to positionVi, "quantity" to quantity.toIntOrNull(),
                "requiredDate" to requiredDate, "skillRequirements" to skills, "reason" to reason, "priority" to priority)))
                status = if (r.isSuccessful) "已提交 HR，等待 HR经理 + 厂长签字" else "提交失败 HTTP ${r.code()}"; if (r.isSuccessful) load()
            } }, enabled = line.isNotBlank() && position.isNotBlank() && positionZh.isNotBlank() && positionEn.isNotBlank() && positionVi.isNotBlank() && requiredDate.isNotBlank() && reason.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("提交岗位需求给 HR") }
        } } }
        if (status.isNotBlank()) item { Text(status, color = Color(0xFF166534), fontWeight = FontWeight.Bold) }
        item { Text("已提交需求 / 签字状态", fontSize = 18.sp, fontWeight = FontWeight.Bold) }
        items(requests) { o -> Card(colors = CardDefaults.cardColors(containerColor = Color.White)) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("${o.text("requestNo")} · ${o.text("lineCode")} · ${o.text("positionNameZh")}", fontWeight = FontWeight.Bold)
            Text("人数 ${o.text("quantity")} · 到岗 ${o.text("requiredDate")} · 状态 ${o.text("status")}")
            Text("HR签字: ${if (o.has("hrManagerSignedAt") && !o.get("hrManagerSignedAt").isJsonNull) "已签" else "待签"}   厂长签字: ${if (o.has("plantManagerSignedAt") && !o.get("plantManagerSignedAt").isJsonNull) "已签" else "待签"}", color = Color(0xFF475569))
            val requestId = o.text("id")
            val state = o.text("status")
            if (requestId != "-" && state !in setOf("PUBLISHED", "CLOSED", "CANCELLED") && rights.allows("approval.final.release")) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = !state.contains("SIGNED", true) && !state.contains("APPROVED", true),
                        onClick = { scope.launch { val r = api.managerSignHiringRequest(requestId, mapOf("role" to "PLANT_MANAGER", "comment" to "PDA sign")); status = if (r.isSuccessful) "MES 已记录签字" else "签字失败 HTTP ${r.code()}"; if (r.isSuccessful) load() } },
                        modifier = Modifier.heightIn(min = 48.dp)
                    ) { Text("签字") }
                    Button(
                        enabled = state.contains("SIGNED", true) || state.contains("APPROVED", true),
                        onClick = { scope.launch { val r = api.managerPublishHiringRequest(requestId); status = if (r.isSuccessful) "已发布招聘看板" else "发布失败 HTTP ${r.code()}"; if (r.isSuccessful) load() } },
                        modifier = Modifier.heightIn(min = 48.dp)
                    ) { Text("发布") }
                }
            }
        } } }
    }
}

private fun JsonObject.text(name: String): String = get(name)?.takeUnless { it.isJsonNull }?.asString ?: "-"

@Composable
private fun HiringField(value: String, onValueChange: (String) -> Unit, label: String) {
    OutlinedTextField(value, onValueChange, label = { Text(label) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
}
