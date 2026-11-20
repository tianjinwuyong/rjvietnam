package com.smt.materialloader.ui.pdaloading

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.ui.components.BarcodeScanner
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.asImageBitmap
import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

@Composable
fun PdaForecastScreen(onBack: () -> Unit) {
    val app = MaterialLoaderApp.instance
    var rows by remember { mutableStateOf<List<ForecastRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val line = app.prefs.getLineCode().ifBlank { "L001" }
    var materialCameraOpen by remember { mutableStateOf(false) }
    var materialScan by remember { mutableStateOf("") }
    var completedMaterialCount by remember { mutableStateOf(0) }

    suspend fun refresh() {
        loading = true
        try {
            val response = app.apiService.smtLoadingWorkOrders(line)
            if (!response.isSuccessful) error = "MES HTTP ${response.code()}"
            else rows = response.body()?.getAsJsonArray("data")?.map { o ->
                val x = o.asJsonObject
                ForecastRow(
                    x["workOrderCode"]?.asString.orEmpty(),
                    x["lineCode"]?.asString.orEmpty(),
                    x["plannedStartAt"]?.takeIf { !it.isJsonNull }?.asString,
                    x["plannedFinishAt"]?.takeIf { !it.isJsonNull }?.asString,
                    x["loadingTimeStatus"]?.asString ?: "NOT_SCHEDULED",
                    x["materialCount"]?.asInt ?: 0,
                    x["boundMaterialCount"]?.asInt ?: 0,
                    x["requiredPdaCount"]?.asInt ?: 0,
                    x["activePdaCount"]?.asInt ?: 0,
                    x["materials"]?.takeIf { it.isJsonArray }?.asJsonArray?.map { material ->
                        val m = material.asJsonObject
                        MaterialRow(
                            m["materialCode"]?.asString ?: m["code"]?.asString.orEmpty(),
                            m["requiredQty"]?.asInt ?: m["required"]?.asInt ?: 0,
                            m["boundQty"]?.asInt ?: m["completedQty"]?.asInt ?: 0,
                            m["loadingSequence"]?.asInt ?: m["sequence"]?.asInt ?: 0
                        )
                    } ?: emptyList()
                )
            } ?: emptyList()
        } catch (e: Exception) { error = e.message ?: "MES connection failed" }
        finally { loading = false }
    }
    LaunchedEffect(line) { refresh() }
    val activeRow = rows.firstOrNull { it.done < it.total } ?: rows.firstOrNull()

    Column(Modifier.fillMaxSize().background(Color(0xFFEDF2F6)).padding(14.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column { Text("早班生产准备", color = Color(0xFF12324A), fontSize = 24.sp, fontWeight = FontWeight.Bold); Text("Morning startup material preparation · $line", color = Color(0xFF52606D)) }
            Row { TextButton(onClick = { scope.launch { refresh() } }) { Text("刷新") }; TextButton(onClick = onBack) { Text("返回") } }
        }
        Text("一次只处理一个 WO；每次只准备一种物料", color = Color(0xFF6B4F00), fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 8.dp))
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("产线绑定模拟 / LINE BINDING SIMULATION", color = Color(0xFF12324A), fontWeight = FontWeight.Bold)
                Text("当前域：${if (line.startsWith("L004", ignoreCase = true)) "MANUAL LINE" else "SMT"} · $line", color = Color(0xFF087F5B), fontWeight = FontWeight.Bold)
                Text("三二维码顺序：机台 QR → 通道 QR → 飞达 QR → 物料 SN", color = Color(0xFF52606D))
                Text("MES 绑定来源：${if (line.startsWith("L004", ignoreCase = true)) "手动线物料准备" else "SMT 物料准备"}", color = Color(0xFF52606D))
            }
        }
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("三 QR 实码 / 3 QR codes", color = Color(0xFF12324A), fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    SimQr("机台 QR", "M-${line}-01")
                    SimQr("通道 QR", "CH-01")
                    SimQr("飞达 QR", "FEEDER-01")
                }
                Text("扫描顺序：机台 → 通道 → 飞达；之后才扫描物料 SN", color = Color(0xFFB26A00), fontWeight = FontWeight.Bold)
            }
        }
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(value = materialScan, onValueChange = { materialScan = it }, modifier = Modifier.fillMaxWidth(), label = { Text("物料 SN / Material SN") }, singleLine = true)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { materialCameraOpen = true }, modifier = Modifier.weight(1f)) { Text("打开相机扫描物料") }
                    Button(onClick = { materialScan = "MAT-RES-${(completedMaterialCount + 1).toString().padStart(3, '0')}" }, modifier = Modifier.weight(1f)) { Text("模拟物料扫描") }
                }
                if (materialCameraOpen) {
                    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.Black)) {
                        BarcodeScanner(onBarcodeDetected = { code ->
                            materialScan = code
                            materialCameraOpen = false
                            completedMaterialCount += 1
                            scope.launch {
                                delay(1200)
                                materialScan = ""
                                materialCameraOpen = true
                            }
                        }, onError = { materialScan = "相机错误：$it" }, modifier = Modifier.fillMaxWidth())
                    }
                }
                Text(if (materialScan.isBlank()) "等待扫描物料 SN · 已完成 ${completedMaterialCount} 种，下一种已准备" else "已扫描物料 SN：$materialScan · 已完成，准备下一种", color = if (materialScan.isBlank()) Color(0xFFB42318) else Color(0xFF087F5B), fontWeight = FontWeight.Bold)
            }
        }
        Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF4D6))) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("生产准备要求 / STARTUP GATE", color = Color(0xFF8A5A00), fontWeight = FontWeight.Bold)
                Text("所有 MES 物料必须完成上料后才能开始生产；MES 将发布允许开始时间。", color = Color(0xFF6B4F00), fontWeight = FontWeight.Bold)
                Text("开始时间：以当前工单 MES 排程为准；未完成时禁止启动。", color = Color(0xFF6B4F00))
                Text("未完成全部物料：生产状态 CLOSED，并持续告警。", color = Color(0xFFB42318), fontWeight = FontWeight.Bold)
            }
        }
        if (error != null) Text(error!!, color = Color(0xFFB42318))
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 8.dp)) {
            items(listOfNotNull(activeRow)) { row ->
                Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text("工单 ${row.wo}", color = Color(0xFF12324A), fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text("上料时间：${row.start ?: "MES未排程"}  →  ${row.finish ?: "未设置结束时间"}")
                        Text("产线：${row.line.ifBlank { "MES未分配" }}")
                        Text("状态：${row.status}    物料：${row.done}/${row.total} 已完成")
                        Text("PDA用量：需要 ${row.requiredPda} 台，已上线 ${row.activePda} 台", color = if (row.activePda >= row.requiredPda && row.requiredPda > 0) Color(0xFF087F5B) else Color(0xFFB26A00), fontWeight = FontWeight.Bold)
                        Text("待上料物料清单", color = Color(0xFF12324A), fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                        if (row.materials.isEmpty()) {
                            Text("MES 尚未返回物料清单", color = Color(0xFF52606D))
                        } else {
                            row.materials.forEach { material ->
                                val remaining = (material.required - material.completed).coerceAtLeast(0)
                                Text("${if (material.sequence > 0) "${material.sequence}. " else ""}${material.code} · 需求 ${material.required} · 已完成 ${material.completed} · 剩余 $remaining", color = if (remaining == 0) Color(0xFF087F5B) else Color(0xFF415A6B))
                            }
                        }
                    }
                }
            }
            if (!loading && rows.isEmpty()) item { Text("当前没有 MES 发布的上料预报", color = Color(0xFF52606D)) }
        }
    }
}

private data class ForecastRow(val wo: String, val line: String, val start: String?, val finish: String?, val status: String, val total: Int, val done: Int, val requiredPda: Int, val activePda: Int, val materials: List<MaterialRow>)
private data class MaterialRow(val code: String, val required: Int, val completed: Int, val sequence: Int)

@Composable
private fun SimQr(label: String, value: String) {
    val matrix = remember(value) { QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 180, 180) }
    val bitmap = remember(value) {
        Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888).also { bmp ->
            for (x in 0 until matrix.width) for (y in 0 until matrix.height) {
                bmp.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            }
        }
    }
    Column(horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
        Image(bitmap.asImageBitmap(), contentDescription = value, modifier = Modifier.size(92.dp))
        Text(label, fontWeight = FontWeight.Bold, fontSize = 12.sp)
        Text(value, fontSize = 10.sp, color = Color(0xFF52606D))
    }
}
