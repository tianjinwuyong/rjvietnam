package com.smt.materialloader.ui.query

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QueryScreen(
    viewModel: QueryViewModel = viewModel(),
    onBack: () -> Unit
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.query_title), fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.back))
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
                .padding(12.dp)
        ) {
            // Search bar
            OutlinedTextField(
                value = state.searchQuery,
                onValueChange = viewModel::onSearchQueryChanged,
                placeholder = { Text(stringResource(R.string.query_hint)) },
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                trailingIcon = {
                    if (state.searchQuery.isNotEmpty()) {
                        IconButton(onClick = { viewModel.onSearchQueryChanged("") }) {
                            Icon(Icons.Default.Clear, contentDescription = stringResource(R.string.query_search))
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Mode chips
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SearchMode.values().forEach { mode ->
                    FilterChip(
                        selected = state.searchMode == mode,
                        onClick = { viewModel.onSearchModeChanged(mode) },
                        label = {
                            Text(when (mode) {
                                SearchMode.LOT -> stringResource(R.string.search_mode_lot)
                                SearchMode.MATERIAL -> stringResource(R.string.search_mode_material)
                                SearchMode.WORK_ORDER -> stringResource(R.string.search_mode_wo)
                            })
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Content
            if (state.isLoading) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (state.results.isEmpty() && state.searchQuery.isNotBlank()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        stringResource(R.string.query_no_results),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 16.sp
                    )
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(state.results) { lot ->
                        LotResultCard(
                            lot = lot,
                            isExpanded = state.selectedLot?.id == lot.id,
                            isLoadingTx = state.isLoadingTransactions,
                            transactions = if (state.selectedLot?.id == lot.id) state.transactions else emptyList(),
                            onToggle = {
                                if (state.selectedLot?.id == lot.id) {
                                    viewModel.clearSelection()
                                } else {
                                    viewModel.selectLot(lot)
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun LotResultCard(
    lot: com.smt.materialloader.data.api.dto.MaterialLotDto,
    isExpanded: Boolean,
    isLoadingTx: Boolean,
    transactions: List<com.smt.materialloader.data.api.dto.InventoryTransactionDto>,
    onToggle: () -> Unit
) {
    val statusColor = when (lot.iqcStatus) {
        "released" -> Color(0xFF388E3C)
        "hold" -> Color(0xFFFFA000)
        "rejected" -> Color(0xFFD32F2F)
        else -> Color(0xFF9E9E9E)
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onToggle() },
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(lot.lotNo, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(
                        "${lot.materialCode} - ${lot.nameZh ?: ""}",
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Surface(
                        color = statusColor,
                        shape = MaterialTheme.shapes.small
                    ) {
                        Text(
                            text = lot.iqcStatus,
                            color = Color.White,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("Qty: ${lot.qty}", fontSize = 14.sp)
                }
            }

            // Transactions section
            AnimatedVisibility(visible = isExpanded) {
                Column(modifier = Modifier.padding(top = 8.dp)) {
                    HorizontalDivider()
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(stringResource(R.string.transaction_history), fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Spacer(modifier = Modifier.height(4.dp))
                    if (isLoadingTx) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    } else if (transactions.isEmpty()) {
                        Text(
                            stringResource(R.string.query_no_transactions),
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    } else {
                        transactions.forEach { tx ->
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(tx.action, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                                Text("${tx.qty}x", fontSize = 13.sp)
                                Text(tx.occurredAt?.take(10) ?: "", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}
