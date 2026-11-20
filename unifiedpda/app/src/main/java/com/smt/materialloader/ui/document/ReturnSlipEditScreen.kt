package com.smt.materialloader.ui.document

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReturnSlipEditScreen(
    onBack: () -> Unit,
    editId: Long?,
    vm: DocEditViewModel = viewModel()
) {
    val state by vm.state.collectAsState()
    val isEdit = editId != null

    LaunchedEffect(Unit) { vm.init(DocType.RETURN, editId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (isEdit) "编辑退库单" else "新建退库单", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            )
        }
    ) { pad ->
        Box(modifier = Modifier.fillMaxSize().padding(pad)) {
            if (state.isLoading) { Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() } }
            else {
                LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item { OutlinedTextField(value = state.supplierCode, onValueChange = { vm.updateSupplierCode(it) }, label = { Text("供应商代码") }, modifier = Modifier.fillMaxWidth(), singleLine = true) }
                    item { OutlinedTextField(value = state.workOrderCode, onValueChange = { vm.updateWorkOrderCode(it) }, label = { Text("工单代码") }, modifier = Modifier.fillMaxWidth(), singleLine = true) }
                    item {
                        Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("物料行", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            TextButton(onClick = { vm.addLine() }) { Icon(Icons.Default.Add, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("添加行") }
                        }
                    }
                    itemsIndexed(state.lines) { index, line ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Text("行 ${index + 1}", fontWeight = FontWeight.Medium)
                                    if (state.lines.size > 1) { IconButton(onClick = { vm.removeLine(index) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.Delete, "删除", tint = Color.Red) } }
                                }
                                OutlinedTextField(value = line.materialCode, onValueChange = { vm.updateLine(index, line.copy(materialCode = it)) }, label = { Text("物料代码") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                                Spacer(Modifier.height(8.dp))
                                OutlinedTextField(value = line.qty, onValueChange = { vm.updateLine(index, line.copy(qty = it)) }, label = { Text("需求数量") }, modifier = Modifier.fillMaxWidth(), singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                                Spacer(Modifier.height(8.dp))
                                OutlinedTextField(value = line.remarks, onValueChange = { vm.updateLine(index, line.copy(remarks = it)) }, label = { Text("备注") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                            }
                        }
                    }
                    item { Spacer(Modifier.height(8.dp)); Button(onClick = { vm.save() }, modifier = Modifier.fillMaxWidth(), enabled = !state.isSaving) { if (state.isSaving) { CircularProgressIndicator(modifier = Modifier.size(20.dp), color = Color.White) } else { Text(if (isEdit) "保存修改" else "创建退库单") } } }
                }
            }
        }
    }
    state.error?.let { AlertDialog(onDismissRequest = { vm.clearError() }, title = { Text("错误") }, text = { Text(it) }, confirmButton = { TextButton(onClick = { vm.clearError() }) { Text("OK") } }) }
    state.successMessage?.let { LaunchedEffect(it) { onBack() } }
}
