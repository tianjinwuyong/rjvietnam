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
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

@Composable
fun TeamTodayScreen(onBack: () -> Unit) {
    val api = MaterialLoaderApp.instance.apiService
    var employees by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var status by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        while (isActive) {
            runCatching { api.hrEmployees(status = "active", limit = 200) }.onSuccess { r ->
                if (r.isSuccessful) employees = r.body()?.getAsJsonArray("data")?.map { it.asJsonObject } ?: emptyList() else status = "HR/MES HTTP ${r.code()}"
            }.onFailure { status = it.message ?: "HR/MES unavailable" }
            delay(5000)
        }
    }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("今日团队名单", fontSize = 22.sp, fontWeight = FontWeight.Bold); Button(onClick = onBack) { Text("返回") } } }
        item { Text("名单来自 HR；当前产线、岗位、班次和权限来自 MES。没有当日授权的员工不会显示。", color = Color(0xFF475569), fontSize = 13.sp) }
        if (status.isNotBlank()) item { Text(status, color = Color(0xFF991B1B)) }
        items(employees.filter { it.text("todayLineCode") != "-" }) { e -> Card(colors = CardDefaults.cardColors(containerColor = Color.White)) { Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AsyncImage(model = e.text("avatarUrl").takeUnless { it == "-" }, contentDescription = "HR photo", modifier = Modifier.size(64.dp), contentScale = ContentScale.Crop)
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("${e.text("employeeCode")} · ${e.text("employeeName")}", fontWeight = FontWeight.Bold)
            Text("性别：${e.text("gender")} · 员工编号：${e.text("employeeCode")}")
            Text("HR岗位：${e.text("positionTitleZh")} · 当日岗位：${e.text("todayRoleNameZh")}")
            Text("产线：${e.text("todayLineCode")} · 班次：${e.text("todayShiftCode")} · 主管：${e.text("todaySupervisorName")}")
            Text("上料权限：${e.text("todayLoadingPermission")} · 状态：${e.text("runningStatus")}", color = Color(0xFF475569))
            }
        } } }
    }
}

private fun JsonObject.text(name: String): String = get(name)?.takeUnless { it.isJsonNull }?.asString ?: "-"
