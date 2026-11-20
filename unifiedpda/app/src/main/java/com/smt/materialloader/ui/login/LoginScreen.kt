package com.smt.materialloader.ui.login

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.BuildConfig
import com.smt.materialloader.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    viewModel: LoginViewModel = viewModel(),
    onLoginSuccess: () -> Unit,
    onExit: () -> Unit = {},
    showQuickLogin: Boolean = true
) {
    val state by viewModel.state.collectAsState()
    val focusManager = LocalFocusManager.current
    var passwordVisible by remember { mutableStateOf(false) }
    val pageTitle = when {
        BuildConfig.PLANT_MANAGER_APP -> "Plant Manager PDA"
        BuildConfig.UNIFIED_MANAGEMENT_APP -> stringResource(R.string.unified_login_title)
        else -> stringResource(R.string.manager_login_title)
    }
    val pageSubtitle = when {
        BuildConfig.PLANT_MANAGER_APP -> "MES Plant Manager Approval"
        BuildConfig.UNIFIED_MANAGEMENT_APP -> stringResource(R.string.unified_login_subtitle)
        else -> stringResource(R.string.manager_login_subtitle)
    }

    LaunchedEffect(state.isSuccess) {
        if (state.isSuccess) onLoginSuccess()
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 18.dp),
            contentAlignment = Alignment.Center
        ) {
            // Exit button pinned top-right so operators can always leave the app.
            OutlinedButton(
                onClick = onExit,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 6.dp)
            ) {
                Text("退出  Exit", fontWeight = FontWeight.Bold)
            }
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = 460.dp),
                shape = MaterialTheme.shapes.extraLarge,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 10.dp)
            ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Top
            ) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f), MaterialTheme.shapes.large),
                contentAlignment = Alignment.Center
            ) {
                Text("RJ", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Black)
            }
            Spacer(modifier = Modifier.height(14.dp))
            // App title
            Text(
                text = pageTitle,
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = pageSubtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Quick login is intentionally debug/MuMu-only. Production builds
            // must use authenticated operator credentials from MES.
            if (showQuickLogin && BuildConfig.TEST_ACTION_BYPASS_ENABLED) {
                QuickLoginSection(
                    accounts = viewModel.demoAccounts,
                    onQuickLogin = viewModel::quickLogin,
                    locale = state.selectedLocale,
                    enabled = !state.isLoading
                )

                Spacer(modifier = Modifier.height(16.dp))
            }

            // Divider
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                HorizontalDivider(modifier = Modifier.weight(1f))
                Text(
                    text = stringResource(R.string.login_or),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
                HorizontalDivider(modifier = Modifier.weight(1f))
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Username
            OutlinedTextField(
                value = state.username,
                onValueChange = viewModel::onUsernameChanged,
                label = { Text("工号  Employee ID") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                )
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Password
            OutlinedTextField(
                value = state.password,
                onValueChange = viewModel::onPasswordChanged,
                label = { Text(stringResource(R.string.password)) },
                singleLine = true,
                visualTransformation = if (passwordVisible) androidx.compose.ui.text.input.VisualTransformation.None else PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
                trailingIcon = {
                    IconButton(onClick = { passwordVisible = !passwordVisible }) {
                        Icon(
                            imageVector = if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                            contentDescription = stringResource(R.string.password),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(
                    onDone = {
                        focusManager.clearFocus()
                        viewModel.login()
                    }
                )
            )

            Spacer(modifier = Modifier.height(20.dp))

            // Error message
            if (state.error != null) {
                Text(
                    text = state.error!!,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            // Login button
            Button(
                onClick = { viewModel.login() },
                enabled = !state.isLoading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary
                ),
                shape = MaterialTheme.shapes.medium
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text(
                        text = stringResource(R.string.login),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Locale selector
            LocalePicker(
                selected = state.selectedLocale,
                onSelect = viewModel::onLocaleChanged
            )
            }
            }
        }
    }
}

private val QUICK_BUTTON_COLORS = listOf(
    Color(0xFF1976D2), // Blue - Operator
    Color(0xFF2E7D32), // Green - Warehouse
    Color(0xFFF57C00), // Orange - PMC
    Color(0xFFC62828), // Red - Quality
    Color(0xFF6A1B9A), // Purple - Finance
)

@Composable
private fun QuickLoginSection(
    accounts: List<DemoAccount>,
    onQuickLogin: (DemoAccount) -> Unit,
    locale: String,
    enabled: Boolean
) {
    var expanded by remember { mutableStateOf(false) }
    var selected by remember(accounts) { mutableStateOf(accounts.firstOrNull()) }
    fun displayText(account: DemoAccount): String {
        // Named senior managers already carry their title ("莫立斌 · 高级厂长");
        // generic test accounts get "<role> 测试 · <role>".
        return if (account.username == "MO_LI_BIN" || account.username == "MENG_YING")
            localizedTestRole(account, locale)
        else "${localizedTestRole(account, locale)} · ${localizedRole(account.roleKey, locale)}"
    }
    Column {
        Text(
            text = if (BuildConfig.UNIFIED_MANAGEMENT_APP) stringResource(R.string.unified_test_roles) else stringResource(R.string.manager_quick_login),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp)
        )
        Box(Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                Text(selected?.let { displayText(it) } ?: stringResource(R.string.unified_select_role), modifier = Modifier.weight(1f), textAlign = TextAlign.Start)
                Text("▼")
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                accounts.forEach { account ->
                    DropdownMenuItem(
                        text = { Text(displayText(account)) },
                        onClick = { selected = account; expanded = false }
                    )
                }
            }
        }
        accounts.firstOrNull { it.roleKey.equals("IQC", ignoreCase = true) }?.let { iqc ->
            OutlinedButton(
                onClick = { selected = iqc },
                enabled = enabled,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
            ) { Text("进入 IQC 登录") }
        }
        Button(
            onClick = { selected?.let(onQuickLogin) },
            enabled = enabled && selected != null,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
        ) { Text(if (BuildConfig.UNIFIED_MANAGEMENT_APP) stringResource(R.string.unified_quick_login) else stringResource(R.string.quick_login)) }
    }
}

private fun localizedRole(roleKey: String, locale: String): String {
    val zh = locale.startsWith("zh")
    val vi = locale.startsWith("vi")
    return when (roleKey.uppercase()) {
        "EMPLOYEE" -> if (zh) "员工" else if (vi) "Nhân viên" else "Employee"
        "MANUAL_LINE_LOADER" -> if (zh) "手动线物料员" else if (vi) "Nhân viên liệu chuyền thủ công" else "Manual Line Loader"
        "AUTO_LINE_LOADER" -> if (zh) "自动线物料员" else if (vi) "Nhân viên liệu chuyền tự động" else "Auto Line Loader"
        "SMT_LOADER" -> if (zh) "SMT物料员" else if (vi) "Nhân viên liệu SMT" else "SMT Loader"
        "GROUP_LEADER" -> if (zh) "组长" else if (vi) "Trưởng nhóm" else "Group Leader"
        "LINE_MANAGER" -> if (zh) "线长" else if (vi) "Trưởng chuyền" else "Line Manager"
        "LINE_MANAGER_SMT" -> if (zh) "SMT线长" else if (vi) "Trưởng chuyền SMT" else "SMT Line Manager"
        "LINE_MANAGER_AUTO" -> if (zh) "自动线线长" else if (vi) "Trưởng chuyền tự động" else "Auto Line Manager"
        "LINE_MANAGER_MANUAL" -> if (zh) "手动线线长" else if (vi) "Trưởng chuyền thủ công" else "Manual Line Manager"
        "MATERIAL_LOADER" -> if (zh) "物料员" else if (vi) "Nhân viên cấp vật liệu" else "Material Loader"
        "WAREHOUSE" -> if (zh) "仓库物料员" else if (vi) "Kho vật liệu" else "Warehouse Material"
        "MATERIAL_COLLECTOR" -> if (zh) "集料员" else if (vi) "Nhân viên thu gom vật tư" else "Material Collector"
        "MATERIAL_COLLECTOR_SMT" -> if (zh) "SMT领料员" else if (vi) "Nhân viên lĩnh liệu SMT" else "SMT Material Collector"
        "MATERIAL_COLLECTOR_AUTO" -> if (zh) "自动线领料员" else if (vi) "Nhân viên lĩnh liệu chuyền tự động" else "Auto Line Material Collector"
        "MATERIAL_COLLECTOR_MAN" -> if (zh) "手动线领料员" else if (vi) "Nhân viên lĩnh liệu chuyền thủ công" else "Manual Line Material Collector"
  "MATERIAL_PICKER_SMT" -> if (zh) "SMT领料员" else if (vi) "Nhân viên lĩnh liệu SMT" else "SMT Material Picker"
  "MATERIAL_PICKER_AUTO" -> if (zh) "自动线领料员" else if (vi) "Nhân viên lĩnh liệu chuyền tự động" else "Auto Line Material Picker"
  "MATERIAL_PICKER_MAN" -> if (zh) "手动线领料员" else if (vi) "Nhân viên lĩnh liệu chuyền thủ công" else "Manual Line Material Picker"
        "MATERIAL_PICKER_PACKAGING" -> if (zh) "包装领料员" else if (vi) "Nhân viên lĩnh liệu đóng gói" else "Packaging Material Picker"
        "MATERIAL_PICKER" -> if (zh) "全段领料员" else if (vi) "Nhân viên lĩnh liệu toàn段" else "All-Section Material Picker"
        "MATERIAL_FETCHER" -> if (zh) "领料员" else if (vi) "Nhân viên lĩnh vật tư" else "Material Fetcher"
        "WAREHOUSE_MANAGER" -> if (zh) "仓库主管" else if (vi) "Quản đốc kho" else "Warehouse Manager"
        "MES" -> if (zh) "MES" else "MES"
        "PMC" -> if (zh) "PMC计划" else if (vi) "PMC" else "PMC Planning"
        "IQC" -> if (zh) "IQC来料品质" else if (vi) "IQC" else "IQC Quality"
        "ENGINEERING" -> if (zh) "工程" else if (vi) "Kỹ thuật" else "Engineering"
        "PRODUCTION" -> if (zh) "生产" else if (vi) "Sản xuất" else "Production"
        "PLANT_MANAGER" -> if (zh) "厂长" else if (vi) "Quản đốc nhà máy" else "Plant Manager"
        else -> roleKey
    }
}

private fun localizedTestRole(account: DemoAccount, locale: String): String {
    // Named senior-manager accounts carry their person on the button so the
    // plant manager / senior factory manager are distinguishable at a glance.
    return when (account.username) {
        "MO_LI_BIN" -> if (locale.startsWith("zh")) "莫立斌 · 高级厂长" else if (locale.startsWith("vi")) "Mo Libin · Tổng quản đốc" else "Mo Libin · Senior Factory Manager"
        "MENG_YING" -> if (locale.startsWith("zh")) "蒙营 · 厂长" else if (locale.startsWith("vi")) "Meng Ying · Quản đốc" else "Meng Ying · Plant Manager"
        else -> {
            val prefix = when {
                locale.startsWith("zh") -> "测试"
                locale.startsWith("vi") -> "Kiểm thử"
                else -> "Test"
            }
            "${localizedRole(account.roleKey, locale)} $prefix"
        }
    }
}
