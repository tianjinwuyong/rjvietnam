package com.smt.materialloader.ui.count

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.R
import com.smt.materialloader.data.api.dto.CountAlertDto
import com.smt.materialloader.data.api.dto.CountItemDto
import com.smt.materialloader.data.api.dto.CountSessionDto
import com.smt.materialloader.ui.theme.AppColors

@Composable
fun CountScreen(onBack: () -> Unit, viewModel: CountViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    val focusManager = LocalFocusManager.current

    // Error snackbar
    state.error?.let { err ->
        LaunchedEffect(err) {
            kotlinx.coroutines.delay(3000)
            viewModel.clearError()
        }
    }

    // Auto-dismiss success
    LaunchedEffect(state.successMessage) {
        if (state.successMessage != null) {
            kotlinx.coroutines.delay(2000)
            viewModel.clearSuccess()
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Top bar
        CountTopBar(
            step = state.step,
            sessionCode = state.selectedSession?.sessionCode,
            onBack = {
                if (state.step == CountViewStep.SESSION_LIST) onBack()
                else viewModel.goBack()
            }
        )

        // Alert banner
        if (state.alerts.isNotEmpty() && state.step == CountViewStep.SESSION_LIST) {
            AlertBanner(alerts = state.alerts, onAck = viewModel::acknowledgeAlert)
        }

        // Success banner
        state.successMessage?.let { msg ->
            Box(modifier = Modifier.fillMaxWidth().background(AppColors.StatusOk).padding(12.dp),
                contentAlignment = Alignment.Center) {
                Text(msg, color = Color.White, fontWeight = FontWeight.Bold)
            }
        }

        Box(modifier = Modifier.fillMaxSize()) {
            when (state.step) {
                CountViewStep.SESSION_LIST -> SessionListView(
                    sessions = state.sessions,
                    isLoading = state.isLoading,
                    filterStatus = state.filterStatus,
                    onFilterChange = viewModel::loadSessions,
                    onSessionClick = viewModel::onSessionClick
                )
                CountViewStep.SESSION_DETAIL -> SessionDetailView(
                    session = state.selectedSession!!,
                    items = state.items,
                    isLoading = state.isLoading,
                    isSubmitting = state.isSubmitting,
                    onItemClick = viewModel::onItemClick,
                    onClaim = { viewModel.claimSession(state.selectedSession!!.id) },
                    onSubmit = viewModel::submitSession
                )
                CountViewStep.COUNT_ITEM -> CountItemView(
                    item = state.selectedItem!!,
                    input = state.countInput,
                    variance = state.variance,
                    variancePct = state.variancePct,
                    thresholdPct = state.selectedSession?.thresholdPct ?: 10,
                    isLoading = state.isLoading,
                    onInputChange = viewModel::onCountInputChanged,
                    onConfirm = viewModel::confirmCount,
                    onSkip = viewModel::skipCount,
                    focusManager = focusManager
                )
                CountViewStep.SUBMITTED -> SubmittedView(onBack = onBack)
            }

            // Loading overlay
            if (state.isLoading || state.isSubmitting) {
                Box(modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.3f)),
                    contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = AppColors.Primary)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CountTopBar(step: CountViewStep, sessionCode: String?, onBack: () -> Unit) {
    CenterAlignedTopAppBar(
        title = {
            Text(
                when (step) {
                    CountViewStep.SESSION_LIST -> stringResource(R.string.count_title)
                    CountViewStep.SESSION_DETAIL -> sessionCode ?: ""
                    CountViewStep.COUNT_ITEM -> stringResource(R.string.count_confirm_item)
                    CountViewStep.SUBMITTED -> stringResource(R.string.count_submitted)
                },
                color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp
            )
        },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, contentDescription = stringResource(R.string.common_back), tint = Color.White)
            }
        },
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = AppColors.Primary)
    )
}

@Composable
private fun AlertBanner(alerts: List<CountAlertDto>, onAck: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().background(Color(0xFF7B2D00)).padding(horizontal = 12.dp, vertical = 8.dp)) {
        alerts.take(3).forEach { alert ->
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Warning, contentDescription = null, tint = Color.Yellow, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text(alert.title, color = Color.White, fontSize = 12.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(stringResource(R.string.count_ack), color = Color.Yellow, fontSize = 11.sp,
                    modifier = Modifier.clickable { onAck(alert.id) }.padding(horizontal = 4.dp))
            }
        }
    }
}

@Composable
private fun SessionListView(
    sessions: List<CountSessionDto>,
    isLoading: Boolean,
    filterStatus: String,
    onFilterChange: (String?) -> Unit,
    onSessionClick: (CountSessionDto) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().background(AppColors.Background)) {
        // Filter tabs
        Row(modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("open" to stringResource(R.string.count_pending), "in_progress" to stringResource(R.string.count_in_progress),
                    "all" to stringResource(R.string.count_all)).forEach { (key, label) ->
                FilterChip(
                    selected = filterStatus == key,
                    label = { Text(label, fontSize = 12.sp) },
                    onClick = { onFilterChange(key) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = AppColors.Primary
                    )
                )
            }
        }

        if (isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = AppColors.Primary)
            }
        } else if (sessions.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = AppColors.StatusOk, modifier = Modifier.size(48.dp))
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(stringResource(R.string.count_no_pending), color = AppColors.TextSecondary)
                }
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(sessions) { session -> SessionCard(session = session, onClick = { onSessionClick(session) }) }
            }
        }
    }
}

@Composable
private fun SessionCard(session: CountSessionDto, onClick: () -> Unit) {
    val statusColor = when (session.status) {
        "open" -> Color(0xFFE65100)
        "in_progress" -> Color(0xFF1565C0)
        else -> AppColors.StatusOk
    }
    Card(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = AppColors.Surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(session.sessionCode, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = AppColors.TextPrimary)
                StatusBadge(status = session.status, color = statusColor)
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.LocationOn, contentDescription = null, tint = AppColors.TextSecondary, modifier = Modifier.size(14.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("${session.locationCode ?: "-"} / ${session.lotNo ?: "-"}", fontSize = 12.sp, color = AppColors.TextSecondary)
            }
            Spacer(modifier = Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Inventory, contentDescription = null, tint = AppColors.TextSecondary, modifier = Modifier.size(14.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("${session.materialCode ?: "-"} × ${session.systemQty ?: 0}", fontSize = 12.sp, color = AppColors.TextSecondary)
            }
            Spacer(modifier = Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val triggerLabel = if (session.triggerType == "INVENTORY_TX") (session.triggerAction ?: "库存变动") else "定时盘点"
                Icon(Icons.Default.Schedule, contentDescription = null, tint = AppColors.TextSecondary, modifier = Modifier.size(14.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text(triggerLabel, fontSize = 11.sp, color = AppColors.TextSecondary)
            }
        }
    }
}

@Composable
private fun StatusBadge(status: String, color: Color) {
    val label = when (status) {
        "open" -> "待处理"
        "in_progress" -> "盘点中"
        "completed" -> "已完成"
        else -> status
    }
    Box(modifier = Modifier.background(color.copy(alpha = 0.15f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
        Text(label, color = color, fontSize = 11.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun SessionDetailView(
    session: CountSessionDto,
    items: List<CountItemDto>,
    isLoading: Boolean,
    isSubmitting: Boolean,
    onItemClick: (CountItemDto) -> Unit,
    onClaim: () -> Unit,
    onSubmit: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().background(AppColors.Background)) {
        // Session info header
        Card(modifier = Modifier.fillMaxWidth().padding(12.dp),
            colors = CardDefaults.cardColors(containerColor = AppColors.Surface)) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column {
                        Text(session.sessionCode, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text("${session.locationCode ?: ""} / ${session.lotNo ?: ""}", fontSize = 12.sp, color = AppColors.TextSecondary)
                    }
                    StatusBadge(status = session.status, color = if (session.status == "open") Color(0xFFE65100) else Color(0xFF1565C0))
                }
                Spacer(modifier = Modifier.height(8.dp))
                Row {
                    Text("系统数量: ${session.systemQty ?: 0}", fontSize = 13.sp)
                    if (session.countedQty != null) {
                        Spacer(modifier = Modifier.width(16.dp))
                        Text("盘点数量: ${session.countedQty}", fontSize = 13.sp, color = AppColors.StatusOk)
                    }
                }
            }
        }

        // Claim button (if open)
        if (session.status == "open") {
            Button(
                onClick = onClaim,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AppColors.Primary)
            ) {
                Icon(Icons.Default.Assignment, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text(stringResource(R.string.count_claim))
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        // Items list
        LazyColumn(modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Text(stringResource(R.string.count_items), fontWeight = FontWeight.Bold, fontSize = 13.sp, color = AppColors.TextSecondary, modifier = Modifier.padding(vertical = 4.dp)) }
            items(items) { item -> CountItemCard(item = item, enabled = session.status == "in_progress", onClick = { onItemClick(item) }) }
        }

        // Submit button (if in_progress and all items counted)
        if (session.status == "in_progress" && items.isNotEmpty() && items.all { it.counted }) {
            Button(
                onClick = onSubmit,
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AppColors.StatusOk),
                enabled = !isSubmitting
            ) {
                if (isSubmitting) CircularProgressIndicator(color = Color.White, modifier = Modifier.size(20.dp))
                else { Icon(Icons.Default.CheckCircle, contentDescription = null); Spacer(modifier = Modifier.width(8.dp)) }
                Text(stringResource(R.string.count_submit))
            }
        }
    }
}

@Composable
private fun CountItemCard(item: CountItemDto, enabled: Boolean, onClick: () -> Unit) {
    val bgColor = if (item.counted) AppColors.Surface else AppColors.Surface.copy(alpha = 0.7f)
    Card(modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = bgColor),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)) {
        Row(modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            // Status icon
            Icon(
                if (item.counted) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked,
                contentDescription = null,
                tint = if (item.counted) AppColors.StatusOk else AppColors.TextSecondary,
                modifier = Modifier.size(22.dp)
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(item.materialCode ?: "-", fontWeight = FontWeight.Medium, fontSize = 14.sp)
                Text(item.lotNo ?: "-", fontSize = 11.sp, color = AppColors.TextSecondary)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("系统: ${item.systemQty}", fontSize = 12.sp, color = AppColors.TextSecondary)
                if (item.counted) {
                    val varColor = when {
                        item.variance == null || item.variance == 0 -> AppColors.StatusOk
                        Math.abs(item.variance) * 100 / Math.max(item.systemQty, 1) > 10 -> Color(0xFFE65100)
                        else -> Color(0xFFF9A825)
                    }
                    Text("实盘: ${item.countedQty}", fontSize = 12.sp, color = AppColors.StatusOk)
                    Text(
                        "${if ((item.variance ?: 0) >= 0) "+" else ""}${item.variance ?: 0}",
                        fontSize = 12.sp, color = varColor, fontWeight = FontWeight.Bold
                    )
                } else {
                    Text("待盘点", fontSize = 12.sp, color = AppColors.TextSecondary)
                }
            }
        }
    }
}

@Composable
private fun CountItemView(
    item: CountItemDto,
    input: String,
    variance: Int?,
    variancePct: Double?,
    thresholdPct: Int,
    isLoading: Boolean,
    onInputChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onSkip: () -> Unit,
    focusManager: androidx.compose.ui.focus.FocusManager
) {
    val isHighVariance = variancePct?.let { it > thresholdPct } ?: false
    val varColor = when {
        variance == null || variance == 0 -> AppColors.StatusOk
        isHighVariance -> Color(0xFFE65100)
        else -> Color(0xFFF9A825)
    }

    Column(modifier = Modifier.fillMaxSize().background(AppColors.Background).padding(16.dp)) {
        // Item info
        Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = AppColors.Surface)) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(item.materialCode ?: "-", fontWeight = FontWeight.Bold, fontSize = 20.sp)
                Text(item.lotNo ?: "-", fontSize = 14.sp, color = AppColors.TextSecondary)
                Spacer(modifier = Modifier.height(12.dp))
                Row {
                    Column {
                        Text(stringResource(R.string.count_system_qty), fontSize = 11.sp, color = AppColors.TextSecondary)
                        Text("${item.systemQty}", fontSize = 28.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(modifier = Modifier.width(32.dp))
                    Column {
                        Text(stringResource(R.string.count_threshold), fontSize = 11.sp, color = AppColors.TextSecondary)
                        Text("$thresholdPct%", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = AppColors.TextSecondary)
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Variance indicator
        if (variance != null) {
            Card(modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = varColor.copy(alpha = 0.1f))) {
                Row(modifier = Modifier.fillMaxWidth().padding(14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column {
                        Text(stringResource(R.string.count_variance), fontSize = 12.sp, color = AppColors.TextSecondary)
                        Text("${if (variance >= 0) "+" else ""}$variance", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = varColor)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(stringResource(R.string.count_variance_pct), fontSize = 12.sp, color = AppColors.TextSecondary)
                        Text("${if (variancePct != null) "%.1f%%".format(variancePct) else "-"}", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = varColor)
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Count input
        OutlinedTextField(
            value = input,
            onValueChange = onInputChange,
            label = { Text(stringResource(R.string.count_actual_qty)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onConfirm() }),
            modifier = Modifier.fillMaxWidth(),
            textStyle = LocalTextStyle.current.copy(fontSize = 28.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center),
            singleLine = true
        )

        Spacer(modifier = Modifier.weight(1f))

        // Action buttons
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = onSkip, modifier = Modifier.weight(1f)) {
                Text(stringResource(R.string.count_skip))
            }
            Button(
                onClick = {
                    focusManager.clearFocus()
                    onConfirm()
                },
                modifier = Modifier.weight(2f),
                colors = ButtonDefaults.buttonColors(containerColor = if (isHighVariance) Color(0xFFE65100) else AppColors.StatusOk),
                enabled = input.isNotBlank() && !isLoading
            ) {
                if (isLoading) CircularProgressIndicator(color = Color.White, modifier = Modifier.size(20.dp))
                else Text(stringResource(R.string.common_confirm))
            }
        }
    }
}

@Composable
private fun SubmittedView(onBack: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize().background(AppColors.Background), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = AppColors.StatusOk, modifier = Modifier.size(80.dp))
            Spacer(modifier = Modifier.height(16.dp))
            Text(stringResource(R.string.count_submitted), fontWeight = FontWeight.Bold, fontSize = 20.sp, color = AppColors.StatusOk)
            Spacer(modifier = Modifier.height(8.dp))
            Text(stringResource(R.string.count_submitted_desc), fontSize = 14.sp, color = AppColors.TextSecondary)
            Spacer(modifier = Modifier.height(24.dp))
            Button(onClick = onBack, colors = ButtonDefaults.buttonColors(containerColor = AppColors.Primary)) {
                Text(stringResource(R.string.common_back))
            }
        }
    }
}
