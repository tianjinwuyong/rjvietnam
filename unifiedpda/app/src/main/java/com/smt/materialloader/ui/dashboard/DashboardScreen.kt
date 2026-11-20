package com.smt.materialloader.ui.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.R
import com.smt.materialloader.ui.theme.AppColors

data class MenuItem(
    val title: String,
    val description: String,
    val icon: ImageVector,
    val onClick: () -> Unit,
    val accentColor: Color,
    val gradientColors: List<Color>
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    onNavigateToIssue: () -> Unit,
    onNavigateToReturn: () -> Unit,
    onNavigateToQuery: () -> Unit,
    onNavigateToRack: (String) -> Unit,
    onNavigateToShelfIn: (String, String, String) -> Unit,
    onNavigateToShelfOut: (String, String) -> Unit,
    onNavigateToHistory: () -> Unit,
    onNavigateToMaterialLoad: () -> Unit,
    onNavigateToWoList: () -> Unit,
    onNavigateToWoBind: () -> Unit,
    onNavigateToCount: () -> Unit,
    onNavigateToInbound: () -> Unit,
    onNavigateToOutbound: () -> Unit,
    onNavigateToRequisition: () -> Unit,
    onNavigateToReturnSlip: () -> Unit,
    onNavigateToReplenishment: () -> Unit,
    onLogout: () -> Unit
) {
    var showRackDialog by remember { mutableStateOf(false) }
    var rackInput by remember { mutableStateOf("") }
    val user = MaterialLoaderApp.instance.authRepository.getCurrentUser()
    val displayName = user?.displayName ?: stringResource(R.string.operator)

    val primary = AppColors.Primary
    val secondary = AppColors.Secondary
    val tertiary = AppColors.Tertiary
    val info = AppColors.StatusInfo

    val menuItems = listOf(
        MenuItem(
            title = stringResource(R.string.menu_pcb_loading),
            description = stringResource(R.string.menu_pcb_loading_desc),
            icon = Icons.Default.Upload,
            onClick = onNavigateToMaterialLoad,
            accentColor = Color(0xFF38BDF8),
            gradientColors = listOf(Color(0xFF0C4A6E), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_solder_paste),
            description = stringResource(R.string.menu_solder_paste_desc),
            icon = Icons.Default.Warning,
            onClick = onNavigateToMaterialLoad,
            accentColor = Color(0xFFF59E0B),
            gradientColors = listOf(Color(0xFF78350F), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_plugin_components),
            description = stringResource(R.string.menu_plugin_components_desc),
            icon = Icons.Default.Settings,
            onClick = onNavigateToMaterialLoad,
            accentColor = Color(0xFFA78BFA),
            gradientColors = listOf(Color(0xFF4C1D95), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_issue_to_line),
            description = stringResource(R.string.menu_issue_to_line_desc),
            icon = Icons.Default.Upload,
            onClick = onNavigateToIssue,
            accentColor = primary,
            gradientColors = listOf(Color(0xFF1E3A5F), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_return_from_line),
            description = stringResource(R.string.menu_return_from_line_desc),
            icon = Icons.Default.Download,
            onClick = onNavigateToReturn,
            accentColor = secondary,
            gradientColors = listOf(Color(0xFF451A03), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_wo_list),
            description = stringResource(R.string.menu_wo_list_desc),
            icon = Icons.Default.ListAlt,
            onClick = onNavigateToWoList,
            accentColor = info,
            gradientColors = listOf(Color(0xFF1E3A5F), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_wo_bind),
            description = stringResource(R.string.menu_wo_bind_desc),
            icon = Icons.Default.QrCodeScanner,
            onClick = onNavigateToWoBind,
            accentColor = tertiary,
            gradientColors = listOf(Color(0xFF052E16), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_count),
            description = stringResource(R.string.menu_count_desc),
            icon = Icons.Default.Assignment,
            onClick = onNavigateToCount,
            accentColor = AppColors.StatusWarning,
            gradientColors = listOf(Color(0xFF1A237E), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_inbound),
            description = stringResource(R.string.menu_inbound_desc),
            icon = Icons.Default.MoveToInbox,
            onClick = onNavigateToInbound,
            accentColor = Color(0xFF2E7D32),
            gradientColors = listOf(Color(0xFF1B5E20), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_outbound),
            description = stringResource(R.string.menu_outbound_desc),
            icon = Icons.Default.Outbox,
            onClick = onNavigateToOutbound,
            accentColor = Color(0xFF1565C0),
            gradientColors = listOf(Color(0xFF0D47A1), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_requisition),
            description = stringResource(R.string.menu_requisition_desc),
            icon = Icons.Default.RequestPage,
            onClick = onNavigateToRequisition,
            accentColor = Color(0xFF6A1B9A),
            gradientColors = listOf(Color(0xFF4A148C), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_return_slip),
            description = stringResource(R.string.menu_return_slip_desc),
            icon = Icons.Default.Undo,
            onClick = onNavigateToReturnSlip,
            accentColor = Color(0xFFE65100),
            gradientColors = listOf(Color(0xFFBF360C), Color(0xFF0B1120))
        ),
        MenuItem(
            title = stringResource(R.string.menu_replenishment),
            description = stringResource(R.string.menu_replenishment_desc),
            icon = Icons.Default.Add,
            onClick = onNavigateToReplenishment,
            accentColor = Color(0xFFC62828),
            gradientColors = listOf(Color(0xFFB71C1C), Color(0xFF0B1120))
        )
    )

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            stringResource(R.string.app_name),
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp,
                            color = Color.White
                        )
                        Text(
                            text = stringResource(R.string.dashboard_welcome, displayName),
                            fontSize = 12.sp,
                            color = Color.White.copy(alpha = 0.75f)
                        )
                    }
                },
                actions = {
                    IconButton(onClick = onLogout) {
                        Icon(
                            Icons.Default.Logout,
                            contentDescription = stringResource(R.string.menu_logout),
                            tint = Color.White
                        )
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = AppColors.Surface
                )
            )
        }
    ) { padding ->
        LazyVerticalGrid(
            // Adapt to both portrait phones and larger rugged PDA screens.
            // A fixed two-column grid made labels wrap or truncate on narrow devices.
            columns = GridCells.Adaptive(minSize = 148.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(AppColors.Background)
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                val sessionUser = MaterialLoaderApp.instance.prefs.getUser()
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = AppColors.SurfaceAlt),
                    border = BorderStroke(1.dp, AppColors.Border)
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("当前工作台 / Active workspace", style = MaterialTheme.typography.titleMedium, color = AppColors.TextPrimary)
                                Text(
                                    "${sessionUser?.roleKey ?: "EMPLOYEE"} · ${sessionUser?.lineCode ?: "未分配产线"}",
                                    color = AppColors.TextSecondary,
                                    fontSize = 13.sp
                                )
                            }
                            Surface(color = AppColors.StatusOkBg, shape = MaterialTheme.shapes.small) {
                                Text("MES ONLINE", modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp), color = AppColors.StatusOk, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatusPill("身份已验证", AppColors.StatusOk)
                            StatusPill("扫描器 READY", AppColors.StatusInfo)
                            StatusPill("员工中心", AppColors.Primary)
                        }
                    }
                }
            }
            items(menuItems.size) { index ->
                DashboardCard(item = menuItems[index])
            }
        }
    }

    // Rack selection dialog
    if (showRackDialog) {
        AlertDialog(
            onDismissRequest = { showRackDialog = false },
            title = { Text(stringResource(R.string.menu_smart_rack), fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Text(stringResource(R.string.rack_title), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = rackInput,
                        onValueChange = { rackInput = it.uppercase() },
                        label = { Text(stringResource(R.string.common_location)) },
                        placeholder = { Text("L001A") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                if (rackInput.isNotBlank()) {
                                    onNavigateToRack(rackInput.trim())
                                    showRackDialog = false
                                    rackInput = ""
                                }
                            },
                            modifier = Modifier.weight(1f),
                            enabled = rackInput.isNotBlank()
                        ) {
                            Text(stringResource(R.string.common_confirm))
                        }
                        OutlinedButton(
                            onClick = { showRackDialog = false },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text(stringResource(R.string.cancel))
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {}
        )
    }
}

@Composable
private fun StatusPill(text: String, color: Color) {
    Surface(color = color.copy(alpha = 0.12f), shape = MaterialTheme.shapes.small) {
        Text(text, modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp), color = color, fontSize = 11.sp)
    }
}

@Composable
private fun DashboardCard(item: MenuItem) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.08f)
            .clickable { item.onClick() },
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = AppColors.Surface),
        border = BorderStroke(1.dp, item.accentColor.copy(alpha = 0.30f)),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp, pressedElevation = 6.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(item.accentColor.copy(alpha = 0.08f))
        ) {
            // Accent bar on left
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(4.dp)
                    .background(item.accentColor)
            )

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                // Icon in a tinted circle
                Box(
                    modifier = Modifier
                        .size(56.dp)
                        .background(
                            color = item.accentColor.copy(alpha = 0.15f),
                            shape = MaterialTheme.shapes.medium
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = item.icon,
                        contentDescription = item.title,
                        modifier = Modifier.size(30.dp),
                        tint = item.accentColor
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = item.title,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    textAlign = TextAlign.Center,
                    color = AppColors.TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(6.dp))

                Text(
                    text = item.description,
                    fontSize = 11.sp,
                    textAlign = TextAlign.Center,
                    color = AppColors.TextSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = 14.sp
                )
            }
        }
    }
}
