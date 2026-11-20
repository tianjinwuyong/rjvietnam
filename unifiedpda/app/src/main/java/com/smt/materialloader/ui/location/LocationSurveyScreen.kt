package com.smt.materialloader.ui.location

import android.Manifest
import android.content.Context
import android.location.LocationManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.ui.components.BarcodeScanner
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocationSurveyScreen(onBack: () -> Unit, onHome: () -> Unit, onLogout: () -> Unit) {
    val context = LocalContext.current
    var areaQr by remember { mutableStateOf("") }
    var locationQr by remember { mutableStateOf("") }
    var x by remember { mutableStateOf("") }
    var y by remember { mutableStateOf("") }
    var gps by remember { mutableStateOf("未读取") }
    var scanTarget by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.ACCESS_FINE_LOCATION] == true || granted[Manifest.permission.ACCESS_COARSE_LOCATION] == true) {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val loc = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).firstNotNullOfOrNull { provider -> runCatching { lm.getLastKnownLocation(provider) }.getOrNull() }
            gps = loc?.let { "${it.latitude}, ${it.longitude} · 精度 ${it.accuracy}m" } ?: "已授权，等待定位"
        } else gps = "未授权定位权限"
    }
    Scaffold(topBar = { TopAppBar(title = { Text("PDA 库位测绘") }, actions = { TextButton(onClick = onLogout) { Text("退出") } }) }, bottomBar = { BottomAppBar { TextButton(onClick = onBack, modifier = Modifier.weight(1f)) { Text("返回") }; TextButton(onClick = onHome, modifier = Modifier.weight(1f)) { Text("首页") } } }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("扫描区域 QR 和库位 QR，触摸 3D 地图选点，提交 WMS 位置主数据。", style = MaterialTheme.typography.titleMedium)
            OutlinedButton(onClick = { scanTarget = "area" }, modifier = Modifier.fillMaxWidth()) { Text("扫描区域 QR：${areaQr.ifBlank { "未扫描" }}") }
            OutlinedButton(onClick = { scanTarget = "location" }, modifier = Modifier.fillMaxWidth()) { Text("扫描库位 QR：${locationQr.ifBlank { "未扫描" }}") }
            Text("3D 仓库地图（触摸库位自动生成 X/Y）", style = MaterialTheme.typography.titleMedium)
            Canvas(modifier = Modifier.fillMaxWidth().height(220.dp).pointerInput(Unit) { detectTapGestures { point -> x = ((point.x / size.width) * 48f).toString(); y = ((point.y / size.height) * 30f).toString(); message = "已在 3D 地图选点：X $x m / Y $y m" } }) {
                drawRect(Color(0xFFE2E8F0))
                for (row in 0..5) for (col in 0..7) {
                    val left = size.width * (col + .08f) / 8f; val top = size.height * (row + .08f) / 6f
                    val w = size.width * .095f; val h = size.height * .11f
                    drawRect(if (row == 2 && col == 4) Color(0xFFFBBF24) else Color(0xFF93C5FD), Offset(left, top), androidx.compose.ui.geometry.Size(w, h), style = Stroke(2f))
                    drawLine(Color(0xFF64748B), Offset(left + w, top + h), Offset(left + w + 10f, top + h + 8f), 3f)
                }
                if (x.toDoubleOrNull() != null && y.toDoubleOrNull() != null) { val px = size.width * ((x.toDoubleOrNull() ?: 0.0) / 48.0).toFloat(); val py = size.height * ((y.toDoubleOrNull() ?: 0.0) / 30.0).toFloat(); drawCircle(Color(0xFFDC2626), 9f, Offset(px.coerceIn(0f, size.width), py.coerceIn(0f, size.height))) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { OutlinedTextField(x, { x = it }, label = { Text("X 坐标（米）") }, modifier = Modifier.weight(1f)); OutlinedTextField(y, { y = it }, label = { Text("Y 坐标（米）") }, modifier = Modifier.weight(1f)) }
            Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text("GPS 状态"); Text(gps); Button(onClick = { permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) }, modifier = Modifier.fillMaxWidth()) { Text("读取 GPS") } } }
            Button(onClick = { val payload = mapOf("type" to "WMS_LOCATION_SURVEY", "from" to "unified_pda", "to" to "wms", "payload" to mapOf("areaQr" to areaQr, "locationQr" to locationQr, "xCoord" to x.toDoubleOrNull(), "yCoord" to y.toDoubleOrNull(), "gps" to gps, "capturedAt" to System.currentTimeMillis())); message = "已提交 WMS"; scope.launch { runCatching { MaterialLoaderApp.instance.apiService.postPdaEvent(payload) } } }, enabled = areaQr.isNotBlank() && locationQr.isNotBlank() && x.toDoubleOrNull() != null && y.toDoubleOrNull() != null, modifier = Modifier.fillMaxWidth()) { Text("提交库位坐标到 WMS") }
            if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.primary)
        }
    }
    scanTarget?.let { target -> AlertDialog(onDismissRequest = { scanTarget = null }, title = { Text("扫描 QR") }, text = { BarcodeScanner(onBarcodeDetected = { code -> if (target == "area") areaQr = code else locationQr = code; scanTarget = null }, onError = { scanTarget = null }) }, confirmButton = { TextButton(onClick = { scanTarget = null }) { Text("取消") } }) }
}
