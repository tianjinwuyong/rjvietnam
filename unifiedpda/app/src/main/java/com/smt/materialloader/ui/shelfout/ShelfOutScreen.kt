package com.smt.materialloader.ui.shelfout

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.R
import com.smt.materialloader.data.api.dto.ShelfCell
import com.smt.materialloader.ui.components.StepIndicator
import com.smt.materialloader.ui.components.Step

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShelfOutScreen(
    viewModel: ShelfOutViewModel = viewModel(),
    shelfCode: String,
    cell: ShelfCell,
    onBack: () -> Unit,
    onDone: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(cell) {
        viewModel.initWithCell(cell)
    }

    LaunchedEffect(state.error) {
        state.error?.let { snackbarHostState.showSnackbar(it) }
    }

    val steps = listOf(
        Step(stringResource(R.string.shelf_out_step1)),
        Step(stringResource(R.string.shelf_out_step2)),
        Step(stringResource(R.string.shelf_out_step3))
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.shelf_out), fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = {
                        if (state.step == ShelfOutStep.CONFIRM_CELL) onBack() else viewModel.prevStep()
                    }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF1e293b),
                    titleContentColor = Color(0xFFf1f5f9),
                    navigationIconContentColor = Color(0xFFf1f5f9)
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Color(0xFF0f172a))
        ) {
            StepIndicator(
                steps = steps,
                currentStep = state.step.ordinal,
                modifier = Modifier.background(Color(0xFF1e293b))
            )

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                when (state.step) {
                    ShelfOutStep.CONFIRM_CELL -> Step0Confirm(cell, state, viewModel)
                    ShelfOutStep.SCAN_WO -> Step1WorkOrder(state, viewModel)
                    ShelfOutStep.REVIEW_EXECUTE -> Step2Review(cell, state, viewModel, shelfCode, cell)
                    ShelfOutStep.SUCCESS -> SuccessView(state, onDone)
                }
            }
        }
    }
}

@Composable
private fun Step0Confirm(cell: ShelfCell, state: ShelfOutUiState, viewModel: ShelfOutViewModel) {
    Text(stringResource(R.string.shelf_out_step1_title), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFFf1f5f9))
    Spacer(modifier = Modifier.height(8.dp))
    Text(stringResource(R.string.shelf_out_step1_desc), fontSize = 13.sp, color = Color(0xFF64748b))
    Spacer(modifier = Modifier.height(16.dp))

    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFF1e293b))) {
        Column(modifier = Modifier.padding(16.dp)) {
            ReviewRow(stringResource(R.string.shelf_out_review_material), cell.materialCode ?: "—")
            ReviewRow(stringResource(R.string.shelf_out_review_lot), cell.lotNo ?: "—")
            ReviewRow(stringResource(R.string.history_label), cell.labelId ?: "—")
            ReviewRow(stringResource(R.string.common_location), cell.cellLabel)
        }
    }

    Spacer(modifier = Modifier.height(16.dp))

    OutlinedTextField(
        value = state.pickQty,
        onValueChange = viewModel::onPickQtyChanged,
        label = { Text(stringResource(R.string.shelf_out_pick_qty)) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = Modifier.fillMaxWidth(),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Color(0xFF3b82f6),
            unfocusedBorderColor = Color(0xFF334155),
            focusedTextColor = Color(0xFFf1f5f9),
            unfocusedTextColor = Color(0xFFf1f5f9)
        )
    )

    Spacer(modifier = Modifier.height(16.dp))

    Button(
        onClick = { viewModel.nextStep() },
        enabled = (state.pickQty.toIntOrNull() ?: 0) > 0,
        modifier = Modifier.fillMaxWidth().height(50.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3b82f6))
    ) {
        Text(stringResource(R.string.common_next), fontSize = 16.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Step1WorkOrder(state: ShelfOutUiState, viewModel: ShelfOutViewModel) {
    Text(stringResource(R.string.shelf_out_step2_title), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFFf1f5f9))
    Spacer(modifier = Modifier.height(8.dp))
    Text(stringResource(R.string.shelf_out_step2_desc), fontSize = 13.sp, color = Color(0xFF64748b))
    Spacer(modifier = Modifier.height(16.dp))

    OutlinedTextField(
        value = state.workOrderCode,
        onValueChange = viewModel::onWorkOrderScanned,
        label = { Text(stringResource(R.string.shelf_out_work_order)) },
        placeholder = { Text(stringResource(R.string.shelf_out_wo_placeholder)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Color(0xFF3b82f6),
            unfocusedBorderColor = Color(0xFF334155),
            focusedTextColor = Color(0xFFf1f5f9),
            unfocusedTextColor = Color(0xFFf1f5f9)
        )
    )

    Spacer(modifier = Modifier.height(16.dp))

    Button(
        onClick = { viewModel.nextStep() },
        modifier = Modifier.fillMaxWidth().height(50.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3b82f6))
    ) {
        Text(stringResource(R.string.common_next), fontSize = 16.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Step2Review(
    cell: ShelfCell,
    state: ShelfOutUiState,
    viewModel: ShelfOutViewModel,
    shelfCode: String,
    cellObj: ShelfCell
) {
    Text(stringResource(R.string.shelf_out_step3_title), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFFf1f5f9))
    Spacer(modifier = Modifier.height(8.dp))
    Text(stringResource(R.string.shelf_out_step3_desc), fontSize = 13.sp, color = Color(0xFF64748b))
    Spacer(modifier = Modifier.height(16.dp))

    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFF1e293b))) {
        Column(modifier = Modifier.padding(16.dp)) {
            ReviewRow(stringResource(R.string.shelf_out_review_shelf), shelfCode)
            ReviewRow(stringResource(R.string.shelf_out_review_cell), cell.cellLabel)
            ReviewRow(stringResource(R.string.shelf_out_review_material), cell.materialCode ?: "—")
            ReviewRow(stringResource(R.string.shelf_out_review_pick_qty), state.pickQty)
            if (state.workOrderCode.isNotBlank()) {
                ReviewRow(stringResource(R.string.shelf_out_review_wo), state.workOrderCode)
            }
        }
    }

    // Light indicator
    Spacer(modifier = Modifier.height(12.dp))
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (state.lightOn) Color(0xFF1e3a5f) else Color(0xFF1e293b)
        )
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Lightbulb,
                contentDescription = null,
                tint = if (state.lightOn) Color(0xFF60a5fa) else Color(0xFF64748b)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = if (state.lightOn) stringResource(R.string.shelf_out_light_on) else stringResource(R.string.shelf_out_light_pending),
                color = Color(0xFF94a3b8),
                fontSize = 14.sp
            )
        }
    }

    if (state.resultMessage != null) {
        Spacer(modifier = Modifier.height(16.dp))
        Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color(0xFF064e3b))) {
            Text("✓ ${state.resultMessage}", color = Color(0xFF34d399), fontWeight = FontWeight.Bold, modifier = Modifier.padding(16.dp))
        }
    }

    Spacer(modifier = Modifier.height(16.dp))

    Button(
        onClick = { viewModel.execute(shelfCode, cellObj) },
        enabled = !state.isLoading,
        modifier = Modifier.fillMaxWidth().height(50.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3b82f6))
    ) {
        if (state.isLoading) {
            CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
        } else {
            Text(stringResource(R.string.shelf_out_execute), fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun SuccessView(state: ShelfOutUiState, onDone: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("✓", fontSize = 64.sp, color = Color(0xFF22c55e))
        Spacer(modifier = Modifier.height(16.dp))
        Text(stringResource(R.string.shelf_out_success), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color(0xFF22c55e))
        Spacer(modifier = Modifier.height(32.dp))
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth().height(52.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22c55e))) {
            Text(stringResource(R.string.done), fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 14.sp, color = Color(0xFF94a3b8))
        Text(value, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFf1f5f9))
    }
}