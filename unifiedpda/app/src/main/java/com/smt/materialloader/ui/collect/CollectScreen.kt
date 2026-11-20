package com.smt.materialloader.ui.collect

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.PendingActions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.NativeQrScannerActivity
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectScreen(
    viewModel: CollectViewModel = viewModel(),
    onBack: () -> Unit,
    onLogout: () -> Unit = {},
    title: String = "生产领料 / Material Picking",
    actorLabel: String = "取料人"
) {
    val state by viewModel.state.collectAsState()
    var woExpanded by remember { mutableStateOf(false) }
    var selectedWo by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val scanLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            val value = result.data?.getStringExtra(NativeQrScannerActivity.EXTRA_SCAN_VALUE)
            if (!value.isNullOrBlank()) viewModel.locateByScan(value)
        }
    }

    // When a camera scan locates a line, scroll it into view.
    LaunchedEffect(state.highlightLineId) {
        val target = state.highlightLineId
        if (target != null) {
            val idx = state.lines.indexOfFirst { it.id == target }
            if (idx >= 0) listState.animateScrollToItem(idx)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = {
                        if (state.order == null) onBack() else viewModel.reset()
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "back")
                    }
                },
                actions = {
                    TextButton(onClick = onLogout) {
                        Text("退出", color = MaterialTheme.colorScheme.onPrimary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    navigationIconContentColor = MaterialTheme.colorScheme.onPrimary
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
            state.message?.let {
                Text(it, color = Color(0xFF0d9488), fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }

            // My scope banner: exactly which materials THIS account may pick
            val scope = viewModel.userDomain
            val (scopeName, scopeDesc, scopeColor) = when (scope) {
                "SMT" -> Triple("SMT线 · 贴片领料", "只领贴片段物料（SMD元件）", Color(0xFF2563eb))
                "AUTO" -> Triple("自动线 · 自动插件领料", "只领 AI段/组装段物料", Color(0xFF7c3aed))
                "MANUAL" -> Triple("手动线 · 插料领料", "只领插件段物料（DIP人工插件）", Color(0xFF16a34a))
                else -> if (viewModel.collectMode) Triple("仓库集料（全段）", "集齐所有工段的物料", Color(0xFF475569)) else Triple("仓库领料（全段）", "可领所有工段的物料", Color(0xFF475569))
            }
            Card(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                colors = CardDefaults.cardColors(containerColor = scopeColor)
            ) {
                Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Text(scopeName, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Text(scopeDesc, color = Color.White.copy(alpha = 0.9f), fontSize = 12.sp)
                    // Fetcher signature: who is logged in and picking on this sheet.
                    Text("${actorLabel}：${viewModel.currentUserForDisplay}", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                }
            }

            // Assigned-task filter (kitting home only): see only lines allocated
            // to this account. Line pickers always see the full staged set.
            if (viewModel.collectMode) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("只显示分给我的任务", fontSize = 13.sp,
                        modifier = Modifier.weight(1f))
                    Switch(checked = state.mineOnly, onCheckedChange = { viewModel.toggleMineOnly() })
                }
            }

            val order = state.order
            if (order == null) {
                // ── No order selected: LIVE dropdown of WOs needing material
                //    collection (WMS pushes OPEN/PARTIAL collect lists only).
                //    Auto-polls so collection happening on other PDAs shows up.
                Column(Modifier.fillMaxWidth().weight(1f)) {
                    LaunchedEffect(Unit) {
                        while (true) {
                            kotlinx.coroutines.delay(6000)
                            viewModel.refreshAvailable()
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(if (viewModel.collectMode) "待集料工单（实时）" else "待领取工单（实时）", fontWeight = FontWeight.Bold, fontSize = 15.sp,
                            modifier = Modifier.weight(1f))
                        TextButton(onClick = { viewModel.refreshAvailable() }, enabled = !state.loadingAvailable) {
                            Text("刷新")
                        }
                    }
                    if (state.loadingAvailable) {
                        LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
                    }
                    // 集料员: OPEN/PARTIAL (still need staging). 领料员: COLLECTED/
                    // PARTIAL orders still holding staged lines (ready to pick).
                    val needCollect = state.available.filter { opt ->
                        val st = (opt.collectStatus ?: "").uppercase()
                        if (viewModel.collectMode) st.isBlank() || st !in setOf("COLLECTED", "ISSUED", "ACCEPTED", "CANCELLED", "DONE")
                        else st == "COLLECTED" || st == "PARTIAL"
                    }
                    ExposedDropdownMenuBox(
                        expanded = woExpanded,
                        onExpandedChange = {
                            woExpanded = it
                            if (it) viewModel.refreshAvailable()
                        },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
                    ) {
                        OutlinedTextField(
                            value = selectedWo,
                            onValueChange = { selectedWo = it.uppercase() },
                            label = { Text(if (viewModel.collectMode) "下拉选择待集料工单…" else "下拉选择待领取工单…") },
                            singleLine = true,
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = woExpanded) },
                            modifier = Modifier.fillMaxWidth().menuAnchor()
                        )
                        ExposedDropdownMenu(
                            expanded = woExpanded,
                            onDismissRequest = { woExpanded = false }
                        ) {
                            if (state.loadingAvailable) {
                                DropdownMenuItem(text = { Text("加载中…") }, onClick = {})
                            } else if (needCollect.isEmpty()) {
                                DropdownMenuItem(text = { Text(if (viewModel.collectMode) "暂无待集料工单（WMS 尚未推送）" else "暂无可领取工单（集料员备料中）") }, onClick = {})
                            } else {
                                needCollect.forEach { opt ->
                                    DropdownMenuItem(
                                        text = {
                                            Column {
                                                Text(
                                                    "${opt.workOrderCode} · ${opt.lineCode.ifBlank { "—" }}",
                                                    fontWeight = FontWeight.Bold, fontSize = 14.sp
                                                )
                                                Text(
                                                    buildString {
                                                        append(opt.collectNo ?: "未生成领料单")
                                                        if (opt.totalLines > 0) append(" · 已集 ${opt.collectedLines}/${opt.totalLines}")
                                                        val st = (opt.collectStatus ?: "").uppercase()
                                                        if (st.isNotBlank()) append(" · " + when (st) {
                                                            "OPEN" -> "待集料"
                                                            "PARTIAL" -> "部分已集"
                                                            "COLLECTED" -> "可领取"
                                                            else -> st
                                                        })
                                                    },
                                                    fontSize = 12.sp,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                                )
                                            }
                                        },
                                        onClick = {
                                            selectedWo = opt.workOrderCode
                                            woExpanded = false
                                            viewModel.load(opt.workOrderCode)
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                // ── Order loaded: fixed summary + scrollable material list ──
                if (state.busy) {
                    LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
                }
                // Dynamic allocation: WMS splits this order's unassigned lines
                // across the PDAs working it (location-ordered, load-balanced).
                if (viewModel.collectMode) {
                    OutlinedButton(
                        onClick = { viewModel.autoAllocate() },
                        enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp)
                    ) { Text("自动分配：WMS 按库位把待集料行分给各 PDA") }
                }
                val pending = state.lines.count { if (viewModel.collectMode) it.status == "PENDING" else it.status == "COLLECTED" }
                val done = state.lines.count { if (viewModel.collectMode) it.status == "COLLECTED" || it.status == "ISSUED" else it.status == "ISSUED" }
                Card(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                    colors = CardDefaults.cardColors(
                        // Dark theme friendly: deep amber / deep green containers
                        // with light text, never pale yellow + white.
                        containerColor = if (order.status == "COLLECTED" || order.status == "ISSUED")
                            Color(0xFF14532d) else Color(0xFF78350f)
                    )
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(order.collectNo, fontWeight = FontWeight.Bold, color = Color.White)
                        Text(
                            "${order.workOrderCode} · ${order.lineCode} · ${order.status} · $done/${state.lines.size} 已完成",
                            fontSize = 13.sp, color = Color.White
                        )
                        if (order.status == "COLLECTED")
                            Text("已全部收集，待产线领走", fontSize = 12.sp, color = Color(0xFF86efac))
                        if (order.status == "ISSUED")
                            Text("产线已领走 ✓", fontSize = 12.sp, color = Color(0xFF4ade80))
                    }
                }
                if (pending > 0) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                scanLauncher.launch(Intent(context, NativeQrScannerActivity::class.java))
                            },
                            enabled = !state.busy,
                            modifier = Modifier.weight(0.35f)
                        ) {
                            Icon(Icons.Default.CameraAlt, contentDescription = "scan", Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("扫箱跳料")
                        }
                        // One-tap take-all lives on the picking PDA only —
                        // collection must be confirmed line by line.
                        if (!viewModel.collectMode) {
                            Button(
                                onClick = { viewModel.confirmAllDomain() },
                                enabled = !state.busy,
                                modifier = Modifier.weight(0.65f),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF16a34a))
                            ) {
                                Text("一键领取全部已集齐（${pending} 项）✓", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                // 集料员 stages PENDING (+flags 缺料); 领料员 takes staged
                // COLLECTED lines live as the warehouse finishes them.
                val visibleLines = state.lines.filter {
                    if (viewModel.collectMode) it.status == "PENDING" || it.status == "NO_MATERIAL"
                    else it.status == "COLLECTED"
                }
                if (visibleLines.isEmpty() && state.lines.isNotEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                if (viewModel.collectMode) "本段物料已全部取完 ✓" else "本单已集齐物料已全部领走 ✓",
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF4ade80)
                            )
                            Spacer(Modifier.height(12.dp))
                            Button(
                                onClick = { viewModel.reset() },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF16a34a))
                            ) {
                                Text("确认领取完成，返回工单列表", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(visibleLines, key = { it.id }) { line ->
                            val highlighted = state.highlightLineId == line.id
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(
                                    containerColor = if (highlighted) Color(0xFF1e3a5f)
                                        else MaterialTheme.colorScheme.surface
                                ),
                                border = if (highlighted) BorderStroke(2.dp, Color(0xFF38bdf8)) else null
                            ) {
                                Row(
                                    Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.PendingActions, contentDescription = "pending",
                                        tint = if (line.status == "NO_MATERIAL") Color(0xFFdc2626) else Color(0xFFd97706)
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Column(Modifier.weight(1f)) {
                                        // Collection status: 待集料 / 缺料 (collected lines leave the list).
                                        Text(
                                            when (line.status) {
                                                "NO_MATERIAL" -> "缺料"
                                                "COLLECTED" -> if (viewModel.collectMode) "已收集" else "已集齐·待取"
                                                "ISSUED" -> "已发出"
                                                else -> "待集料"
                                            },
                                            fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                            color = when (line.status) {
                                                "NO_MATERIAL" -> Color(0xFFdc2626)
                                                "COLLECTED", "ISSUED" -> Color(0xFF16a34a)
                                                else -> Color(0xFFd97706)
                                            }
                                        )
                                        Text("${line.materialCode}${line.materialName.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""}",
                                            fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                        Text("Lot: ${line.lotNo.ifBlank { "—" }}", fontSize = 12.sp)
                                        Text("需取数量: ${line.requiredQty}",
                                            fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Color(0xFFfbbf24))
                                        Text("位置: ${line.locationQr.ifBlank { line.locationCode.ifBlank { "—" } }}",
                                            fontSize = 12.sp, color = Color(0xFF0e7490))
                                        val stageLabel = when (line.processDomain) {
                                            "SMT" -> "贴片段"
                                            "MANUAL" -> "插件段·插料"
                                            "AUTO" -> "AI/组装段"
                                            "PACKAGING" -> "包装段"
                                            "AUX" -> "辅料"
                                            else -> line.processStage?.takeIf { it.isNotBlank() } ?: ""
                                        }
                                        if (stageLabel.isNotBlank()) {
                                            Text(stageLabel, fontSize = 11.sp,
                                                color = when (line.processDomain) {
                                                    "SMT" -> Color(0xFF2563eb)
                                                    "MANUAL" -> Color(0xFF16a34a)
                                                    "AUTO" -> Color(0xFF7c3aed)
                                                    else -> Color(0xFF94a3b8)
                                                })
                                        }
                                        if (viewModel.collectMode && line.assignedTo.isNotBlank()) {
                                            val mine = line.assignedTo.equals(
                                                viewModel.currentUserForDisplay, ignoreCase = true)
                                            Text(
                                                if (mine) "分派给我 ✓" else "他人任务: ${line.assignedTo}",
                                                fontSize = 11.sp,
                                                color = if (mine) Color(0xFF4ade80) else Color(0xFFf87171)
                                            )
                                        }
                                    }
                                    // Kitting: only my own (or unassigned) lines are tappable.
                                    // Picking: every staged line may be taken by any line PDA.
                                    val mine = !viewModel.collectMode ||
                                        line.assignedTo.isBlank() ||
                                        line.assignedTo.equals(
                                            viewModel.currentUserForDisplay, ignoreCase = true)
                                    Column(
                                        horizontalAlignment = Alignment.End,
                                        modifier = Modifier.padding(start = 8.dp)
                                    ) {
                                        Button(
                                            onClick = { viewModel.confirmLine(line.id) },
                                            enabled = !state.busy && mine
                                        ) { Text(if (!mine) "非我任务" else if (viewModel.collectMode) "确认取料" else "确认领取") }
                                        if (mine && viewModel.collectMode && line.status == "PENDING") {
                                            OutlinedButton(
                                                onClick = { viewModel.markNoMaterial(line.id) },
                                                enabled = !state.busy,
                                                border = BorderStroke(1.dp, Color(0xFFdc2626)),
                                                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFdc2626))
                                            ) { Text("缺料", fontSize = 12.sp) }
                                        }
                                        // Claim a line for this PDA (who takes what is recorded).
                                        if (viewModel.collectMode && line.status == "PENDING" && line.assignedTo.isBlank()) {
                                            OutlinedButton(
                                                onClick = { viewModel.claimLine(line.id) },
                                                enabled = !state.busy,
                                                border = BorderStroke(1.dp, Color(0xFF2563eb)),
                                                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF2563eb))
                                            ) { Text("认领", fontSize = 12.sp) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ── Alarm dialog: scanned material is not on this collect list ──
    state.alarm?.let { alarmText ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissAlarm() },
            containerColor = Color(0xFF7f1d1d),
            titleContentColor = Color.White,
            textContentColor = Color.White,
            title = { Text("⚠ 料号不在本单", fontWeight = FontWeight.Bold) },
            text = {
                Text(alarmText, color = Color.White, fontSize = 15.sp)
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.dismissAlarm() },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFdc2626))
                ) { Text("知道了", color = Color.White, fontWeight = FontWeight.Bold) }
            }
        )
    }
}
