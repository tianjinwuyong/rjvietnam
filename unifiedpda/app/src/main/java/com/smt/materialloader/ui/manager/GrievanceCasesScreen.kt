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
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.launch

@Composable
fun GrievanceCasesScreen(onBack: () -> Unit) {
    val api = MaterialLoaderApp.instance.apiService
    val scope = rememberCoroutineScope()
    var cases by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var explanation by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("") }
    fun load() { scope.launch { runCatching { api.managerGrievanceCases() }.onSuccess { r ->
        if (r.isSuccessful) cases = r.body()?.getAsJsonArray("data")?.map { it.asJsonObject } ?: emptyList() else status = "MES/HR HTTP ${r.code()}"
    }.onFailure { status = it.message ?: "MES unavailable" } } }
    LaunchedEffect(Unit) { load() }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("HR 调查说明", fontSize = 22.sp, fontWeight = FontWeight.Bold); Button(onClick = onBack) { Text("返回") } } }
        item { Text("员工投诉由 HR 保密调查。你只能看到需要说明的事实和期限，不能看到举报人身份，也不能修改投诉原文。", color = Color(0xFF475569), fontSize = 13.sp) }
        if (status.isNotBlank()) item { Text(status, color = Color(0xFF991B1B)) }
        if (cases.isEmpty()) item { Text("当前没有待你说明的 HR 调查案件。", color = Color(0xFF475569)) }
        items(cases) { c ->
            var draft by remember(c.text("id")) { mutableStateOf("") }
            Card(colors = CardDefaults.cardColors(containerColor = Color.White)) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("案件 ${c.text("caseNo")} · ${c.text("lineCode")}", fontWeight = FontWeight.Bold)
                Text("类别：${c.text("allegationCategory")} · 回复期限：${c.text("responseDueAt")}")
                Text("投诉事实（只读）：${c.text("complaintText")}")
                OutlinedTextField(draft, { draft = it }, label = { Text("线长说明") }, modifier = Modifier.fillMaxWidth())
                Button(onClick = { scope.launch { val r = api.managerSubmitGrievanceExplanation(c.text("id"), mapOf("payload" to mapOf("explanation" to draft))); status = if (r.isSuccessful) "已发送给 HR，等待 HR 调查结论" else "提交失败 HTTP ${r.code()}"; if (r.isSuccessful) load() } }, enabled = draft.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("提交说明给 HR") }
            } }
        }
    }
}

private fun JsonObject.text(name: String): String = get(name)?.takeUnless { it.isJsonNull }?.asString ?: "-"
