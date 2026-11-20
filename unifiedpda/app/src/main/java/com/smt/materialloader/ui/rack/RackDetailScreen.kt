package com.smt.materialloader.ui.rack

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.R
import com.smt.materialloader.data.api.dto.ShelfConnectionStatus
import com.smt.materialloader.ui.components.CellGrid
import com.smt.materialloader.ui.components.StatusBadge
import com.smt.materialloader.ui.components.connectionStatusToTone

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RackDetailScreen(
    viewModel: RackDetailViewModel = viewModel(),
    shelfCode: String,
    onBack: () -> Unit,
    onCellPress: (cell: com.smt.materialloader.data.api.dto.ShelfCell) -> Unit
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(shelfCode) {
        viewModel.loadShelf(shelfCode)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(shelfCode, fontWeight = FontWeight.Bold, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                        state.shelf?.let { shelf ->
                            StatusBadge(
                                label = when (shelf.connectionStatus) {
                                    ShelfConnectionStatus.ONLINE -> stringResource(R.string.rack_online)
                                    ShelfConnectionStatus.OFFLINE -> stringResource(R.string.rack_offline)
                                    ShelfConnectionStatus.FAULT -> stringResource(R.string.rack_fault)
                                },
                                tone = connectionStatusToTone(shelf.connectionStatus),
                                compact = true
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.lightOn(shelfCode) }) {
                        Icon(Icons.Default.Lightbulb, contentDescription = stringResource(R.string.rack_light_on))
                    }
                    IconButton(onClick = { viewModel.lightOff(shelfCode) }) {
                        Icon(Icons.Default.Lightbulb, contentDescription = stringResource(R.string.rack_light_off))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF1e293b),
                    titleContentColor = Color(0xFFf1f5f9),
                    navigationIconContentColor = Color(0xFFf1f5f9),
                    actionIconContentColor = Color(0xFFf1f5f9)
                )
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Color(0xFF0f172a))
        ) {
            when {
                state.isLoading -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Color(0xFF3b82f6))
                    }
                }
                state.error != null -> {
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text(state.error ?: "", color = Color(0xFFfca5a5), fontSize = 16.sp)
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { viewModel.loadShelf(shelfCode) }) {
                            Text(stringResource(R.string.retry))
                        }
                    }
                }
                else -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                    ) {
                        // Quick stats
                        state.shelf?.let { shelf ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFF1e293b))
                                    .padding(horizontal = 20.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceEvenly
                            ) {
                                StatItem(stringResource(R.string.rack_occupied), shelf.occupiedCount.toString(), Color(0xFF22c55e))
                                StatItem(stringResource(R.string.rack_empty), shelf.emptyCount.toString(), Color(0xFF94a3b8))
                                StatItem(stringResource(R.string.rack_total), shelf.totalCells.toString(), Color(0xFFf1f5f9))
                            }
                        }

                        // Cell grid
                        CellGrid(
                            cells = state.cells,
                            shelfCode = shelfCode,
                            onCellPress = onCellPress,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatItem(label: String, value: String, valueColor: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text = value, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = valueColor)
        Text(text = label, fontSize = 13.sp, color = Color(0xFF94a3b8))
    }
}