package com.smt.materialloader.ui.manager

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private data class AssignmentRow(val employee: String, val line: String, val role: String, val position: String, val supervisor: String, val permission: String, val workOrder: String)

@Composable
fun LineAssignmentScreen(onBack: () -> Unit) {
    val api = MaterialLoaderApp.instance.apiService
    val locale = MaterialLoaderApp.instance.prefs.getLocale()
    val scope = rememberCoroutineScope()
    val today = remember { SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()) }
    val tomorrow = remember { Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, 1) }.time.let { SimpleDateFormat("yyyy-MM-dd", Locale.US).format(it) } }
    var date by remember { mutableStateOf(today) }
    var shift by remember { mutableStateOf("DAY") }
    var employeeCode by remember { mutableStateOf("") }
    var lineCode by remember { mutableStateOf("") }
    var supervisorId by remember { mutableStateOf("") }
    var workOrder by remember { mutableStateOf("") }
    var productCode by remember { mutableStateOf("") }
    var roleCode by remember { mutableStateOf("") }
    var roleZh by remember { mutableStateOf("") }
    var roleEn by remember { mutableStateOf("") }
    var roleVi by remember { mutableStateOf("") }
    var permission by remember { mutableStateOf("LOAD") }
    var validFrom by remember { mutableStateOf("${today}T08:00:00+07:00") }
    var validUntil by remember { mutableStateOf("${today}T20:00:00+07:00") }
    var rows by remember { mutableStateOf<List<AssignmentRow>>(emptyList()) }
    var status by remember { mutableStateOf("") }
    var selectedPosition by remember { mutableStateOf(1) }
    var selectedSide by remember { mutableStateOf("TOP") }
    var topPositionOrder by remember { mutableStateOf((1..8).toList()) }
    var bottomPositionOrder by remember { mutableStateOf((1..8).toList()) }

    fun t(zh: String, en: String, vi: String) = when (locale) {
        "en-US" -> en
        "vi-VN" -> vi
        else -> zh
    }

    suspend fun load() {
        runCatching { api.managerLineAssignments(date = date, lineCode = lineCode.ifBlank { null }) }
            .onSuccess { response ->
                if (!response.isSuccessful) {
                    status = t("MES读取失败 HTTP ${response.code()}", "MES read failed HTTP ${response.code()}", "MES đọc thất bại HTTP ${response.code()}")
                    return@onSuccess
                }
                rows = response.body()?.getAsJsonArray("data")?.map { item ->
                    val o = item.asJsonObject
                    AssignmentRow(
                        employee = o.text("employeeCode") + " · " + o.text("employeeName"),
                        line = o.text("lineCode") + " · " + o.text("shiftCode"),
                        role = o.text("roleNameZh") + " / " + o.text("roleNameEn"),
                        position = o.text("positionNameZh") + " / " + o.text("positionNameEn"),
                        supervisor = o.text("supervisorCode") + " · " + o.text("supervisorName"),
                        permission = o.text("loadingPermission"),
                        workOrder = o.text("workOrderCode")
                    )
                } ?: emptyList()
                status = t("MES已加载 ${rows.size} 条当日派工", "MES loaded ${rows.size} daily assignments", "MES đã tải ${rows.size} phân công trong ngày")
            }
            .onFailure { status = it.message ?: "MES unavailable" }
    }

    LaunchedEffect(date, lineCode) { load() }

    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(t("每日线别/岗位调整", "Daily line and role assignment", "Điều chỉnh chuyền và vai trò hằng ngày"), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
                Button(onClick = onBack) { Text(t("返回", "Back", "Quay lại")) }
            }
            Text(t("按日期、班次、产品或工单调整员工现场岗位；HR固定职位不被改写。提交后由MES授权并审计。", "Adjust the daily shop-floor role by date, shift, product or WO; the HR permanent position is never overwritten. MES authorizes and audits the change.", "Điều chỉnh vai trò theo ngày, ca, sản phẩm hoặc lệnh SX; không ghi đè chức danh HR. MES phê duyệt và lưu vết."), color = Color(0xFF475569), fontSize = 13.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { date = today }) { Text(t("今天", "Today", "Hôm nay")) }
                Button(onClick = { date = tomorrow }) { Text(t("计划明天", "Plan tomorrow", "Lập kế hoạch ngày mai")) }
            }
        }
        item {
            Text(t("产线岗位图：点击岗位编辑，左右拖动调整岗位顺序", "Line position map: tap a position to edit; drag left/right to reorder", "Sơ đồ vị trí: chạm để sửa; kéo trái/phải để đổi thứ tự"), fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
            LinePositionMap(topPositionOrder, bottomPositionOrder, selectedSide, selectedPosition, { side, number -> selectedSide = side; selectedPosition = number }, { side, from, to ->
                val current = if (side == "TOP") topPositionOrder else bottomPositionOrder
                if (to in current.indices) {
                    val updated = current.toMutableList()
                    val value = updated.removeAt(from)
                    updated.add(to, value)
                    if (side == "TOP") topPositionOrder = updated else bottomPositionOrder = updated
                }
            }, onAdd = { side ->
                selectedSide = side
                val current = if (side == "TOP") topPositionOrder else bottomPositionOrder
                val next = (current.maxOrNull() ?: 0) + 1
                if (side == "TOP") topPositionOrder = current + next else bottomPositionOrder = current + next
                selectedPosition = next
            })
            Text(t("当前编辑岗位", "Editing position", "Vị trí đang sửa") + " $selectedSide #$selectedPosition", color = Color(0xFF166534), fontWeight = FontWeight.Bold)
            Button(onClick = {
                if (selectedSide == "TOP" && topPositionOrder.size > 1) {
                    topPositionOrder = topPositionOrder - selectedPosition
                    selectedPosition = topPositionOrder.first()
                } else if (selectedSide == "BOTTOM" && bottomPositionOrder.size > 1) {
                    bottomPositionOrder = bottomPositionOrder - selectedPosition
                    selectedPosition = bottomPositionOrder.first()
                }
            }, enabled = if (selectedSide == "TOP") topPositionOrder.size > 1 else bottomPositionOrder.size > 1, modifier = Modifier.fillMaxWidth()) {
                Text(t("删除当前选中岗位", "Delete selected position", "Xóa vị trí đã chọn"))
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssignmentField(date, { date = it }, t("日期", "Date", "Ngày"))
                    AssignmentField(shift, { shift = it }, t("班次", "Shift", "Ca"))
                    AssignmentField(employeeCode, { employeeCode = it }, t("员工工号（HR）", "Employee code (HR)", "Mã nhân viên (HR)"))
                    AssignmentField(lineCode, { lineCode = it }, t("线别（MES代码）", "Line code (MES)", "Mã chuyền (MES)"))
                    AssignmentField(supervisorId, { supervisorId = it }, t("主管员工ID", "Supervisor employee ID", "ID nhân viên giám sát"))
                    AssignmentField(workOrder, { workOrder = it }, t("工单（可选）", "Work order (optional)", "Lệnh SX (tùy chọn)"))
                    AssignmentField(productCode, { productCode = it }, t("产品（可选）", "Product (optional)", "Sản phẩm (tùy chọn)"))
                    AssignmentField(roleCode, { roleCode = it }, t("现场角色代码", "Shop-floor role code", "Mã vai trò tại chuyền"))
                    AssignmentField(roleZh, { roleZh = it }, "角色名称（中文）")
                    AssignmentField(roleEn, { roleEn = it }, "Role name (English)")
                    AssignmentField(roleVi, { roleVi = it }, "Tên vai trò (Tiếng Việt)")
                    AssignmentField(permission, { permission = it }, t("上料权限：NONE / VIEW / LOAD / LOAD_AND_RELEASE", "Loading permission: NONE / VIEW / LOAD / LOAD_AND_RELEASE", "Quyền cấp liệu: NONE / VIEW / LOAD / LOAD_AND_RELEASE"))
                    AssignmentField(validFrom, { validFrom = it }, t("生效时间", "Valid from", "Có hiệu lực từ"))
                    AssignmentField(validUntil, { validUntil = it }, t("失效时间", "Valid until", "Có hiệu lực đến"))
                    Button(
                        onClick = {
                            scope.launch {
                                val body = mapOf("payload" to mapOf(
                                    "assignmentDate" to date, "shiftCode" to shift, "positionNo" to selectedPosition, "employeeCode" to employeeCode,
                                    "lineCode" to lineCode, "supervisorEmployeeId" to supervisorId,
                                    "workOrderCode" to workOrder, "productCode" to productCode, "roleCode" to roleCode,
                                    "roleNameZh" to roleZh, "roleNameEn" to roleEn, "roleNameVi" to roleVi,
                                    "loadingPermission" to permission, "permissionCodes" to listOf("mes.smt.loading"),
                                    "validFrom" to validFrom, "validUntil" to validUntil
                                ))
                                val response = api.managerCreateLineAssignment(body)
                                status = if (response.isSuccessful) t("MES已提交派工", "MES assignment submitted", "Đã gửi phân công lên MES") else t("MES拒绝派工 HTTP ${response.code()}", "MES rejected assignment HTTP ${response.code()}", "MES từ chối phân công HTTP ${response.code()}")
                                if (response.isSuccessful) load()
                            }
                        },
                        enabled = employeeCode.isNotBlank() && lineCode.isNotBlank() && roleCode.isNotBlank() && roleZh.isNotBlank() && roleEn.isNotBlank() && roleVi.isNotBlank(),
                        modifier = Modifier.fillMaxWidth()
                    ) { Text(t("提交MES并记录审计", "Submit to MES and audit", "Gửi MES và lưu nhật ký")) }
                    Button(onClick = {
                        scope.launch {
                            val response = api.managerConfirmLineAssignments(mapOf("payload" to mapOf("assignmentDate" to date, "lineCode" to lineCode, "shiftCode" to shift)))
                            status = if (response.isSuccessful) "CONFIRMED_FOR_HR" else "MES_CONFIRM_FAILED_HTTP_${response.code()}"
                            if (response.isSuccessful) load()
                        }
                    }, enabled = lineCode.isNotBlank() && rows.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                        Text(t("确认次日安排并发送HR", "Confirm next-day plan and send to HR", "Xác nhận kế hoạch ngày mai và gửi HR"))
                    }
                }
            }
        }
        item { Text(status, color = Color(0xFF166534), fontWeight = FontWeight.Bold) }
        item { Text(t("今日已派工", "Today's assignments", "Phân công hôm nay"), fontWeight = FontWeight.Bold, fontSize = 18.sp) }
        items(rows) { row ->
            Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(row.employee, fontWeight = FontWeight.Bold)
                    Text("${row.line} · ${row.workOrder}")
                    Text("${row.role} · ${row.position}")
                    Text("${t("主管", "Supervisor", "Giám sát")}: ${row.supervisor} · ${row.permission}", color = Color(0xFF475569))
                }
            }
        }
    }
}

@Composable
private fun AssignmentField(value: String, onValueChange: (String) -> Unit, label: String) {
    OutlinedTextField(value, onValueChange, label = { Text(label) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
}

private fun JsonObject.text(name: String): String = get(name)?.takeUnless { it.isJsonNull }?.asString ?: "-"

@Composable
private fun LinePositionMap(top: List<Int>, bottom: List<Int>, selectedSide: String, selected: Int, onSelect: (String, Int) -> Unit, onMove: (String, Int, Int) -> Unit, onAdd: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().background(Color(0xFFE8F0F5)).padding(8.dp)) {
        PositionRow("TOP", top, selectedSide, selected, onSelect, onMove, onAdd)
        HorizontalDivider(color = Color(0xFF31566E), thickness = 3.dp, modifier = Modifier.padding(vertical = 8.dp))
        PositionRow("BOTTOM", bottom, selectedSide, selected, onSelect, onMove, onAdd)
    }
}

@Composable
private fun PositionRow(side: String, order: List<Int>, selectedSide: String, selected: Int, onSelect: (String, Int) -> Unit, onMove: (String, Int, Int) -> Unit, onAdd: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        order.forEach { number ->
            Box(
                Modifier.size(32.dp)
                    .background(if (side == selectedSide && number == selected) Color(0xFF087F5B) else Color(0xFF2E617B), shape = androidx.compose.foundation.shape.CircleShape)
                    .clickable { onSelect(side, number) },
                contentAlignment = androidx.compose.ui.Alignment.Center
            ) { Text(number.toString(), color = Color.White, fontWeight = FontWeight.Bold) }
        }
        Button(onClick = { onAdd(side) }, modifier = Modifier.height(42.dp), contentPadding = PaddingValues(horizontal = 10.dp)) {
            Text("添加岗位")
        }
    }
}
