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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReturnSlipDetailScreen(
    onBack: () -> Unit,
    docId: Long,
    onNavigateToEdit: (Long) -> Unit,
    onNavigateToList: () -> Unit,
    vm: DocDetailViewModel = viewModel()
) {
    val state by vm.state.collectAsState()
    var showConfirmDialog by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(docId) { vm.loadDoc(DocType.RETURN, docId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("退库单详情", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") } },
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
                                    doc.requestorName?.let { Text("申请人: $it", fontSize = 14.sp, color = Color.Gray) }
                                    Text("创建时间: ${doc.createdAt ?: "-"}", fontSize = 12.sp, color = Color.Gray)
                                }
                            }
                        }
                        item { Text("物料行", fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.padding(top = 8.dp)) }
                        if (doc.lines.isNullOrEmpty()) { item { Text("无物料行", color = Color.Gray, modifier = Modifier.padding(16.dp)) } }
                        else { items(doc.lines) { line -> LineCard(line) } }
                        item {
                            Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                when (doc.status) {
                                    "DRAFT" -> {
                                        ActionBtn("提交", Color(0xFF3498DB)) { showConfirmDialog = "submit" }
                                        ActionBtn("编辑", Color(0xFF1565C0)) { onNavigateToEdit(doc.id) }
                                        ActionBtn("删除", Color(0xFFE74C3C), true) { showConfirmDialog = "delete" }
                                    }
                                    // RETURN SLIP: NO approve step — SUBMITTED → EXECUTING directly
                                    "SUBMITTED" -> {
                                        ActionBtn("执行", Color(0xFFF39C12)) { showConfirmDialog = "execute" }
                                        ActionBtn("拒绝", Color(0xFFE74C3C), true) { showConfirmDialog = "reject" }
                                    }
                                    "EXECUTING" -> { ActionBtn("完成", Color(0xFF2ECC71)) { showConfirmDialog = "complete" } }
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
        val messages = mapOf("submit" to "提交此退库单？", "reject" to "拒绝此退库单？", "execute" to "执行此退库单？", "complete" to "完成此退库单？", "delete" to "删除此草稿单据？")
        AlertDialog(onDismissRequest = { showConfirmDialog = null }, title = { Text("确认") }, text = { Text(messages[verb] ?: "确定？") }, confirmButton = { TextButton(onClick = { showConfirmDialog = null; if (verb == "delete") { vm.deleteDoc(DocType.RETURN, docId, onNavigateToList) } else { vm.doAction(DocType.RETURN, docId, verb) } }) { Text("确定") } }, dismissButton = { TextButton(onClick = { showConfirmDialog = null }) { Text("取消") } })
    }
}
