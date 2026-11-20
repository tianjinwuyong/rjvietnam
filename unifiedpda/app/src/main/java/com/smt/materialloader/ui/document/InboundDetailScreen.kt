package com.smt.materialloader.ui.document

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.data.api.dto.DocLineDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboundDetailScreen(
    onBack: () -> Unit,
    docId: Long,
    onNavigateToEdit: (Long) -> Unit,
    onNavigateToList: () -> Unit,
    vm: DocDetailViewModel = viewModel()
) {
    val state by vm.state.collectAsState()
    var showConfirmDialog by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(docId) { vm.loadDoc(DocType.INBOUND, docId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("入库单详情", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            )
        }
    ) { pad ->
        Box(modifier = Modifier.fillMaxSize().padding(pad)) {
            when {
                state.isLoading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                state.error != null -> AlertDialog(onDismissRequest = { vm.clearError() }, title = { Text("错误") }, text = { Text(state.error!!) }, confirmButton = { TextButton(onClick = { vm.clearError() }) { Text("OK") } })
                state.doc != null -> {
                    val doc = state.doc!!
                    LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        // Header
                        item {
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Column(modifier = Modifier.padding(16.dp)) {
                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                        Text(doc.docNo, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, fontSize = 18.sp)
                                        StatusBadge(doc.status)
                                    }
                                    Spacer(Modifier.height(8.dp))
                                    doc.supplierCode?.let { Text("供应商: $it", fontSize = 14.sp, color = Color.Gray) }
                                    doc.workOrderCode?.let { Text("工单: $it", fontSize = 14.sp, color = Color.Gray) }
                                    Text("创建时间: ${doc.createdAt ?: "-"}", fontSize = 12.sp, color = Color.Gray)
                                }
                            }
                        }
                        // Lines header
                        item { Text("物料行", fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.padding(top = 8.dp)) }
                        if (doc.lines.isNullOrEmpty()) {
                            item { Text("无物料行", color = Color.Gray, modifier = Modifier.padding(16.dp)) }
                        } else {
                            items(doc.lines) { line ->
                                LineCard(line)
                            }
                        }
                        // Actions
                        item {
                            Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                when (doc.status) {
                                    "DRAFT" -> {
                                        ActionBtn("提交", Color(0xFF3498DB)) { showConfirmDialog = "submit" }
                                        ActionBtn("编辑", Color(0xFF1565C0)) { onNavigateToEdit(doc.id) }
                                        ActionBtn("删除", Color(0xFFE74C3C), true) { showConfirmDialog = "delete" }
                                    }
                                    "SUBMITTED" -> {
                                        ActionBtn("批准", Color(0xFF27AE60)) { showConfirmDialog = "approve" }
                                        ActionBtn("拒绝", Color(0xFFE74C3C), true) { showConfirmDialog = "reject" }
                                    }
                                    "APPROVED" -> {
                                        ActionBtn("执行", Color(0xFFF39C12)) { showConfirmDialog = "execute" }
                                    }
                                    "EXECUTING" -> {
                                        ActionBtn("完成", Color(0xFF2ECC71)) { showConfirmDialog = "complete" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showConfirmDialog != null) {
        val verb = showConfirmDialog!!
        val messages = mapOf("submit" to "提交此入库单？", "approve" to "批准此入库单？", "reject" to "拒绝此入库单？", "execute" to "执行此入库单？", "complete" to "完成此入库单？", "delete" to "删除此草稿单据？")
        AlertDialog(
            onDismissRequest = { showConfirmDialog = null },
            title = { Text("确认") },
            text = { Text(messages[verb] ?: "确定？") },
            confirmButton = { TextButton(onClick = {
                showConfirmDialog = null
                if (verb == "delete") {
                    vm.deleteDoc(DocType.INBOUND, docId, onNavigateToList)
                } else {
                    vm.doAction(DocType.INBOUND, docId, verb)
                }
            }) { Text("确定") } },
            dismissButton = { TextButton(onClick = { showConfirmDialog = null }) { Text("取消") } }
        )
    }

    state.successMessage?.let {
        LaunchedEffect(it) {
            vm.clearSuccess()
        }
    }
}

@Composable
fun LineCard(line: DocLineDto) {
    Card(modifier = Modifier.fillMaxWidth(), elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(line.materialCode ?: "-", fontWeight = FontWeight.Medium)
                line.lotNo?.let { Text("批号: $it", fontSize = 12.sp, color = Color.Gray) }
            }
            line.materialNameZh?.let { Text(it, fontSize = 12.sp, color = Color.Gray) }
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("需求: ${line.requestedQty ?: 0}", fontSize = 13.sp)
                Text("执行: ${line.executedQty ?: 0}", fontSize = 13.sp)
                line.unit?.let { Text("单位: $it", fontSize = 12.sp, color = Color.Gray) }
            }
            line.locationCode?.let { Text("库位: $it", fontSize = 12.sp, color = Color.Gray) }
            line.remarks?.let { if (it.isNotBlank()) Text("备注: $it", fontSize = 12.sp, color = Color.Gray) }
        }
    }
}

@Composable
fun ActionBtn(label: String, color: Color, danger: Boolean = false, onClick: () -> Unit) {
    Button(onClick = onClick, colors = ButtonDefaults.buttonColors(containerColor = color), modifier = Modifier.height(36.dp), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
        Text(label, color = Color.White, fontSize = 13.sp)
    }
}
