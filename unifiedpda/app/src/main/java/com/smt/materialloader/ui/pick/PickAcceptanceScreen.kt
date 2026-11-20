package com.smt.materialloader.ui.pick

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.data.api.dto.PickOrderDto
import com.smt.materialloader.data.api.dto.PickOrderItemDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PickAcceptanceScreen(
    viewModel: PickAcceptanceViewModel = viewModel(),
    onBack: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (state.view == PickView.PO_LIST) "拣料验收 / Pick & Sign" else state.selected?.workOrderCode ?: "拣料验收", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = { if (state.view == PickView.PO_LIST) onBack() else viewModel.goBack() }) { Icon(Icons.Default.ArrowBack, contentDescription = "back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.primary, titleContentColor = MaterialTheme.colorScheme.onPrimary, navigationIconContentColor = MaterialTheme.colorScheme.onPrimary)
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
            when (state.view) {
                PickView.PO_LIST -> PoList(state, viewModel)
                PickView.MATERIAL_LIST -> MaterialList(state, viewModel)
                PickView.SIGN -> SignStep(state, viewModel)
                PickView.DONE -> DoneStep(state, viewModel)
            }
        }
    }
}

@Composable
private fun PoList(state: PickUiState, vm: PickAcceptanceViewModel) {
    if (state.isLoading) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } ; return }
    if (state.orders.isEmpty() && state.announcements.isEmpty()) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("暂无待拣工单", color = Color(0xFF94a3b8)) } ; return }
    Column(Modifier.fillMaxSize()) {
        if (state.announcements.isNotEmpty()) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                state.announcements.forEach { a ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF14532d))
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text("✅ 已集齐可发料：工单 ${a.text("woCode")}",
                                    color = Color(0xFF4ade80), fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text(a.text("message"), color = Color(0xFFbbf7d0), fontSize = 11.sp, maxLines = 2)
                            }
                            TextButton(onClick = { a.text("id").toLongOrNull()?.let(vm::ackAnnouncement) }) {
                                Text("知道了", color = Color(0xFF86efac))
                            }
                        }
                    }
                }
            }
        }
        LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(state.orders) { order ->
                val done = order.items.count { it.status == "picked" }
                Card(
                    modifier = Modifier.fillMaxWidth().clickable { vm.openOrder(order) },
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text(order.orderNo ?: order.workOrderCode, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text("工单 ${order.workOrderCode} · 产线 ${order.lineCode ?: "-"}", fontSize = 12.sp, color = Color(0xFF64748b))
                        Text("物料 ${order.items.size} 行 · 已拣 $done", fontSize = 12.sp, color = if (done == order.items.size) Color(0xFF22c55e) else Color(0xFFf59e0b))
                        if (order.items.isNotEmpty() && order.items.all { it.status == "collected_ready" || it.status == "picked" })
                            Text("仓库已集齐 ✓", fontSize = 11.sp, color = Color(0xFF22c55e))
                    }
                }
            }
        }
    }
}

@Composable
private fun MaterialList(state: PickUiState, vm: PickAcceptanceViewModel) {
    val order = state.selected ?: return
    val allChecked = state.checked.size >= order.items.size && order.items.isNotEmpty()
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text("勾选已拣到的物料 (${state.checked.size}/${order.items.size})", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        TextButton(onClick = { vm.toggleAll() }) { Text(if (allChecked) "全不选" else "全选") }
    }
    LazyColumn(contentPadding = PaddingValues(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(order.items) { item ->
            val key = item.id ?: item.materialCode ?: ""
            val checked = state.checked.contains(key)
            Card(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = checked, onCheckedChange = { vm.toggle(item) })
                Column(Modifier.weight(1f)) {
                        Text(item.materialCode ?: "-", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Text(item.materialName?.nameZh ?: "-", fontSize = 12.sp, color = Color(0xFF64748b), maxLines = 2)
                        Text("需求 ${item.requiredQty} · 批次 ${item.lotNo ?: "无FIFO批次"} · 库位 ${item.locationQr ?: item.locationCode ?: "未定位"}", fontSize = 11.sp, color = Color(0xFF94a3b8))
                    }
                    if (item.status == "picked") Icon(Icons.Default.CheckCircle, null, tint = Color(0xFF22c55e))
                }
            }
        }
    }
    Button(
        onClick = { vm.proceedToSign() },
        enabled = allChecked,
        modifier = Modifier.fillMaxWidth().padding(16.dp).height(52.dp),
        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
    ) { Text(if (allChecked) "去签名 / Go sign" else "请勾选全部物料", fontSize = 16.sp) }
}

@Composable
private fun SignStep(state: PickUiState, vm: PickAcceptanceViewModel) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("线长/操作员签名验收 / Sign to accept", fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text("签名后 WMS 将按勾选的批次扣减库存。", fontSize = 13.sp, color = Color(0xFF64748b))
        SignaturePad(Modifier.fillMaxWidth().height(200.dp)) { vm.onSignatureCaptured(it) }
        Text(
            if (state.signatureToken.isNullOrBlank()) "请在上方签名" else "✓ 已签名",
            color = if (state.signatureToken.isNullOrBlank()) Color(0xFF94a3b8) else Color(0xFF22c55e), fontSize = 12.sp
        )
        Button(
            onClick = { vm.submit() },
            enabled = !state.isSubmitting && !state.signatureToken.isNullOrBlank(),
            modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
        ) {
            if (state.isSubmitting) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
            else Text("确认验收 / Accept", fontSize = 16.sp)
        }
    }
}

@Composable
private fun DoneStep(state: PickUiState, vm: PickAcceptanceViewModel) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.CheckCircle, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(80.dp))
            Spacer(Modifier.height(16.dp))
            Text("验收完成", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            state.acceptanceId?.let { Spacer(Modifier.height(8.dp)); Text("验收单号 #$it", fontSize = 14.sp, color = Color(0xFF64748b)) }
            Text(state.message ?: "", fontSize = 13.sp, color = Color(0xFF22c55e))
            Spacer(Modifier.height(32.dp))
            Button(onClick = { vm.reset() }, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("继续拣下一单") }
        }
    }
}

@Composable
private fun SignaturePad(modifier: Modifier = Modifier, onSignatureChanged: (String?) -> Unit) {
    val paths = remember { mutableStateListOf<Path>() }
    val currentPath = remember { mutableStateOf(Path()) }
    val strokeColor = MaterialTheme.colorScheme.onSurface
    Surface(
        modifier = modifier.pointerInput(Unit) {
            detectDragGestures(
                onDragStart = { offset -> val p = Path().apply { moveTo(offset.x, offset.y) }; currentPath.value = p; paths.add(p) },
                onDrag = { change, _ -> change.consume(); currentPath.value.lineTo(change.position.x, change.position.y) },
                onDragEnd = { onSignatureChanged("strokes:${paths.size}:${System.currentTimeMillis()}") },
                onDragCancel = {}
            )
        },
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        color = MaterialTheme.colorScheme.surface
    ) {
        Box(Modifier.fillMaxSize()) {
            if (paths.isEmpty()) Text("在此签名 / Sign here", color = Color(0xFF94a3b8), fontSize = 13.sp, modifier = Modifier.align(Alignment.Center))
            Canvas(Modifier.fillMaxSize()) {
                val stroke = Stroke(width = 5.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round)
                paths.forEach { drawPath(it, strokeColor, style = stroke) }
            }
            TextButton(onClick = { paths.clear(); onSignatureChanged(null) }, modifier = Modifier.align(Alignment.TopEnd)) { Text("清除", fontSize = 12.sp) }
        }
    }
}
