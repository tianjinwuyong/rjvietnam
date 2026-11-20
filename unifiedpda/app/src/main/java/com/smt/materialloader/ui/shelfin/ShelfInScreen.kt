package com.smt.materialloader.ui.shelfin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
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
import com.smt.materialloader.ui.components.BarcodeScanner
import com.smt.materialloader.ui.components.StepIndicator
import com.smt.materialloader.ui.components.Step

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShelfInScreen(
    viewModel: ShelfInViewModel = viewModel(),
    shelfCode: String,
    cellNumber: String,
    cellLabel: String,
    onBack: () -> Unit,
    onDone: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.error) {
        state.error?.let { snackbarHostState.showSnackbar(it) }
    }

    val steps = listOf(
        Step(stringResource(R.string.shelf_in_step1)),
        Step(stringResource(R.string.shelf_in_step2)),
        Step(stringResource(R.string.shelf_in_step3))
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.shelf_in), fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = {
                        if (state.step == ShelfInStep.SCAN_LABEL) onBack() else viewModel.prevStep()
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
                    ShelfInStep.SCAN_LABEL -> Step0Label(state, viewModel)
                    ShelfInStep.SCAN_MATERIAL -> Step1Material(state, viewModel)
                    ShelfInStep.REVIEW -> Step2Review(state, viewModel, shelfCode, cellNumber)
                    ShelfInStep.SUCCESS -> SuccessView(state, onDone)
                }
            }
        }
    }
}

@Composable
private fun Step0Label(state: ShelfInUiState, viewModel: ShelfInViewModel) {
    Text(stringResource(R.string.shelf_in_step1_title), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFFf1f5f9))
    Spacer(modifier = Modifier.height(8.dp))
    Text(stringResource(R.string.shelf_in_step1_desc), fontSize = 13.sp, color = Color(0xFF64748b))
    Spacer(modifier = Modifier.height(16.dp))

    OutlinedTextField(
        value = state.labelId,
        onValueChange = { viewModel.onLabelScanned(it) },
        label = { Text(stringResource(R.string.shelf_in_label_id)) },
        placeholder = { Text(stringResource(R.string.shelf_in_label_placeholder)) },
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
        enabled = state.labelId.isNotBlank(),
        modifier = Modifier.fillMaxWidth().height(50.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3b82f6))
    ) {
        Text(stringResource(R.string.common_next), fontSize = 16.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Step1Material(state: ShelfInUiState, viewModel: ShelfInViewModel) {
    Text(stringResource(R.string.shelf_in_step2_title), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFFf1f5f9))
    Spacer(modifier = Modifier.height(8.dp))
    Text(stringResource(R.string.shelf_in_step2_desc), fontSize = 13.sp, color = Color(0xFF64748b))
    Spacer(modifier = Modifier.height(16.dp))

    OutlinedTextField(
        value = state.materialCode,
        onValueChange = viewModel::onMaterialCodeChanged,
        label = { Text(stringResource(R.string.material_code)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Color(0xFF3b82f6),
            unfocusedBorderColor = Color(0xFF334155),
            focusedTextColor = Color(0xFFf1f5f9),
            unfocusedTextColor = Color(0xFFf1f5f9)
        )
    )
    Spacer(modifier = Modifier.height(12.dp))

    OutlinedTextField(
        value = state.lotNo,
        onValueChange = viewModel::onLotNoChanged,
        label = { Text(stringResource(R.string.shelf_in_lot_no)) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Color(0xFF3b82f6),
            unfocusedBorderColor = Color(0xFF334155),
            focusedTextColor = Color(0xFFf1f5f9),
            unfocusedTextColor = Color(0xFFf1f5f9)
        )
    )
    Spacer(modifier = Modifier.height(12.dp))

    OutlinedTextField(
        value = state.qty,
        onValueChange = viewModel::onQtyChanged,
        label = { Text(stringResource(R.string.quantity)) },
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
        enabled = state.materialCode.isNotBlank() && state.lotNo.isNotBlank() && (state.qty.toIntOrNull() ?: 0) > 0,
        modifier = Modifier.fillMaxWidth().height(50.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3b82f6))
    ) {
        Text(stringResource(R.string.common_next), fontSize = 16.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Step2Review(
    state: ShelfInUiState,
    viewModel: ShelfInViewModel,
    shelfCode: String,
    cellNumber: String
) {
    Text(stringResource(R.string.shelf_in_step3_title), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFFf1f5f9))
    Spacer(modifier = Modifier.height(8.dp))
    Text(stringResource(R.string.shelf_in_step3_desc), fontSize = 13.sp, color = Color(0xFF64748b))
    Spacer(modifier = Modifier.height(16.dp))

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1e293b))
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            ReviewRow(stringResource(R.string.shelf_in_review_shelf), "$shelfCode · Cell $cellNumber")
            ReviewRow(stringResource(R.string.shelf_in_review_label), state.labelId)
            ReviewRow(stringResource(R.string.shelf_in_review_material), state.materialCode)
            ReviewRow(stringResource(R.string.shelf_in_review_lot), state.lotNo)
            ReviewRow(stringResource(R.string.shelf_in_review_qty), state.qty)
        }
    }

    if (state.resultMessage != null) {
        Spacer(modifier = Modifier.height(16.dp))
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF064e3b))
        ) {
            Text(
                text = "✓ ${state.resultMessage}",
                color = Color(0xFF34d399),
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(16.dp)
            )
        }
    }

    Spacer(modifier = Modifier.height(16.dp))

    Button(
        onClick = { viewModel.execute(shelfCode, cellNumber) },
        enabled = !state.isLoading,
        modifier = Modifier.fillMaxWidth().height(50.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3b82f6))
    ) {
        if (state.isLoading) {
            CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
        } else {
            Text(stringResource(R.string.shelf_in_execute), fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun SuccessView(state: ShelfInUiState, onDone: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(text = "✓", fontSize = 64.sp, color = Color(0xFF22c55e))
        Spacer(modifier = Modifier.height(16.dp))
        Text(stringResource(R.string.shelf_in_success), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Color(0xFF22c55e))
        Spacer(modifier = Modifier.height(32.dp))
        Button(
            onClick = onDone,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF22c55e))
        ) {
            Text(stringResource(R.string.done), fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, fontSize = 14.sp, color = Color(0xFF94a3b8))
        Text(value, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFf1f5f9))
    }
}