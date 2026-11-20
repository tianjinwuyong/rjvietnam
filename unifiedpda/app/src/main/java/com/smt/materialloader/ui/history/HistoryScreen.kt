package com.smt.materialloader.ui.history

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
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
import com.smt.materialloader.data.api.dto.ShelfAction
import com.smt.materialloader.data.api.dto.ShelfTransaction
import com.smt.materialloader.ui.components.StatusBadge
import com.smt.materialloader.ui.components.BadgeTone
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    viewModel: HistoryViewModel = viewModel(),
    onBack: () -> Unit
) {
    val state by viewModel.state.collectAsState()

    val filters = listOf(
        null to stringResource(R.string.history_filter_all),
        ShelfAction.SHELF_IN to stringResource(R.string.history_filter_in),
        ShelfAction.SHELF_OUT to stringResource(R.string.history_filter_out),
        ShelfAction.LIGHT_ON to stringResource(R.string.history_filter_light_on),
        ShelfAction.LIGHT_OFF to stringResource(R.string.history_filter_light_off),
        ShelfAction.LABEL_REMOVE to stringResource(R.string.history_filter_remove)
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.history_title), fontWeight = FontWeight.Bold) },
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
            // Filter chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF1e293b))
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                filters.forEach { (action, label) ->
                    val isActive = state.filter == action
                    Surface(
                        modifier = Modifier.clickable { viewModel.setFilter(action) },
                        color = if (isActive) Color(0xFF3b82f6) else Color(0xFF334155),
                        shape = MaterialTheme.shapes.small
                    ) {
                        Text(
                            text = label,
                            color = if (isActive) Color.White else Color(0xFF94a3b8),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                        )
                    }
                }
            }

            // List
            Box(modifier = Modifier.fillMaxSize()) {
                when {
                    state.isLoading -> {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Color(0xFF3b82f6))
                        }
                    }
                    state.transactions.isEmpty() -> {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(stringResource(R.string.history_no_transactions), color = Color(0xFF64748b), fontSize = 16.sp)
                        }
                    }
                    else -> {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            items(state.transactions) { tx ->
                                TransactionCard(tx)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TransactionCard(tx: ShelfTransaction) {
    val actionLabel = when (tx.action) {
        ShelfAction.SHELF_IN -> stringResource(R.string.history_filter_in)
        ShelfAction.SHELF_OUT -> stringResource(R.string.history_filter_out)
        ShelfAction.LIGHT_ON -> stringResource(R.string.history_filter_light_on)
        ShelfAction.LIGHT_OFF -> stringResource(R.string.history_filter_light_off)
        ShelfAction.LABEL_REMOVE -> stringResource(R.string.history_filter_remove)
    }
    val actionTone = when (tx.action) {
        ShelfAction.SHELF_IN -> BadgeTone.OK
        ShelfAction.SHELF_OUT -> BadgeTone.WARNING
        ShelfAction.LIGHT_ON -> BadgeTone.INFO
        ShelfAction.LIGHT_OFF -> BadgeTone.INFO
        ShelfAction.LABEL_REMOVE -> BadgeTone.WARNING
    }
    val resultLabel = if (tx.result == "OK") stringResource(R.string.status_pass) else stringResource(R.string.status_fail)
    val resultTone = if (tx.result == "OK") BadgeTone.OK else BadgeTone.DANGER

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1e293b))
    ) {
        Column {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                StatusBadge(label = actionLabel, tone = actionTone, compact = true)
                StatusBadge(label = resultLabel, tone = resultTone, compact = true)
            }
            // Body
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp)) {
                TxRow(stringResource(R.string.common_location), tx.shelfCode)
                tx.materialCode?.let { TxRow(stringResource(R.string.material_code), it) }
                tx.lotNo?.let { TxRow(stringResource(R.string.shelf_in_review_lot), it) }
                tx.qty?.let { TxRow(stringResource(R.string.quantity), it.toString()) }
                tx.labelId?.let { TxRow(stringResource(R.string.shelf_in_label_id), it) }
            }
            // Footer
            Row(
                modifier = Modifier.fillMaxWidth()
                    .background(Color(0xFF0f172a))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(formatTime(tx.occurredAt), fontSize = 11.sp, color = Color(0xFF64748b))
                Text(tx.operator, fontSize = 11.sp, color = Color(0xFF64748b))
            }
        }
    }
}

@Composable
private fun TxRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 13.sp, color = Color(0xFF64748b))
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Color(0xFFf1f5f9))
    }
}

private fun formatTime(iso: String): String {
    return try {
        val inFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
        val outFmt = SimpleDateFormat("dd/MM HH:mm", Locale.US)
        val d = inFmt.parse(iso.take(19))
        if (d != null) outFmt.format(d) else iso.take(16)
    } catch (e: Exception) {
        iso.take(16)
    }
}