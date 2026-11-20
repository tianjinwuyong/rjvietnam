package com.smt.materialloader.ui.document

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smt.materialloader.data.api.dto.DocDto

val STATUS_COLORS = mapOf(
    "DRAFT" to Color(0xFF95A5A6),
    "SUBMITTED" to Color(0xFF3498DB),
    "APPROVED" to Color(0xFF27AE60),
    "EXECUTING" to Color(0xFFF39C12),
    "COMPLETED" to Color(0xFF2ECC71),
    "REJECTED" to Color(0xFFE74C3C),
    "CANCELLED" to Color(0xFF7F8C8D)
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocListScreen(
    title: String,
    items: List<DocDto>,
    isLoading: Boolean,
    error: String?,
    filterStatus: String,
    onFilterChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onAction: (Long, String) -> Unit,
    onDelete: ((Long) -> Unit)? = null,
    onItemClick: ((Long) -> Unit)? = null,
    extraColumn: (@Composable (DocDto) -> Unit)? = null,
    onCreateNew: (() -> Unit)? = null
) {
    var showError by remember { mutableStateOf(false) }

    LaunchedEffect(error) { if (error != null) showError = true }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, fontWeight = FontWeight.Bold) },
                actions = {
                    if (onCreateNew != null) {
                        IconButton(onClick = onCreateNew) {
                            Icon(Icons.Default.Add, contentDescription = "新建", tint = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            )
        }
    ) { pad ->
        Column(modifier = Modifier.fillMaxSize().padding(pad).padding(horizontal = 16.dp)) {
            // Status filter chips
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 12.dp)) {
                listOf("" to "全部", "DRAFT" to "草稿", "SUBMITTED" to "已提交",
                    "APPROVED" to "已批准", "EXECUTING" to "执行中", "COMPLETED" to "已完成").forEach { (value, label) ->
                    FilterChip(
                        selected = filterStatus == value,
                        onClick = { onFilterChange(value) },
                        label = { Text(label, fontSize = 12.sp) }
                    )
                }
            }

            if (isLoading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(items) { item ->
                        DocListItem(
                            item = item,
                            onAction = { verb -> onAction(item.id, verb) },
                            onDelete = if (item.status == "DRAFT" && onDelete != null) {{ onDelete(item.id) }} else null,
                            extraColumn = extraColumn,
                            onItemClick = onItemClick
                        )
                    }
                    if (items.isEmpty()) {
                        item { Text("暂无数据", modifier = Modifier.padding(24.dp), color = Color.Gray) }
                    }
                }
            }
        }
    }

    if (showError && error != null) {
        AlertDialog(
            onDismissRequest = { showError = false },
            title = { Text("错误") },
            text = { Text(error) },
            confirmButton = { TextButton(onClick = { showError = false }) { Text("确定") } }
        )
    }
}

@Composable
fun DocListItem(
    item: DocDto,
    onAction: (String) -> Unit,
    onDelete: (() -> Unit)?,
    extraColumn: (@Composable (DocDto) -> Unit)? = null,
    onItemClick: ((Long) -> Unit)? = null
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (onItemClick != null) Modifier.clickable { onItemClick(item.id) } else Modifier),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(item.docNo, fontWeight = FontWeight.Medium, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                StatusBadge(item.status)
            }
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                item.workOrderCode?.let { Text("工单: $it", fontSize = 12.sp, color = Color.Gray) }
                item.supplierCode?.let { Text("供应商: $it", fontSize = 12.sp, color = Color.Gray) }
                item.requestorName?.let { Text("申请人: $it", fontSize = 12.sp, color = Color.Gray) }
            }
            extraColumn?.invoke(item)
            Spacer(Modifier.height(8.dp))
            ActionButtons(item.status, onAction, onDelete)
        }
    }
}

@Composable
fun StatusBadge(status: String) {
    val bg = STATUS_COLORS[status] ?: Color.Gray
    Surface(color = bg, shape = MaterialTheme.shapes.small) {
        Text(status, color = Color.White, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
}

@Composable
fun ActionButtons(status: String, onAction: (String) -> Unit, onDelete: (() -> Unit)?) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        when (status) {
            "DRAFT" -> {
                ActionButton("提交", Color(0xFF3498DB)) { onAction("submit") }
                onDelete?.let { ActionButton("删除", Color(0xFFE74C3C), true) { it() } }
            }
            "SUBMITTED" -> {
                if (listOf("INBOUND", "OUTBOUND", "REQUISITION", "REPLENISHMENT").any { true }) {
                    ActionButton("批准", Color(0xFF27AE60)) { onAction("approve") }
                    ActionButton("拒绝", Color(0xFFE74C3C)) { onAction("reject") }
                } else {
                    ActionButton("执行", Color(0xFFF39C12)) { onAction("execute") }
                }
            }
            "APPROVED" -> {
                ActionButton("执行", Color(0xFFF39C12)) { onAction("execute") }
            }
            "EXECUTING" -> {
                ActionButton("完成", Color(0xFF2ECC71)) { onAction("complete") }
            }
        }
    }
}

@Composable
fun ActionButton(label: String, color: Color, danger: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = color),
        modifier = Modifier.height(32.dp),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
    ) {
        Text(label, color = Color.White, fontSize = 12.sp)
    }
}
