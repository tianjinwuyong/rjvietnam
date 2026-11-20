package com.smt.materialloader.ui.shortage

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * 缺料处理 (Shortage Handling) — warehouse manager page.
 * Lists every material code lacking stock (with qty, WO, slip, location,
 * reporter) for emergency handling; resolving requeues the line.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShortageScreen(
    viewModel: ShortageViewModel = viewModel(),
    onBack: () -> Unit,
    onLogout: () -> Unit = {}
) {
    val state by viewModel.state.collectAsState()
    val listState = rememberLazyListState()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("缺料处理 / Shortage Handling", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
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
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("缺料清单（WMS 实时）", fontWeight = FontWeight.Bold, fontSize = 15.sp,
                    modifier = Modifier.weight(1f))
                TextButton(onClick = { viewModel.load() }, enabled = !state.loading) {
                    Text("刷新")
                }
            }
            if (state.loading) {
                LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            }
            if (!state.loading && state.items.isEmpty()) {
                Column(
                    Modifier.fillMaxWidth().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("暂无缺料 ✓", fontSize = 16.sp, fontWeight = FontWeight.Bold,
                        color = Color(0xFF4ade80))
                    Text("集料员标记缺料后会实时出现在这里", fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                LazyColumn(state = listState, modifier = Modifier.weight(1f)) {
                    items(state.items, key = { it.lineId }) { item ->
                        Card(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                        ) {
                            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                                Text(item.materialCode, fontWeight = FontWeight.Bold, fontSize = 16.sp,
                                    color = Color(0xFFdc2626))
                                Text("缺料数量: ${item.qty}", fontWeight = FontWeight.Bold, fontSize = 15.sp,
                                    color = Color(0xFFfbbf24))
                                Text("${item.workOrderCode} · ${item.slipNo}", fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(
                                    "库位: ${item.locationQr.ifBlank { item.locationCode.ifBlank { "—" } }}" +
                                        (if (item.lotNo.isNotBlank()) " · Lot: ${item.lotNo}" else ""),
                                    fontSize = 12.sp, color = Color(0xFF0e7490)
                                )
                                Text("上报: ${item.markedBy} · ${item.markedAt}", fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Button(
                                    onClick = { viewModel.resolve(item.lineId) },
                                    enabled = state.busyId != item.lineId,
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF16a34a)),
                                    modifier = Modifier.padding(top = 6.dp)
                                ) {
                                    Text(
                                        if (state.busyId == item.lineId) "处理中…" else "✓ 已处理（重新集料）",
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
