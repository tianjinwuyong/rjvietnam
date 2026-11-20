package com.smt.materialloader.ui.iqc

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.R
import com.smt.materialloader.ui.login.RuntimeRights

/**
 * IQC workspace. The queue, sampling plan and AQL verdict belong to WMS; the PDA
 * records evidence and decisions and re-reads the authoritative state afterwards.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IqcInspectionScreen(
    onHome: () -> Unit,
    onBack: () -> Unit,
    onLogout: () -> Unit,
    viewModel: IqcViewModel = viewModel()
) {
    val state by viewModel.state.collectAsState()
    val prefs = MaterialLoaderApp.instance.prefs
    val canSubmit = RuntimeRights.can(prefs, "iqc.result.submit")
    val actor = prefs.getUser()?.username.orEmpty()

    LaunchedEffect(Unit) { viewModel.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.iqc_title)) },
                actions = {
                    Text(
                        text = if (state.online) stringResource(R.string.iqc_online) else stringResource(R.string.iqc_offline),
                        color = if (state.online) Color(0xFF166534) else Color(0xFF991B1B),
                        modifier = Modifier.padding(end = 12.dp)
                    )
                }
            )
        },
        bottomBar = {
            BottomAppBar {
                TextButton(onClick = onHome, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.iqc_home)) }
                TextButton(onClick = { if (state.selected != null) viewModel.cancel() else onBack() }, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.iqc_back)) }
                TextButton(onClick = onLogout, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.iqc_logout)) }
            }
        }
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            state.error?.let { error ->
                item { Text(error, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold) }
            }
            state.message?.let { message ->
                item { Text(message, color = MaterialTheme.colorScheme.primary) }
            }
            state.verdict?.let { verdict ->
                item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(stringResource(R.string.iqc_verdict_title), style = MaterialTheme.typography.titleMedium)
                            Text(
                                text = when (verdict.result.lowercase()) {
                                    "pass" -> stringResource(R.string.iqc_verdict_pass)
                                    "conditional_pass" -> stringResource(R.string.iqc_verdict_conditional)
                                    else -> stringResource(R.string.iqc_verdict_fail)
                                },
                                color = if (verdict.result.lowercase() == "pass") Color(0xFF166534) else Color(0xFF991B1B),
                                fontWeight = FontWeight.Bold
                            )
                            Text(stringResource(R.string.iqc_verdict_counts, verdict.critical, verdict.major, verdict.minor))
                            Text(
                                text = if (verdict.supplierSynced == true) stringResource(R.string.iqc_supplier_synced)
                                else stringResource(R.string.iqc_supplier_pending, verdict.supplierError ?: "-"),
                                color = Color(0xFF475569)
                            )
                        }
                    }
                }
            }

            val inspection = state.inspection
            val selected = state.selected
            if (selected == null) {
                item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(stringResource(R.string.iqc_queue_title), style = MaterialTheme.typography.titleMedium)
                            Text(stringResource(R.string.iqc_queue_hint), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(stringResource(R.string.iqc_operator, actor))
                            Button(onClick = { viewModel.refresh() }, enabled = !state.loading, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                Text(stringResource(R.string.iqc_refresh))
                            }
                        }
                    }
                }
                if (state.queue.isEmpty()) {
                    item {
                        Text(
                            if (state.loading) stringResource(R.string.iqc_loading) else stringResource(R.string.iqc_queue_empty),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 16.dp)
                        )
                    }
                }
                itemsIndexed(state.queue) { _, incoming ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("${incoming.lotNo} · ${incoming.materialCode}", fontWeight = FontWeight.Bold)
                            Text(incoming.materialName)
                            Text(stringResource(R.string.iqc_receipt_meta, incoming.supplierCode, incoming.qty, incoming.receivedAt))
                            Button(
                                enabled = canSubmit && !state.starting && incoming.recordId.isNotBlank(),
                                onClick = { viewModel.start(incoming) },
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            ) { Text(stringResource(R.string.iqc_start)) }
                            if (!canSubmit) Text(stringResource(R.string.iqc_readonly), color = Color(0xFF9A3412))
                        }
                    }
                }
            } else {
                item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(stringResource(R.string.iqc_selected_lot, selected.lotNo), fontWeight = FontWeight.Bold)
                            Text(stringResource(R.string.iqc_receipt_meta, selected.supplierCode, selected.qty, selected.receivedAt))
                            if (inspection == null) {
                                Text(
                                    if (state.starting) stringResource(R.string.iqc_starting) else stringResource(R.string.iqc_start_hint),
                                    color = MaterialTheme.colorScheme.primary
                                )
                            } else {
                                Text(stringResource(R.string.iqc_document, inspection.inspectionNo.ifBlank { inspection.id }))
                                Text(stringResource(R.string.iqc_plan, inspection.sampleSize, inspection.aqlLevel))
                                Text(
                                    stringResource(
                                        R.string.iqc_limits,
                                        inspection.acCritical, inspection.reCritical,
                                        inspection.acMajor, inspection.reMajor,
                                        inspection.acMinor, inspection.reMinor
                                    )
                                )
                            }
                        }
                    }
                }
                itemsIndexed(IqcChecklist.items) { index, item ->
                    val decision = state.results[index]
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("${index + 1}. ${item.titleEn}", style = MaterialTheme.typography.titleSmall)
                            Text(item.checksZh.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    enabled = inspection != null && canSubmit && !state.submitting,
                                    onClick = { viewModel.setResult(index, true) },
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                                ) { Text(stringResource(R.string.iqc_pass)) }
                                Button(
                                    enabled = inspection != null && canSubmit && !state.submitting,
                                    onClick = { viewModel.setResult(index, false) },
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                                ) { Text(stringResource(R.string.iqc_fail)) }
                            }
                            when (decision) {
                                null -> Text(stringResource(R.string.iqc_pending), color = MaterialTheme.colorScheme.primary)
                                true -> Text(stringResource(R.string.iqc_marked_pass), color = Color(0xFF166534))
                                false -> {
                                    OutlinedTextField(
                                        value = (state.defectCounts[index] ?: 1).toString(),
                                        onValueChange = { raw -> viewModel.setDefectCount(index, raw.filter(Char::isDigit).toIntOrNull() ?: 1) },
                                        label = { Text(stringResource(R.string.iqc_defect_count)) },
                                        modifier = Modifier.fillMaxWidth(),
                                        singleLine = true
                                    )
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        listOf("critical", "major", "minor").forEach { severity ->
                                            FilterChip(
                                                selected = (state.severities[index] ?: "major") == severity,
                                                onClick = { viewModel.setSeverity(index, severity) },
                                                label = {
                                                    Text(
                                                        when (severity) {
                                                            "critical" -> stringResource(R.string.iqc_critical)
                                                            "minor" -> stringResource(R.string.iqc_minor)
                                                            else -> stringResource(R.string.iqc_major)
                                                        }
                                                    )
                                                }
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                item {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                stringResource(R.string.iqc_progress, state.results.size, IqcChecklist.items.size),
                                fontWeight = FontWeight.Bold
                            )
                            Button(
                                enabled = canSubmit && inspection != null && state.isComplete && !state.submitting,
                                onClick = { viewModel.submit() },
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            ) {
                                Text(if (state.submitting) stringResource(R.string.iqc_submitting) else stringResource(R.string.iqc_submit))
                            }
                            if (!canSubmit) Text(stringResource(R.string.iqc_readonly), color = Color(0xFF9A3412))
                        }
                    }
                }
            }
        }
    }
}
