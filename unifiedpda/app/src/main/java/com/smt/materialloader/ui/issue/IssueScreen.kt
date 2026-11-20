package com.smt.materialloader.ui.issue

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.R
import com.smt.materialloader.ui.components.BarcodeScanner

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssueScreen(
    viewModel: IssueViewModel = viewModel(),
    onBack: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.error) {
        state.error?.let { snackbarHostState.showSnackbar(it) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.issue_title), fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = {
                        if (state.step == IssueStep.SCAN_LOT) onBack() else viewModel.reset()
                    }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    navigationIconContentColor = MaterialTheme.colorScheme.onPrimary
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        when (state.step) {
            IssueStep.SCAN_LOT -> ScanStep(
                padding = padding,
                title = stringResource(R.string.issue_scan_lot),
                subtitle = stringResource(R.string.issue_scan_lot_sub),
                onBarcodeScanned = viewModel::onLotScanned,
                scannedInfo = state.scannedLot?.let {
                    "${stringResource(R.string.issue_lot_no)}: ${it.lotNo}\n${stringResource(R.string.material_code)}: ${it.materialCode}\n${stringResource(R.string.available_qty)}: ${it.availableQty}"
                }
            )
            IssueStep.SCAN_WO -> ScanStep(
                padding = padding,
                title = stringResource(R.string.issue_scan_wo),
                subtitle = stringResource(R.string.issue_scan_wo_sub),
                onBarcodeScanned = viewModel::onWorkOrderScanned,
                scannedInfo = state.scannedLot?.let {
                    "${stringResource(R.string.issue_lot_no)}: ${it.lotNo} | ${stringResource(R.string.material_code)}: ${it.materialCode}"
                }
            )
            IssueStep.SELECT_WO -> {
                // Shows dialog via state-driven overlay
                ScanStep(
                    padding = padding,
                    title = stringResource(R.string.issue_scan_wo),
                    subtitle = stringResource(R.string.issue_scan_wo_sub),
                    onBarcodeScanned = viewModel::onWorkOrderScanned,
                    scannedInfo = state.scannedLot?.let {
                        "${stringResource(R.string.issue_lot_no)}: ${it.lotNo} | ${stringResource(R.string.material_code)}: ${it.materialCode}"
                    }
                )
                if (state.matchedWos.isNotEmpty()) {
                    WoSelectDialog(
                        workOrders = state.matchedWos,
                        onSelect = viewModel::selectWorkOrder,
                        onDismiss = viewModel::cancelWoSelection
                    )
                }
            }
            IssueStep.INPUT_QTY -> InputQtyStep(
                padding = padding,
                state = state,
                onQtyChanged = viewModel::onQtyChanged,
                onConfirm = viewModel::confirmIssue
            )
            IssueStep.CONFIRM -> LoadingStep(padding)
            IssueStep.SIGN -> SignStep(
                padding = padding,
                state = state,
                onReceiverChanged = viewModel::onReceiverChanged,
                onSignConfirmed = viewModel::onSignConfirmed
            )
            IssueStep.SUCCESS -> SuccessStep(
                padding = padding,
                txNo = state.signedTxNo ?: state.txNo,
                onDone = { viewModel.reset() }
            )
        }
    }
}

@Composable
private fun ScanStep(
    padding: PaddingValues,
    title: String,
    subtitle: String,
    onBarcodeScanned: (String) -> Unit,
    scannedInfo: String?
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
    ) {
        if (scannedInfo != null) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            ) {
                Text(
                    text = scannedInfo,
                    modifier = Modifier.padding(12.dp),
                    fontSize = 14.sp
                )
            }
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = title,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = subtitle,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(16.dp))
                BarcodeScanner(
                    onBarcodeDetected = onBarcodeScanned,
                    onError = { }
                )
            }
        }
    }
}

@Composable
private fun InputQtyStep(
    padding: PaddingValues,
    state: IssueUiState,
    onQtyChanged: (String) -> Unit,
    onConfirm: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Lot info card
        state.scannedLot?.let { lot ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(stringResource(R.string.lot_info), fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Spacer(modifier = Modifier.height(8.dp))
                    InfoRow(stringResource(R.string.issue_lot_no), lot.lotNo)
                    InfoRow(stringResource(R.string.material_code), lot.materialCode)
                    InfoRow(stringResource(R.string.available_qty), "${lot.availableQty}")
                    InfoRow(stringResource(R.string.lot_status), lot.iqcStatus)
                }
            }
        }

        // WO info card
        state.scannedWo?.let { wo ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(stringResource(R.string.wo_info), fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Spacer(modifier = Modifier.height(8.dp))
                    InfoRow(stringResource(R.string.issue_work_order), wo.code)
                    InfoRow(stringResource(R.string.material_code), wo.productCode ?: "-")
                    InfoRow(stringResource(R.string.operator), wo.lineCode ?: "-")
                    InfoRow(stringResource(R.string.lot_status), wo.status)
                }
            }
        }

        // Qty input
        OutlinedTextField(
            value = state.qty,
            onValueChange = onQtyChanged,
            label = { Text(stringResource(R.string.issue_qty)) },
            singleLine = true,
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                keyboardType = KeyboardType.Number
            ),
            modifier = Modifier.fillMaxWidth()
        )

        Button(
            onClick = onConfirm,
            enabled = !state.isLoading,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary
            )
        ) {
            Text(stringResource(R.string.issue_confirm), fontSize = 18.sp)
        }
    }
}

@Composable
private fun LoadingStep(padding: PaddingValues) {
    Box(
        modifier = Modifier.fillMaxSize().padding(padding),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(modifier = Modifier.size(48.dp))
            Spacer(modifier = Modifier.height(16.dp))
            Text(stringResource(R.string.processing), fontSize = 16.sp)
        }
    }
}

@Composable
private fun SuccessStep(
    padding: PaddingValues,
    txNo: String?,
    onDone: () -> Unit
) {
    Box(
        modifier = Modifier.fillMaxSize().padding(padding),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp)
        ) {
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = stringResource(R.string.issue_success_title),
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(8.dp))
            txNo?.let {
                Text(
                    text = stringResource(R.string.transaction_no),
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = it,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
            }
            Spacer(modifier = Modifier.height(32.dp))
            Button(
                onClick = onDone,
                modifier = Modifier.fillMaxWidth().height(52.dp)
            ) {
                Text(stringResource(R.string.done), fontSize = 18.sp)
            }
        }
    }
}

@Composable
private fun SignStep(
    padding: PaddingValues,
    state: IssueUiState,
    onReceiverChanged: (String) -> Unit,
    onSignConfirmed: (String?) -> Unit
) {
    val paths = remember { mutableStateListOf<Path>() }
    val currentPath = remember { mutableStateOf(Path()) }
    var hasInk by remember { mutableStateOf(false) }
    val error = state.error
    val strokeColor = MaterialTheme.colorScheme.onSurface

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(stringResource(R.string.issue_sign_title), fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Spacer(modifier = Modifier.height(4.dp))
                Text(stringResource(R.string.issue_sign_sub), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(modifier = Modifier.height(8.dp))
                InfoRow(stringResource(R.string.issue_work_order), state.workOrderCode)
                InfoRow(stringResource(R.string.issue_lot_no), state.lotNo)
                InfoRow("${stringResource(R.string.issue_sign_issued)} · ${stringResource(R.string.issue_qty)}", state.qty)
            }
        }

        OutlinedTextField(
            value = state.receiverOperator,
            onValueChange = onReceiverChanged,
            label = { Text(stringResource(R.string.issue_sign_operator)) },
            placeholder = { Text(stringResource(R.string.issue_sign_operator_hint)) },
            singleLine = true,
            isError = error == "RECEIVER_REQUIRED",
            modifier = Modifier.fillMaxWidth()
        )

        Text(stringResource(R.string.issue_sign_pad_hint), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(220.dp),
            shape = MaterialTheme.shapes.medium,
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            color = MaterialTheme.colorScheme.surface
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectDragGestures(
                            onDragStart = { offset ->
                                val p = Path().apply { moveTo(offset.x, offset.y) }
                                currentPath.value = p
                                paths.add(p)
                                hasInk = true
                            },
                            onDrag = { change, dragAmount ->
                                change.consume()
                                val next = change.position
                                currentPath.value.lineTo(next.x, next.y)
                            }
                        )
                    }
            ) {
                Canvas(modifier = Modifier.fillMaxSize()) {
                    val stroke = Stroke(width = 5.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round)
                    paths.forEach { drawPath(it, strokeColor, style = stroke) }
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(
                onClick = { paths.clear(); hasInk = false },
                modifier = Modifier.weight(1f).height(52.dp)
            ) { Text(stringResource(R.string.issue_sign_clear)) }
            Button(
                onClick = { onSignConfirmed(if (hasInk) "strokes:${paths.size}" else null) },
                enabled = !state.isLoading && hasInk && state.receiverOperator.isNotBlank(),
                modifier = Modifier.weight(2f).height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
            ) { Text(stringResource(R.string.issue_sign_confirm), fontSize = 16.sp) }
        }
        if (error != null && error != "RECEIVER_REQUIRED") {
            Text(error, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(text = label, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text = value, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun WoSelectDialog(
    workOrders: List<com.smt.materialloader.data.api.dto.WorkOrderDto>,
    onSelect: (com.smt.materialloader.data.api.dto.WorkOrderDto) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = stringResource(R.string.wo_select_title),
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            if (workOrders.isEmpty()) {
                Text(stringResource(R.string.wo_no_results))
            } else {
                LazyColumn {
                    items(workOrders) { wo ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                                .clickable { onSelect(wo) },
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surfaceVariant
                            )
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(
                                    text = wo.code,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = wo.productCode ?: "-",
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Text(
                                        text = wo.lineCode ?: "-",
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "${stringResource(R.string.issue_qty)}: ${wo.plannedQty}",
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Surface(
                                        color = when (wo.status) {
                                            "released" -> androidx.compose.ui.graphics.Color(0xFF388E3C)
                                            "open" -> androidx.compose.ui.graphics.Color(0xFF1976D2)
                                            "in_progress" -> androidx.compose.ui.graphics.Color(0xFFF57C00)
                                            else -> androidx.compose.ui.graphics.Color(0xFF757575)
                                        },
                                        shape = MaterialTheme.shapes.small
                                    ) {
                                        Text(
                                            text = wo.status,
                                            fontSize = 11.sp,
                                            color = androidx.compose.ui.graphics.Color.White,
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        }
    )
}
