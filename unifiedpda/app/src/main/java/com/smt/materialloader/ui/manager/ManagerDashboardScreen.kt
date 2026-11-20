package com.smt.materialloader.ui.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Rule
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material.icons.outlined.TrackChanges
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.R
import com.smt.materialloader.MaterialLoaderApp

private val Ink = Color(0xFFE9F0F7)
private val Muted = Color(0xFF9CAFC1)
private val Background = Color(0xFF07131F)
private val Panel = Color(0xFF102231)
private val PanelRaised = Color(0xFF152B3D)
private val Border = Color(0xFF274357)
private val Cyan = Color(0xFF28C6D6)
private val Green = Color(0xFF35D07F)
private val Amber = Color(0xFFFFB84D)
private val Red = Color(0xFFFF6675)

@Composable
fun ManagerDashboardScreen(
    allowedModules: Set<ManagerModule> = ManagerModule.values().toSet(),
    onLogout: () -> Unit,
    onNavigateToModule: (ManagerModule) -> Unit = {},
    onOpenCommand: () -> Unit = {},
    onOpenMaterial: () -> Unit = {},
    onOpenMesWeb: () -> Unit = {},
    showMesWeb: Boolean = false,
    viewModel: ManagerCockpitViewModel = viewModel()
) {
    val state by viewModel.state.collectAsState()
    var selectedTab by remember { mutableStateOf(0) }

    Column(Modifier.fillMaxSize().background(Background)) {
        TopBar(state = state, onRefresh = { viewModel.refreshNow() }, onLogout = onLogout)
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item { GreetingHeader() }
            item { ConnectionCard(state) }
            item {
                MetricRow(
                    critical = state.alerts.count { it.severity.equals("CRITICAL", true) },
                    overdue = state.openViolations,
                    online = state.manualPdasOnline,
                    onAlerts = { if (ManagerModule.ALERTS in allowedModules) { selectedTab = 1; onNavigateToModule(ManagerModule.ALERTS) } }
                )
            }
            if (ManagerModule.ALERTS in allowedModules) item {
                SectionHeader(stringResource(R.string.manager_now), stringResource(R.string.manager_open_alerts)) {
                    selectedTab = 1; onNavigateToModule(ManagerModule.ALERTS)
                }
            }
            if (state.loading && state.alerts.isEmpty()) {
                item { LoadingCard() }
            } else if (state.alerts.isEmpty()) {
                item { EmptyCard() }
            } else {
                items(state.alerts.take(5), key = { it.eventId }) { alert ->
                    AlertCard(alert, onOpen = { selectedTab = 1; onNavigateToModule(ManagerModule.ALERTS) })
                }
            }
            if (ManagerModule.LINE_STATUS in allowedModules) item {
                SectionHeader(stringResource(R.string.manager_line_status), stringResource(R.string.manager_open_line)) {
                    selectedTab = 2; onNavigateToModule(ManagerModule.LINE_STATUS)
                }
            }
            if (ManagerModule.LINE_STATUS in allowedModules) item { LineStatusCard(state, onOpen = { selectedTab = 2; onNavigateToModule(ManagerModule.LINE_STATUS) }) }
            item { QuickActions(
                showCommand = ManagerModule.HANDOVER in allowedModules,
                showDecisions = ManagerModule.DECISIONS in allowedModules,
                showTeam = ManagerModule.TEAM in allowedModules,
                showTargets = ManagerModule.TARGETS in allowedModules,
                showMaterial = ManagerModule.LOADING_STATUS in allowedModules,
                showMesWeb = showMesWeb,
                onCommand = onOpenCommand,
                onDecisions = { selectedTab = 3; onNavigateToModule(ManagerModule.DECISIONS) },
                onTeam = { selectedTab = 4; onNavigateToModule(ManagerModule.TEAM) },
                onTargets = { selectedTab = 5; onNavigateToModule(ManagerModule.TARGETS) },
                onMaterial = onOpenMaterial,
                onMesWeb = onOpenMesWeb
            ) }
        }
        BottomNav(allowedModules = allowedModules, selectedTab = selectedTab, onSelect = { module ->
            selectedTab = 1
            onNavigateToModule(module)
        })
    }
}

@Composable
private fun TopBar(state: ManagerCockpitState, onRefresh: () -> Unit, onLogout: () -> Unit) {
    val user = MaterialLoaderApp.instance.prefs.getUser()
    val role = user?.roleKey ?: "MANAGEMENT"
    val seniority = user?.seniority?.trim()?.uppercase().orEmpty()
    val tierLabel = when (seniority) {
        "SENIOR" -> "Senior Plant Manager"
        "JUNIOR" -> "Junior Plant Manager"
        else -> role
    }
    Row(
        Modifier.fillMaxWidth().background(Panel).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text("UNIFIED PDA MANAGEMENT SYSTEM", color = Cyan, fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            Text("$tierLabel cockpit", color = Ink, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            if (seniority.isNotBlank()) {
                Text("$role · $seniority · MES authority", color = Muted, fontSize = 11.sp)
            }
        }
        StatusDot(online = state.mesOnline)
        IconButton(onClick = onRefresh, modifier = Modifier.size(44.dp)) { Icon(Icons.Outlined.Refresh, "Refresh", tint = Ink) }
        TextButton(label = stringResource(R.string.manager_exit), onClick = onLogout)
    }
}

@Composable private fun GreetingHeader() {
    Column {
        Text("Good morning, manager", color = Ink, fontSize = 25.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.manager_scope), color = Muted, fontSize = 13.sp)
    }
}

@Composable
private fun ConnectionCard(state: ManagerCockpitState) {
    val healthy = state.mesOnline
    Surface(shape = RoundedCornerShape(16.dp), color = if (healthy) Color(0xFF0C342C) else Color(0xFF3A2025), tonalElevation = 0.dp) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusDot(healthy)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(if (healthy) stringResource(R.string.manager_mes_online) else stringResource(R.string.manager_mes_warning), color = if (healthy) Green else Red, fontWeight = FontWeight.Bold)
                Text(stringResource(R.string.manager_last_update, state.lastUpdated.ifBlank { "--" }), color = Muted, fontSize = 12.sp)
            }
            Text("L004", color = Ink, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun MetricRow(critical: Int, overdue: Int, online: Int, onAlerts: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        MetricCard("CRITICAL", critical.toString(), Red, Icons.Outlined.NotificationsActive, Modifier.weight(1f), onAlerts)
        MetricCard("OVERDUE", overdue.toString(), Amber, Icons.Outlined.Speed, Modifier.weight(1f), onAlerts)
        MetricCard("PDA ONLINE", online.toString(), Green, Icons.Outlined.Groups, Modifier.weight(1f), {})
    }
}

@Composable
private fun MetricCard(label: String, value: String, color: Color, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = modifier, shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, Border)) {
        Column(Modifier.padding(12.dp)) {
            Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
            Spacer(Modifier.height(8.dp))
            Text(value, color = Ink, fontSize = 25.sp, fontWeight = FontWeight.Bold)
            Text(label, color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun SectionHeader(title: String, action: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = Ink, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        TextButton(action, onClick)
    }
}

@Composable
private fun AlertCard(alert: ManagerAlert, onOpen: () -> Unit) {
    val critical = alert.severity.equals("CRITICAL", true)
    Card(onClick = onOpen, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = PanelRaised), border = androidx.compose.foundation.BorderStroke(1.dp, if (critical) Color(0xFF69343E) else Border)) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(if (critical) Red else Amber, RoundedCornerShape(8.dp)))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(alert.title, color = Ink, fontWeight = FontWeight.Bold)
                Text(alert.detail, color = Muted, fontSize = 12.sp, maxLines = 2)
                Text(alert.severity, color = if (critical) Red else Amber, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
            Icon(Icons.Outlined.ChevronRight, null, tint = Muted)
        }
    }
}

@Composable
private fun LineStatusCard(state: ManagerCockpitState, onOpen: () -> Unit) {
    Card(onClick = onOpen, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = Panel), border = androidx.compose.foundation.BorderStroke(1.dp, Border)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Speed, null, tint = Cyan, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) { Text("Manual Line L004", color = Ink, fontWeight = FontWeight.Bold); Text("Live station and material status", color = Muted, fontSize = 12.sp) }
                Text(if (state.mesOnline) "RUNNING" else "UNKNOWN", color = if (state.mesOnline) Green else Amber, fontWeight = FontWeight.Bold, fontSize = 11.sp)
            }
            LinearProgressIndicator(progress = { if (state.mesOnline) 0.72f else 0f }, modifier = Modifier.fillMaxWidth(), color = Cyan, trackColor = Border)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Material readiness", color = Muted, fontSize = 12.sp); Text(if (state.mesOnline) "72%" else "--", color = Ink, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun QuickActions(showCommand: Boolean, showDecisions: Boolean, showTeam: Boolean, showTargets: Boolean, showMaterial: Boolean, showMesWeb: Boolean, onCommand: () -> Unit, onDecisions: () -> Unit, onTeam: () -> Unit, onTargets: () -> Unit, onMaterial: () -> Unit, onMesWeb: () -> Unit) {
    Text("QUICK ACTIONS", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (showCommand) ActionChip("Command", Icons.Outlined.Rule, Modifier.weight(1f), onCommand)
        if (showDecisions) ActionChip("Decisions", Icons.Outlined.NotificationsActive, Modifier.weight(1f), onDecisions)
        if (showTeam) ActionChip("Team", Icons.Outlined.Groups, Modifier.weight(1f), onTeam)
        if (showTargets) ActionChip("Targets", Icons.Outlined.TrackChanges, Modifier.weight(1f), onTargets)
        if (showMaterial) ActionChip("物料上料\nMaterial", Icons.Outlined.Inventory2, Modifier.weight(1f), onMaterial)
        if (showMesWeb) ActionChip("MES Web", Icons.Outlined.Speed, Modifier.weight(1f), onMesWeb)
    }
}

@Composable
private fun ActionChip(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, modifier: Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = modifier.height(58.dp), shape = RoundedCornerShape(12.dp), colors = ButtonDefaults.buttonColors(containerColor = PanelRaised, contentColor = Ink), contentPadding = androidx.compose.foundation.layout.PaddingValues(4.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(icon, null, modifier = Modifier.size(18.dp)); Text(label, fontSize = 10.sp) }
    }
}

@Composable
private fun BottomNav(allowedModules: Set<ManagerModule>, selectedTab: Int, onSelect: (ManagerModule) -> Unit) {
    Surface(color = Panel, shadowElevation = 8.dp) {
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton("Home", { }, active = selectedTab == 0)
            allowedModules.filter { it in setOf(ManagerModule.ALERTS, ManagerModule.LINE_STATUS, ManagerModule.DECISIONS, ManagerModule.TEAM, ManagerModule.TARGETS) }.forEachIndexed { index, module ->
                val label = when (module) {
                    ManagerModule.ALERTS -> "Alerts"
                    ManagerModule.LINE_STATUS -> "Line"
                    ManagerModule.DECISIONS -> "Decisions"
                    ManagerModule.TEAM -> "Team"
                    ManagerModule.TARGETS -> "Targets"
                    else -> module.title
                }
                TextButton(label, { onSelect(module) }, active = selectedTab == index + 1)
            }
        }
    }
}

@Composable
private fun TextButton(label: String, onClick: () -> Unit, active: Boolean = false) {
    androidx.compose.material3.TextButton(onClick = onClick, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp)) {
        Text(label, color = if (active) Cyan else Muted, fontSize = 11.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Medium)
    }
}

@Composable private fun StatusDot(online: Boolean) { Box(Modifier.size(9.dp).background(if (online) Green else Red, RoundedCornerShape(9.dp))) }

@Composable private fun LoadingCard() { Card(colors = CardDefaults.cardColors(containerColor = Panel), modifier = Modifier.fillMaxWidth()) { Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(color = Cyan, modifier = Modifier.size(24.dp)); Spacer(Modifier.width(12.dp)); Text("Syncing MES status…", color = Muted) } } }

@Composable private fun EmptyCard() { Card(colors = CardDefaults.cardColors(containerColor = Panel), modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) { Text(stringResource(R.string.manager_no_violation), color = Green, fontWeight = FontWeight.Bold); Spacer(Modifier.height(4.dp)); Text(stringResource(R.string.manager_no_violation_detail), color = Muted, fontSize = 12.sp) } } }
