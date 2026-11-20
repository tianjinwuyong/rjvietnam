package com.smt.materialloader.ui.wolist

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.R
import com.smt.materialloader.data.api.dto.WorkOrderDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WoListScreen(
    viewModel: WoListViewModel = viewModel(),
    onBack: () -> Unit,
    onWoSelected: (String) -> Unit
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(state.selectedWoCode) {
        state.selectedWoCode?.let { code ->
            onWoSelected(code)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.wo_list_title), fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF1e293b),
                    titleContentColor = Color(0xFFf1f5f9),
                    navigationIconContentColor = Color(0xFFf1f5f9)
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(Color(0xFF0f172a))
        ) {
            // Search bar
            OutlinedTextField(
                value = state.searchQuery,
                onValueChange = viewModel::onSearchChanged,
                placeholder = { Text(stringResource(R.string.wo_list_search_hint)) },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = Color(0xFF64748b)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {}),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color(0xFF3b82f6),
                    unfocusedBorderColor = Color(0xFF334155),
                    focusedTextColor = Color(0xFFf1f5f9),
                    unfocusedTextColor = Color(0xFFf1f5f9),
                    cursorColor = Color(0xFF3b82f6)
                )
            )

            when {
                state.isLoading -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Color(0xFF3b82f6))
                    }
                }
                state.error != null -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(state.error ?: "", color = Color(0xFFfca5a5), fontSize = 16.sp)
                    }
                }
                state.filteredWos.isEmpty() -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(stringResource(R.string.wo_no_results), color = Color(0xFF64748b), fontSize = 16.sp)
                    }
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(state.filteredWos) { wo ->
                            WoCard(wo = wo, onClick = { viewModel.onWoSelected(wo) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WoCard(wo: WorkOrderDto, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1e293b))
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = wo.code,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = Color(0xFFf1f5f9),
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                )
                Surface(
                    color = when (wo.status) {
                        "released" -> Color(0xFF064e3b)
                        "in_progress" -> Color(0xFF1e3a5f)
                        else -> Color(0xFF334155)
                    },
                    shape = MaterialTheme.shapes.small
                ) {
                    Text(
                        text = wo.status,
                        fontSize = 11.sp,
                        color = Color(0xFFf1f5f9),
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = wo.productCode ?: "—",
                fontSize = 14.sp,
                color = Color(0xFF94a3b8)
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(
                    text = "${stringResource(R.string.common_location)}: ${wo.lineCode ?: "—"}",
                    fontSize = 13.sp,
                    color = Color(0xFF64748b)
                )
                Text(
                    text = "${stringResource(R.string.planned_qty)}: ${wo.plannedQty}",
                    fontSize = 13.sp,
                    color = Color(0xFF64748b)
                )
            }
            wo.productNameZh?.let {
                Spacer(modifier = Modifier.height(4.dp))
                Text(text = it, fontSize = 12.sp, color = Color(0xFF64748b))
            }
        }
    }
}