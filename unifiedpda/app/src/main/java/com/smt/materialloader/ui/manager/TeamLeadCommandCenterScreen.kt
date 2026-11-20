package com.smt.materialloader.ui.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.Image
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.asImageBitmap
import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.ui.components.BarcodeScanner

/** One MES-scoped command page for a manual/auto/SMT team leader. */
@Composable
fun TeamLeadCommandCenterScreen(
    onOpenModule: (ManagerModule) -> Unit,
    viewModel: ManagerCockpitViewModel = androidx.lifecycle.viewmodel.compose.viewModel()
) {
    val state by viewModel.state.collectAsState()
    var selectedAlert by remember { mutableStateOf<ManagerAlert?>(null) }
    val lineCode = MaterialLoaderApp.instance.prefs.getLineCode()
    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Color(0xFFF1F5F9)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text("TEAM LEAD COMMAND CENTER", color = Color.White, fontSize = 23.sp, fontWeight = FontWeight.Bold)
                    Text("团队长统一工作台 · MES scope: $lineCode", color = Color(0xFFBAE6FD))
                    Text(if (state.mesOnline) "MES ONLINE · actions are server-authorized" else "MES OFFLINE · view only; no route/release/scrap", color = if (state.mesOnline) Color(0xFF86EFAC) else Color(0xFFFCA5A5), fontSize = 12.sp)
                }
            }
        }
        item { SummaryRow(state) }
        item { RepairedNgBuckets() }
        item { RepairedNgLookup(state.alerts) { alert, scanned -> viewModel.acknowledgeScanned(alert, scanned) } }
        if (state.alerts.isNotEmpty()) {
            item { Text("URGENT / 紧急事项", fontWeight = FontWeight.Bold, color = Color(0xFF991B1B)) }
            items(state.alerts.take(5)) { alert ->
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF1F2)), modifier = Modifier.fillMaxWidth().clickable { selectedAlert = alert }) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(alert.title, fontWeight = FontWeight.Bold, color = Color(0xFF9F1239))
                        Text(alert.detail, color = Color(0xFF334155))
                    }
                }
            }
        }
        item { Text("QUICK ACTIONS / 快捷入口", fontWeight = FontWeight.Bold, color = Color(0xFF334155)) }
        item { QuickAction("维修中心 / Repair center", "待取件、维修中、返站和 SLA", Color(0xFF9A3412)) { onOpenModule(ManagerModule.REPAIR) } }
        item { QuickAction("质量告警 / Quality alerts", "NG、重复、站点跳跃和阻塞", Color(0xFF9F1239)) { onOpenModule(ManagerModule.ALERTS) } }
        item { QuickAction("产线状态 / Line status", "工站、心跳、设备和当前工单", Color(0xFF0369A1)) { onOpenModule(ManagerModule.LINE_STATUS) } }
        item { QuickAction("交接班 / Handover", "未完成事项、风险和下一班", Color(0xFF6D28D9)) { onOpenModule(ManagerModule.HANDOVER) } }
        item { QuickAction("团队与沟通 / Team & messages", "人员、分配和需确认消息", Color(0xFF166534)) { onOpenModule(ManagerModule.TEAM) } }
        item { QuickAction("决策与目标 / Decisions & targets", "MES 授权审批和目标差距", Color(0xFF92400E)) { onOpenModule(ManagerModule.DECISIONS) } }
    }
    selectedAlert?.let { alert ->
        AlertDialog(
            onDismissRequest = { selectedAlert = null },
            title = { Text("NG 告警详情 / NG ALARM DETAIL") },
            text = { Text(alert.detail) },
            confirmButton = { TextButton(onClick = { selectedAlert = null }) { Text("确认已看到（告警仍保留）") } },
            dismissButton = { TextButton(onClick = { selectedAlert = null }) { Text("关闭") } }
        )
    }
    state.actionMessage?.let { message ->
        AlertDialog(
            onDismissRequest = { viewModel.clearActionMessage() },
            title = { Text("MES 接收结果 / MES RECEIPT") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { viewModel.clearActionMessage() }) { Text("知道了 / OK") } }
        )
    }
}

@Composable
private fun RepairedNgLookup(alerts: List<ManagerAlert>, onAcknowledge: (ManagerAlert, String) -> Unit) {
    var scanning by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val bucketStation = query.substringAfter("REPAIR-BUCKET-", "").takeIf { it != query }
    val matches = if (query.isBlank()) emptyList() else alerts.filter { alert ->
        alert.title.contains("REPAIRED NG", true) &&
            (alert.detail.contains(query, true) || (bucketStation != null && alert.detail.contains("DESTINATION $bucketStation", true)))
    }
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("SCAN BUCKET QR OR ANY SHIPMENT SN", fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
            Text("MES rules generate the automatic sending signal. PDA cannot change routing or trigger a send; it only shows the MES rule/version and records bucket/SN/quantity binding. Either scan resolves the bucket view.", color = Color(0xFF475569), fontSize = 12.sp)
            Button(onClick = { scanning = !scanning }) { Text(if (scanning) "CLOSE SCANNER" else "SCAN QR / SN") }
            if (scanning) {
                BarcodeScanner(
                    onBarcodeDetected = { value -> query = value.trim(); scanning = false },
                    onError = { scanning = false },
                    modifier = Modifier.fillMaxWidth()
                )
            }
            if (query.isNotBlank()) {
                Text("SCAN: $query", fontWeight = FontWeight.Bold, color = Color(0xFF1D4ED8))
                if (matches.isEmpty()) Text("No MES alert found for this bucket/SN. Keep the shipment blocked until MES responds.", color = Color(0xFFB91C1C))
                matches.forEach { alert ->
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFF0FDF4)), modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(10.dp)) {
                            Text(alert.title, fontWeight = FontWeight.Bold, color = Color(0xFF166534))
                            Text(alert.detail, color = Color(0xFF334155), fontSize = 12.sp)
                            Button(onClick = { onAcknowledge(alert, query) }) {
                                Text("GROUP LEADER RECEIVE / 组长确认接收")
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Large, physical-bucket destinations for repaired NG. Print the same labels on the bins. */
@Composable
private fun RepairedNgBuckets() {
    val buckets = listOf(
        Bucket("ICT", "REPAIR-BUCKET-ICT", "Return here for authorized ICT retest", Color(0xFF1D4ED8)),
        Bucket("FCT", "REPAIR-BUCKET-FCT", "Return here for authorized FCT retest", Color(0xFF047857)),
        Bucket("DEPANEL", "REPAIR-BUCKET-DEPANEL", "Return here for depanel merge / handover", Color(0xFF7C3AED))
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("REPAIRED NG DESTINATION BUCKETS / 已修复NG去向", fontWeight = FontWeight.Bold, color = Color(0xFF0F172A))
        Text("Every repaired-NG shipment must have MES-bound SN + quantity. Scan the bucket QR, scan the shipment SN, confirm quantity, receive it, and recheck at the repair station before handover.", color = Color(0xFF475569), fontSize = 12.sp)
        buckets.forEach { bucket -> BucketCard(bucket) }
    }
}

private data class Bucket(val station: String, val code: String, val instruction: String, val color: Color)

@Composable
private fun BucketCard(bucket: Bucket) {
    val bitmap = androidx.compose.runtime.remember(bucket.code) { qrBitmap(bucket.code) }
    Card(colors = CardDefaults.cardColors(containerColor = bucket.color), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Image(bitmap = bitmap.asImageBitmap(), contentDescription = "QR ${bucket.code}", modifier = Modifier.padding(2.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(bucket.station, color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Black)
                Text("GO HERE / 到这里", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(bucket.code, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                Text(bucket.instruction, color = Color(0xFFE0F2FE), fontSize = 12.sp)
                Text("BIND: bucket QR + shipment SN + QTY", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

private fun qrBitmap(value: String): Bitmap {
    val matrix = MultiFormatWriter().encode(value, BarcodeFormat.QR_CODE, 220, 220)
    val bitmap = Bitmap.createBitmap(220, 220, Bitmap.Config.ARGB_8888)
    for (x in 0 until 220) for (y in 0 until 220) {
        bitmap.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
    }
    return bitmap
}

@Composable
private fun SummaryRow(state: ManagerCockpitState) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SummaryCard("PDA", state.manualPdasOnline.toString(), Modifier.weight(1f))
        SummaryCard("ALERTS", state.openViolations.toString(), Modifier.weight(1f))
        SummaryCard("STATUS", if (state.mesOnline) "OK" else "OFF", Modifier.weight(1f))
    }
}

@Composable
private fun SummaryCard(label: String, value: String, modifier: Modifier) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = modifier) {
        Column(Modifier.padding(12.dp)) { Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Color(0xFF0F172A)); Text(label, fontSize = 11.sp, color = Color(0xFF64748B)) }
    }
}

@Composable
private fun QuickAction(title: String, detail: String, color: Color, onClick: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Bold, color = color); Text(detail, color = Color(0xFF64748B), fontSize = 12.sp) }
            Button(onClick = onClick) { Text("OPEN") }
        }
    }
}
