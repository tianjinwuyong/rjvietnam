package com.smt.materialloader.ui.navigation

import androidx.compose.runtime.*
import android.content.Intent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.TempSmtLoadingActivity
import com.smt.materialloader.data.api.dto.ShelfCell
import com.smt.materialloader.ui.manager.ManagerDashboardScreen
import com.smt.materialloader.ui.manager.ManagerModule
import com.smt.materialloader.ui.manager.ManagerModuleScreen
import com.smt.materialloader.ui.manager.ManagerCockpitViewModel
import com.smt.materialloader.ui.manager.LineAssignmentScreen
import com.smt.materialloader.ui.manager.HiringRequestScreen
import com.smt.materialloader.ui.manager.GrievanceCasesScreen
import com.smt.materialloader.ui.manager.TeamTodayScreen
import com.smt.materialloader.ui.manager.PlantManagerScreen
import com.smt.materialloader.ui.manager.ApprovalApplicationsScreen
import com.smt.materialloader.ui.manager.HrOrgChartScreen
import com.smt.materialloader.ui.manager.CommunicationCenterScreen
import com.smt.materialloader.ui.manager.TeamLeadCommandCenterScreen
import com.smt.materialloader.ui.history.HistoryScreen
import com.smt.materialloader.ui.issue.IssueScreen
import com.smt.materialloader.ui.login.LoginScreen
import com.smt.materialloader.ui.pdaloading.PdaLoadingScreen
import com.smt.materialloader.ui.pdaloading.PdaForecastScreen
import com.smt.materialloader.ui.query.QueryScreen
import com.smt.materialloader.ui.rack.RackDetailScreen
import com.smt.materialloader.ui.returnmaterial.ReturnScreen
import com.smt.materialloader.ui.shelfin.ShelfInScreen
import com.smt.materialloader.ui.shelfout.ShelfOutScreen
import com.smt.materialloader.ui.receiving.MaterialReceivingScreen
import com.smt.materialloader.ui.iqc.IqcInspectionScreen
import com.smt.materialloader.ui.count.CountScreen
import com.smt.materialloader.ui.manager.HrDutyKanbanScreen
import com.smt.materialloader.ui.wolist.WoListScreen
import com.smt.materialloader.ui.document.InboundListScreen
import com.smt.materialloader.ui.document.OutboundListScreen
import com.smt.materialloader.ui.document.RequisitionListScreen
import com.smt.materialloader.ui.document.ReturnSlipListScreen
import com.smt.materialloader.ui.document.ReplenishmentListScreen
import com.smt.materialloader.ui.document.InboundDetailScreen
import com.smt.materialloader.ui.document.OutboundDetailScreen
import com.smt.materialloader.ui.document.RequisitionDetailScreen
import com.smt.materialloader.ui.document.ReturnSlipDetailScreen
import com.smt.materialloader.ui.document.ReplenishmentDetailScreen
import com.smt.materialloader.ui.document.InboundEditScreen
import com.smt.materialloader.ui.document.OutboundEditScreen
import com.smt.materialloader.ui.document.RequisitionEditScreen
import com.smt.materialloader.ui.fetching.MaterialFetchingScreen
import com.smt.materialloader.ui.pick.PickAcceptanceScreen
import com.smt.materialloader.ui.collect.CollectScreen
import com.smt.materialloader.ui.shortage.ShortageScreen
import com.smt.materialloader.ui.document.ReturnSlipEditScreen
import com.smt.materialloader.ui.document.ReplenishmentEditScreen
import com.smt.materialloader.ui.employee.EmployeeSelfServiceScreen
import com.smt.materialloader.ui.signification.SignificationScreen
import com.smt.materialloader.R
import com.smt.materialloader.BuildConfig

object Routes {
    const val LOGIN = "login"
    const val EMPLOYEE = "employee"
    const val SIGNIFICATION = "signification"
    const val DASHBOARD = "dashboard"
    const val MANAGER_ALERTS = "manager_alerts"
    const val MANAGER_REPAIR = "manager_repair"
    const val TEAM_LEAD_COMMAND = "team_lead_command"
    const val MANAGER_DECISIONS = "manager_decisions"
    const val MANAGER_APPROVALS = "manager_approvals"
    const val HR_ORG_CHART = "hr_org_chart"
    const val HR_DUTY_KANBAN = "hr_duty_kanban"
    const val COMMUNICATION_CENTER = "communication_center"
    const val MANAGER_TEAM = "manager_team"
    const val MANAGER_TARGETS = "manager_targets"
    const val MANAGER_LINE_STATUS = "manager_line_status"
    const val MANAGER_LOADING_STATUS = "manager_loading_status"
    const val MANAGER_WORK_ORDERS = "manager_work_orders"
    const val MANAGER_HANDOVER = "manager_handover"
    const val MANAGER_PROFILE = "manager_profile"
    const val MANAGER_ASSIGNMENTS = "manager_assignments"
    const val MANAGER_HIRING_REQUESTS = "manager_hiring_requests"
    const val MANAGER_GRIEVANCE_CASES = "manager_grievance_cases"
    const val PLANT_MANAGER = "plant_manager"
    const val ISSUE = "issue"
    const val RETURN = "return"
    const val QUERY = "query"
    const val RACK_DETAIL = "rack_detail"
    const val SHELF_IN = "shelf_in"
    const val SHELF_OUT = "shelf_out"
    const val RECEIVING = "material_receiving"
    const val IQC_INSPECTION = "iqc_inspection"
    const val HISTORY = "history"
    const val MATERIAL_LOAD = "material_load"
    const val PDA_LOADING = "pda_loading"
    const val PDA_FORECAST = "pda_forecast"
    const val WO_LIST = "wo_list"
    const val COUNT = "count"
    const val INBOUND = "inbound"
    const val OUTBOUND = "outbound"
    const val REQUISITION = "requisition"
    const val MATERIAL_FETCHING = "material_fetching"
    const val COLLECT = "material_collect"
    const val MATERIAL_COLLECT_PREP = "material_collect_prep"
    const val SHORTAGE = "shortage"
    const val PICK_ACCEPT = "pick_accept"
    const val RETURN_SLIP = "return_slip"
    const val REPLENISHMENT = "replenishment"
    // Detail routes
    const val INBOUND_DETAIL = "inbound_detail"
    const val OUTBOUND_DETAIL = "outbound_detail"
    const val REQUISITION_DETAIL = "requisition_detail"
    const val RETURN_SLIP_DETAIL = "return_slip_detail"
    const val REPLENISHMENT_DETAIL = "replenishment_detail"
    // Edit routes
    const val INBOUND_EDIT = "inbound_edit"
    const val OUTBOUND_EDIT = "outbound_edit"
    const val REQUISITION_EDIT = "requisition_edit"
    const val RETURN_SLIP_EDIT = "return_slip_edit"
    const val REPLENISHMENT_EDIT = "replenishment_edit"
    // New document routes (no docId)
    const val INBOUND_EDIT_NEW = "inbound_edit_new"
    const val OUTBOUND_EDIT_NEW = "outbound_edit_new"
    const val REQUISITION_EDIT_NEW = "requisition_edit_new"
    const val RETURN_SLIP_EDIT_NEW = "return_slip_edit_new"
    const val REPLENISHMENT_EDIT_NEW = "replenishment_edit_new"
}

private fun unifiedStartRoute(prefs: com.smt.materialloader.util.PreferencesManager, afterLogin: Boolean = false): String {
    val role = prefs.getUser()?.roleKey?.trim()?.uppercase().orEmpty()
    val route = when {
        !prefs.hasToken() -> Routes.LOGIN
        role.isBlank() -> Routes.LOGIN
        BuildConfig.PLANT_MANAGER_APP && role in setOf("PLANT_MANAGER", "ADMIN", "MANAGEMENT") -> Routes.PLANT_MANAGER
        role in setOf("MATERIAL_LOADER", "MANUAL_LINE_LOADER", "AUTO_LINE_LOADER", "SMT_LOADER", "SMT_OPERATOR", "MATERIAL_OPERATOR") -> Routes.PDA_LOADING
        role == "WAREHOUSE" -> Routes.RECEIVING
        role == "MATERIAL_FETCHER" -> Routes.MATERIAL_FETCHING
        role == "WAREHOUSE_MANAGER" -> Routes.SHORTAGE
        role == "MATERIAL_COLLECTOR" -> Routes.MATERIAL_COLLECT_PREP
        role == "MATERIAL_COLLECTOR_SMT" || role == "MATERIAL_COLLECTOR_AUTO" || role == "MATERIAL_COLLECTOR_MAN" -> Routes.COLLECT
        role == "MATERIAL_PICKER_SMT" || role == "MATERIAL_PICKER_AUTO" || role == "MATERIAL_PICKER_MAN" || role == "MATERIAL_PICKER_PACKAGING" || role == "MATERIAL_PICKER" -> Routes.COLLECT
        role == "PMC" -> Routes.MANAGER_WORK_ORDERS
        role == "IQC" -> Routes.IQC_INSPECTION
        role == "MES" -> Routes.MANAGER_DECISIONS
        role == "ENGINEERING" -> Routes.MANAGER_LINE_STATUS
        role == "PRODUCTION" -> Routes.DASHBOARD
        role == "EMPLOYEE" -> Routes.EMPLOYEE
        else -> Routes.DASHBOARD
    }
    // Never land on a route the gate would refuse: that produced a redirect loop
    // for MES roles outside the local table. Every authenticated employee can use
    // self-service, so it is the safe shared landing.
    return if (route == Routes.LOGIN || canAccessRoute(prefs, route)) route else Routes.EMPLOYEE
}

private fun roleKey(prefs: com.smt.materialloader.util.PreferencesManager): String =
    prefs.getUser()?.roleKey?.trim()?.uppercase().orEmpty()

fun visibleManagerModules(prefs: com.smt.materialloader.util.PreferencesManager): Set<ManagerModule> = when (roleKey(prefs)) {
    "GROUP_LEADER" -> setOf(ManagerModule.ALERTS, ManagerModule.REPAIR, ManagerModule.LINE_STATUS, ManagerModule.TEAM, ManagerModule.HANDOVER)
    "LINE_MANAGER", "LINE_MANAGER_SMT", "LINE_MANAGER_AUTO", "LINE_MANAGER_MANUAL" -> setOf(ManagerModule.ALERTS, ManagerModule.REPAIR, ManagerModule.DECISIONS, ManagerModule.LINE_STATUS, ManagerModule.LOADING_STATUS, ManagerModule.TEAM, ManagerModule.TARGETS, ManagerModule.HANDOVER, ManagerModule.ASSIGNMENTS, ManagerModule.HIRING_REQUESTS, ManagerModule.GRIEVANCE_CASES)
    "MES" -> setOf(ManagerModule.ALERTS, ManagerModule.DECISIONS, ManagerModule.APPROVALS, ManagerModule.LINE_STATUS)
    "PMC" -> setOf(ManagerModule.WORK_ORDERS, ManagerModule.TARGETS, ManagerModule.DECISIONS, ManagerModule.APPROVALS, ManagerModule.LINE_STATUS)
    "IQC" -> setOf(ManagerModule.REPAIR, ManagerModule.DECISIONS, ManagerModule.APPROVALS, ManagerModule.ALERTS)
    "ENGINEERING" -> setOf(ManagerModule.LINE_STATUS, ManagerModule.REPAIR, ManagerModule.ALERTS, ManagerModule.DECISIONS, ManagerModule.APPROVALS)
    "PRODUCTION" -> setOf(ManagerModule.ALERTS, ManagerModule.LINE_STATUS, ManagerModule.TARGETS, ManagerModule.DECISIONS)
    "ADMIN", "MANAGEMENT", "PLANT_MANAGER" -> ManagerModule.values().filter { it != ManagerModule.PLANT_MANAGER }.toSet()
    else -> emptySet()
}

private fun mesPageKey(route: String): String? = when {
    route == Routes.DASHBOARD -> "manager.dashboard"
    route == Routes.PDA_LOADING -> "pda.loading"
    route == Routes.PDA_FORECAST -> "pda.loading.forecast"
    route == Routes.HISTORY -> "pda.loading.history"
    route == Routes.MANAGER_ALERTS -> "manager.alerts"
    route == Routes.MANAGER_REPAIR -> "manager.repair"
    route == Routes.MANAGER_DECISIONS -> "manager.decisions"
    route == Routes.MANAGER_APPROVALS -> "manager.approvals"
    route == Routes.MANAGER_TEAM -> "manager.team"
    route == Routes.MANAGER_TARGETS -> "manager.targets"
    route == Routes.MANAGER_LINE_STATUS -> "manager.line_status"
    route == Routes.MANAGER_HANDOVER -> "manager.handover"
    route == Routes.MANAGER_LOADING_STATUS -> "manager.loading_status"
    route == Routes.MANAGER_WORK_ORDERS -> "pmc.work_orders"
    route == Routes.MANAGER_ASSIGNMENTS -> "manager.assignments"
    route == Routes.MANAGER_HIRING_REQUESTS -> "manager.hiring"
    route == Routes.MANAGER_GRIEVANCE_CASES -> "manager.grievance"
    route == Routes.INBOUND || route.startsWith("${Routes.INBOUND}_") -> "wms.inbound"
    route == Routes.OUTBOUND || route.startsWith("${Routes.OUTBOUND}_") -> "wms.outbound"
    route == Routes.REQUISITION || route.startsWith("${Routes.REQUISITION}_") -> "wms.requisition"
    route == Routes.MATERIAL_FETCHING -> "wms.fetching"
    route == Routes.COLLECT -> "wms.collect"
    route == Routes.RETURN_SLIP || route.startsWith("${Routes.RETURN_SLIP}_") -> "wms.return"
    route == Routes.REPLENISHMENT || route.startsWith("${Routes.REPLENISHMENT}_") -> "wms.replenishment"
    route == Routes.COUNT -> "wms.count"
    route == Routes.PLANT_MANAGER -> "plant_manager.approvals"
    route == Routes.EMPLOYEE -> "employee.self_service"
    route == Routes.SIGNIFICATION -> "oa.signification"
    else -> null
}

/**
 * GRILL role boundary for the PDA. MES remains the authority for every write;
 * this set only controls which screens can be opened by the signed-in role.
 */
private fun canAccessRoute(prefs: com.smt.materialloader.util.PreferencesManager, route: String?): Boolean {
    if (route.isNullOrBlank() || route == Routes.LOGIN) return true
    val role = roleKey(prefs)
    val mesPages = prefs.getUser()?.roleDefinition?.pages.orEmpty()
    val mesPage = when {
        route == Routes.PDA_LOADING -> when (role) {
            "MANUAL_LINE_LOADER" -> "pda.manual_line.loading"
            "AUTO_LINE_LOADER" -> "pda.auto_line.loading"
            "SMT_LOADER" -> "pda.smt.loading"
            else -> "pda.loading"
        }
        else -> mesPageKey(route)
    }
    if (mesPages.isNotEmpty() && mesPage != null) {
        val employeeBase = route == Routes.EMPLOYEE && prefs.getUser()?.permissions.orEmpty().contains("employee.self.view")
        return mesPages.contains(mesPage) || employeeBase
    }
    // Every factory role is an employee first; self-service is a shared module.
    val common = setOf(Routes.MANAGER_PROFILE, Routes.HISTORY, Routes.EMPLOYEE, Routes.SIGNIFICATION)
    val allowed = when (role) {
        "EMPLOYEE" -> setOf(Routes.EMPLOYEE, Routes.MANAGER_PROFILE)
        "MATERIAL_LOADER", "MANUAL_LINE_LOADER", "AUTO_LINE_LOADER", "SMT_LOADER", "SMT_OPERATOR", "MATERIAL_OPERATOR" ->
            setOf(Routes.PDA_LOADING, Routes.PDA_FORECAST, Routes.HISTORY, Routes.RETURN, Routes.QUERY)
        "WAREHOUSE" -> setOf(
            Routes.RECEIVING,
            Routes.INBOUND, Routes.OUTBOUND, Routes.REQUISITION, Routes.RETURN_SLIP,
            Routes.REPLENISHMENT, Routes.COUNT, Routes.HISTORY, Routes.RACK_DETAIL,
            Routes.SHELF_IN, Routes.SHELF_OUT, Routes.RETURN, Routes.QUERY
        )
        "MATERIAL_FETCHER" -> setOf(
            Routes.MATERIAL_FETCHING, Routes.REQUISITION, Routes.RETURN_SLIP, Routes.HISTORY,
            Routes.RACK_DETAIL, Routes.SHELF_OUT, Routes.QUERY
        )
        "WAREHOUSE_MANAGER" -> setOf(
            Routes.SHORTAGE, Routes.HISTORY, Routes.QUERY, Routes.RETURN,
            Routes.RACK_DETAIL, Routes.SHELF_IN, Routes.SHELF_OUT
        )
        "MATERIAL_COLLECTOR" -> setOf(
            Routes.MATERIAL_COLLECT_PREP, Routes.ISSUE, Routes.HISTORY, Routes.RETURN, Routes.QUERY
        )
        "MATERIAL_COLLECTOR_SMT" -> setOf(
            Routes.COLLECT, Routes.ISSUE, Routes.HISTORY, Routes.RETURN, Routes.QUERY
        )
        "MATERIAL_COLLECTOR_AUTO" -> setOf(
            Routes.COLLECT, Routes.ISSUE, Routes.HISTORY, Routes.RETURN, Routes.QUERY
        )
        "MATERIAL_COLLECTOR_MAN" -> setOf(
            Routes.COLLECT, Routes.ISSUE, Routes.HISTORY, Routes.RETURN, Routes.QUERY
        )
        "MATERIAL_PICKER_SMT" -> setOf(
            Routes.COLLECT, Routes.ISSUE, Routes.HISTORY, Routes.RETURN, Routes.QUERY
        )
        "MATERIAL_PICKER_AUTO" -> setOf(
            Routes.COLLECT, Routes.ISSUE, Routes.HISTORY, Routes.RETURN, Routes.QUERY
        )
        "MATERIAL_PICKER_MAN" -> setOf(
            Routes.COLLECT, Routes.ISSUE, Routes.HISTORY, Routes.RETURN, Routes.QUERY
        )
        "MATERIAL_PICKER_PACKAGING" -> setOf(
            Routes.COLLECT, Routes.ISSUE, Routes.HISTORY, Routes.RETURN, Routes.QUERY
        )
        "MATERIAL_PICKER" -> setOf(
            Routes.COLLECT, Routes.ISSUE, Routes.HISTORY, Routes.RETURN, Routes.QUERY
        )
        "GROUP_LEADER" -> setOf(
            Routes.DASHBOARD, Routes.MANAGER_ALERTS, Routes.MANAGER_REPAIR,
            Routes.MANAGER_LINE_STATUS, Routes.MANAGER_LOADING_STATUS, Routes.MANAGER_TEAM,
            Routes.MANAGER_HANDOVER, Routes.MANAGER_PROFILE, Routes.TEAM_LEAD_COMMAND,
            Routes.PDA_LOADING
        )
        "LINE_MANAGER", "LINE_MANAGER_SMT", "LINE_MANAGER_AUTO", "LINE_MANAGER_MANUAL" -> setOf(
            Routes.DASHBOARD, Routes.MANAGER_ALERTS, Routes.MANAGER_REPAIR,
            Routes.MANAGER_DECISIONS, Routes.MANAGER_LINE_STATUS, Routes.MANAGER_LOADING_STATUS,
            Routes.MANAGER_HANDOVER, Routes.MANAGER_TEAM, Routes.MANAGER_TARGETS,
            Routes.MANAGER_ASSIGNMENTS, Routes.MANAGER_HIRING_REQUESTS,
            Routes.MANAGER_GRIEVANCE_CASES, Routes.MANAGER_PROFILE, Routes.TEAM_LEAD_COMMAND,
            Routes.HR_DUTY_KANBAN, Routes.PDA_LOADING
        )
        "MES" -> setOf(
            Routes.DASHBOARD, Routes.MANAGER_ALERTS, Routes.MANAGER_DECISIONS,
            Routes.MANAGER_APPROVALS, Routes.MANAGER_LINE_STATUS, Routes.MANAGER_LOADING_STATUS,
            Routes.MANAGER_WORK_ORDERS, Routes.MANAGER_PROFILE
        )
        "PMC" -> setOf(
            Routes.DASHBOARD, Routes.MANAGER_WORK_ORDERS, Routes.MANAGER_TARGETS,
            Routes.MANAGER_DECISIONS, Routes.MANAGER_APPROVALS, Routes.MANAGER_LINE_STATUS,
            Routes.MANAGER_PROFILE
        )
        "IQC" -> setOf(
            Routes.DASHBOARD, Routes.IQC_INSPECTION, Routes.RECEIVING, Routes.MANAGER_REPAIR,
            Routes.MANAGER_DECISIONS, Routes.MANAGER_APPROVALS, Routes.MANAGER_ALERTS,
            Routes.MANAGER_PROFILE
        )
        "ENGINEERING" -> setOf(
            Routes.DASHBOARD, Routes.MANAGER_LINE_STATUS, Routes.MANAGER_REPAIR,
            Routes.MANAGER_ALERTS, Routes.MANAGER_DECISIONS, Routes.MANAGER_APPROVALS,
            Routes.MANAGER_PROFILE
        )
        "PRODUCTION" -> setOf(
            Routes.DASHBOARD, Routes.MANAGER_ALERTS, Routes.MANAGER_LINE_STATUS,
            Routes.MANAGER_TARGETS, Routes.MANAGER_DECISIONS, Routes.MANAGER_PROFILE
        )
        "PLANT_MANAGER", "ADMIN", "MANAGEMENT" -> setOf(
            Routes.DASHBOARD, Routes.MANAGER_ALERTS, Routes.MANAGER_REPAIR,
            Routes.TEAM_LEAD_COMMAND, Routes.MANAGER_DECISIONS, Routes.MANAGER_APPROVALS,
            Routes.HR_ORG_CHART, Routes.HR_DUTY_KANBAN, Routes.COMMUNICATION_CENTER, Routes.MANAGER_TEAM,
            Routes.MANAGER_TARGETS, Routes.MANAGER_LINE_STATUS, Routes.MANAGER_LOADING_STATUS,
            Routes.MANAGER_WORK_ORDERS, Routes.MANAGER_HANDOVER, Routes.MANAGER_PROFILE,
            Routes.MANAGER_ASSIGNMENTS, Routes.MANAGER_HIRING_REQUESTS,
            Routes.MANAGER_GRIEVANCE_CASES, Routes.PLANT_MANAGER, Routes.PDA_LOADING,
            Routes.HISTORY, Routes.MATERIAL_LOAD, Routes.WO_LIST, Routes.COUNT,
            Routes.INBOUND, Routes.OUTBOUND, Routes.REQUISITION, Routes.RETURN_SLIP,
            Routes.REPLENISHMENT, Routes.RACK_DETAIL, Routes.SHELF_IN, Routes.SHELF_OUT,
            Routes.RECEIVING, Routes.IQC_INSPECTION, Routes.SHORTAGE, Routes.ISSUE,
            Routes.RETURN, Routes.QUERY, Routes.MATERIAL_FETCHING, Routes.COLLECT,
            Routes.MATERIAL_COLLECT_PREP
        )
        else -> common
    }
    // The employee module is a shared foundation, not a role-specific privilege.
    // Every authenticated role gets self-service and read-only history/profile in
    // addition to its operational workspace; MES page claims can still narrow
    // production writes above.
    return route == Routes.LOGIN ||
        (allowed + common).any { route == it || route.startsWith("$it/") || route.startsWith("${it}_") }
}

@Composable
fun AppNavHost(
    navController: NavHostController = rememberNavController()
) {
    val prefs = MaterialLoaderApp.instance.prefs
    val authRepository = MaterialLoaderApp.instance.authRepository
    // MES is the authority for session lifetime: a locally-detectable expired
    // session counts as logged out even while offline, so a cached role
    // snapshot never keeps privileged screens alive past its expiry.
    val hasUsableSession = authRepository.hasUsableSession()
    // A receiving device still needs an authenticated MES session; the old
    // flavor shortcut landed unauthenticated operators on live WMS data.
    val startDestination = when {
        !hasUsableSession -> Routes.LOGIN
        BuildConfig.APPLICATION_ID.endsWith(".receiving") -> Routes.RECEIVING
        else -> unifiedStartRoute(prefs)
    }

    val currentRoute = navController.currentBackStackEntryAsState().value?.destination?.route
    val cockpitViewModel: ManagerCockpitViewModel = viewModel()
    val cockpitState by cockpitViewModel.state.collectAsState()

    LaunchedEffect(Unit) {
        // An MES-issued expiry is honored locally: a stale token must not keep
        // privileged screens alive when offline, where restoreSession can't run.
        if (prefs.hasToken() && prefs.isSessionExpired()) {
            prefs.clearSession()
            navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
            return@LaunchedEffect
        }
        // Re-read the MES session at start so role/scope/permission changes made
        // after the last login are reflected. A revoked token lands on login.
        if (prefs.hasToken()) {
            MaterialLoaderApp.instance.authRepository.restoreSession()
            if (!prefs.hasToken()) {
                navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
            }
        }
    }

    val routeDenied = prefs.hasToken() && currentRoute != null && !canAccessRoute(prefs, currentRoute)
    LaunchedEffect(routeDenied, currentRoute) {
        if (routeDenied) {
            navController.navigate(unifiedStartRoute(prefs, afterLogin = true)) {
                popUpTo(0) { inclusive = true }
                launchSingleTop = true
            }
        }
    }
    if (routeDenied) {
        // Do not compose the destination body: its own LaunchedEffect would fetch
        // MES data before the redirect completes.
        Surface(color = Color(0xFF0B1822), modifier = Modifier.fillMaxSize()) {
            Text(
                text = "MES 权限校验中… / Checking MES authorization…",
                color = Color.White
            )
        }
        return
    }

    Box(modifier = Modifier.fillMaxSize()) {
        NavHost(
            navController = navController,
            startDestination = startDestination
        ) {
        composable(Routes.LOGIN) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(unifiedStartRoute(prefs, afterLogin = true)) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                },
                onExit = {
                    MaterialLoaderApp.instance.currentActivity?.finishAffinity()
                },
                showQuickLogin = BuildConfig.TEST_ACTION_BYPASS_ENABLED
            )
        }

        composable(Routes.EMPLOYEE) {
            EmployeeSelfServiceScreen(
                onBack = { navController.navigate(Routes.DASHBOARD) { popUpTo(Routes.EMPLOYEE) { inclusive = true } } },
                onLogout = {
                    MaterialLoaderApp.instance.authRepository.logout()
                    navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
                }
            )
        }

        composable(Routes.SIGNIFICATION) {
            SignificationScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.DASHBOARD) {
            val context = LocalContext.current
            val canOpenMesWeb = prefs.getUser()?.permissions.orEmpty().any { it == "manager.view" || it == "mes.web.view" || it == "mes.dashboard.view" }
            ManagerDashboardScreen(allowedModules = visibleManagerModules(prefs), viewModel = cockpitViewModel, showMesWeb = canOpenMesWeb, onOpenCommand = { navController.navigate(Routes.TEAM_LEAD_COMMAND) }, onOpenMaterial = { navController.navigate(Routes.PDA_LOADING) }, onOpenMesWeb = {
                    if (canOpenMesWeb) {
                        context.startActivity(Intent(context, TempSmtLoadingActivity::class.java).apply {
                            putExtra(TempSmtLoadingActivity.EXTRA_PAGE_URL, "http://10.0.2.2:5178/?view=mes&mesTab=smtLoading3d")
                        })
                    }
                }, onLogout = {
                    MaterialLoaderApp.instance.authRepository.logout()
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                }, onNavigateToModule = { module ->
                    val route = when (module) {
                        ManagerModule.ALERTS -> Routes.MANAGER_ALERTS
                        ManagerModule.REPAIR -> Routes.MANAGER_REPAIR
                        ManagerModule.DECISIONS -> Routes.MANAGER_DECISIONS
                        ManagerModule.APPROVALS -> Routes.MANAGER_APPROVALS
                        ManagerModule.ORG_CHART -> Routes.HR_ORG_CHART
                        ManagerModule.COMMUNICATIONS -> Routes.COMMUNICATION_CENTER
                        ManagerModule.TEAM -> Routes.MANAGER_TEAM
                        ManagerModule.TARGETS -> Routes.MANAGER_TARGETS
                        ManagerModule.LINE_STATUS -> Routes.MANAGER_LINE_STATUS
                        ManagerModule.LOADING_STATUS -> Routes.MANAGER_LOADING_STATUS
                        ManagerModule.WORK_ORDERS -> Routes.MANAGER_WORK_ORDERS
                        ManagerModule.HANDOVER -> Routes.MANAGER_HANDOVER
                        ManagerModule.PROFILE -> Routes.MANAGER_PROFILE
                        ManagerModule.ASSIGNMENTS -> Routes.MANAGER_ASSIGNMENTS
                        ManagerModule.HIRING_REQUESTS -> Routes.MANAGER_HIRING_REQUESTS
                        ManagerModule.GRIEVANCE_CASES -> Routes.MANAGER_GRIEVANCE_CASES
                        ManagerModule.PLANT_MANAGER -> Routes.PLANT_MANAGER
                    }
                    navController.navigate(route)
                })
        }

        composable(Routes.MANAGER_ALERTS) { ManagerModuleScreen(ManagerModule.ALERTS, onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_REPAIR) { ManagerModuleScreen(ManagerModule.REPAIR, onBack = { navController.popBackStack() }) }
        composable(Routes.TEAM_LEAD_COMMAND) {
            TeamLeadCommandCenterScreen(onOpenModule = { module ->
                val route = when (module) {
                    ManagerModule.REPAIR -> Routes.MANAGER_REPAIR
                    ManagerModule.ALERTS -> Routes.MANAGER_ALERTS
                    ManagerModule.LINE_STATUS -> Routes.MANAGER_LINE_STATUS
                    ManagerModule.HANDOVER -> Routes.MANAGER_HANDOVER
                    ManagerModule.TEAM -> Routes.MANAGER_TEAM
                    ManagerModule.DECISIONS -> Routes.MANAGER_DECISIONS
                    ManagerModule.TARGETS -> Routes.MANAGER_TARGETS
                    else -> Routes.MANAGER_ALERTS
                }
                navController.navigate(route)
            })
        }
        composable(Routes.MANAGER_DECISIONS) { ManagerModuleScreen(ManagerModule.DECISIONS, onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_APPROVALS) { ApprovalApplicationsScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.HR_ORG_CHART) { HrOrgChartScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.HR_DUTY_KANBAN) { HrDutyKanbanScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.COMMUNICATION_CENTER) { CommunicationCenterScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_TEAM) { TeamTodayScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_TARGETS) { ManagerModuleScreen(ManagerModule.TARGETS, onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_LINE_STATUS) { ManagerModuleScreen(ManagerModule.LINE_STATUS, onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_LOADING_STATUS) { ManagerModuleScreen(ManagerModule.LOADING_STATUS, onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_WORK_ORDERS) { ManagerModuleScreen(ManagerModule.WORK_ORDERS, onBack = { navController.popBackStack() }) }
        composable(Routes.PDA_FORECAST) { PdaForecastScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_HANDOVER) { ManagerModuleScreen(ManagerModule.HANDOVER, onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_PROFILE) { ManagerModuleScreen(ManagerModule.PROFILE, onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_ASSIGNMENTS) { LineAssignmentScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_HIRING_REQUESTS) { HiringRequestScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.MANAGER_GRIEVANCE_CASES) { GrievanceCasesScreen(onBack = { navController.popBackStack() }) }
        composable(Routes.PLANT_MANAGER) {
            PlantManagerScreen(onBack = {
                // Plant Manager is the start destination for the dedicated
                // flavor; a plain pop would leave the user with no screen.
                MaterialLoaderApp.instance.authRepository.logout()
                navController.navigate(Routes.LOGIN) {
                    popUpTo(0) { inclusive = true }
                }
            })
        }

        composable(Routes.ISSUE) {
            IssueScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.RETURN) {
            ReturnScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.QUERY) {
            QueryScreen(onBack = { navController.popBackStack() })
        }

        composable("${Routes.RACK_DETAIL}/{shelfCode}") { backStackEntry ->
            val shelfCode = backStackEntry.arguments?.getString("shelfCode") ?: ""
            RackDetailScreen(
                shelfCode = shelfCode,
                onBack = { navController.popBackStack() },
                onCellPress = { cell ->
                    if (cell.cellStatus == com.smt.materialloader.data.api.dto.CellStatus.OCCUPIED) {
                        val cellJson = "${cell.cellNumber}|${cell.cellLabel}|${cell.materialCode ?: ""}|${cell.lotNo ?: ""}|${cell.labelId ?: ""}|${cell.qty ?: 0}"
                        navController.navigate("${Routes.SHELF_OUT}/$shelfCode/$cellJson")
                    } else {
                        navController.navigate("${Routes.SHELF_IN}/$shelfCode/${cell.cellNumber}/${cell.cellLabel}")
                    }
                }
            )
        }

        composable("${Routes.SHELF_IN}/{shelfCode}/{cellNumber}/{cellLabel}") { backStackEntry ->
            val shelfCode = backStackEntry.arguments?.getString("shelfCode") ?: ""
            val cellNumber = backStackEntry.arguments?.getString("cellNumber") ?: ""
            val cellLabel = backStackEntry.arguments?.getString("cellLabel") ?: ""
            ShelfInScreen(
                shelfCode = shelfCode,
                cellNumber = cellNumber,
                cellLabel = cellLabel,
                onBack = { navController.popBackStack() },
                onDone = { navController.popBackStack() }
            )
        }

        composable("${Routes.SHELF_OUT}/{shelfCode}/{cellJson}") { backStackEntry ->
            val shelfCode = backStackEntry.arguments?.getString("shelfCode") ?: ""
            val cellJson = backStackEntry.arguments?.getString("cellJson") ?: ""
            val parts = cellJson.split("|")
            val cell = ShelfCell(
                shelfCode = shelfCode,
                cellNumber = parts.getOrElse(0) { "" },
                cellLabel = parts.getOrElse(1) { "" },
                materialCode = parts.getOrElse(2) { null },
                lotNo = parts.getOrElse(3) { null },
                labelId = parts.getOrElse(4) { null },
                qty = parts.getOrElse(5) { "0" }.toIntOrNull(),
                cellStatus = com.smt.materialloader.data.api.dto.CellStatus.OCCUPIED
            )
            ShelfOutScreen(
                shelfCode = shelfCode,
                cell = cell,
                onBack = { navController.popBackStack() },
                onDone = { navController.popBackStack() }
            )
        }

        composable(Routes.HISTORY) {
            HistoryScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.MATERIAL_LOAD) {
            // Retired legacy material-loading flow. All SMT loading now uses
            // the same material-first MES/WMS logic as the PDA dashboard.
            PdaLoadingScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.PDA_LOADING) {
            // The old native SMT screen is retired. Unified PDA always opens
            // the dashboard web application so the phone and MES use one flow.
            val context = LocalContext.current
            LaunchedEffect(Unit) {
                context.startActivity(Intent(context, TempSmtLoadingActivity::class.java))
                navController.popBackStack()
            }
            Surface(color = Color(0xFF0B1822)) {
                Text("Opening Unified PDA…", color = Color.White)
            }
        }

        composable("${Routes.MATERIAL_LOAD}/{woCode}") { _ ->
            // Ignore the legacy route parameter deliberately: the current
            // MES work-order list is the single source of truth and the PDA
            // must select a currently active WO before scanning a roll.
            PdaLoadingScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.WO_LIST) {
            WoListScreen(
                onBack = { navController.popBackStack() },
                onWoSelected = { woCode ->
                    navController.navigate("${Routes.MATERIAL_LOAD}/$woCode")
                }
            )
        }
        composable(Routes.COUNT) {
            CountScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.INBOUND) {
            InboundListScreen(
                onBack = { navController.popBackStack() },
                onNavigateToDetail = { docId -> navController.navigate("${Routes.INBOUND_DETAIL}/$docId") },
                onNavigateToCreate = { navController.navigate(Routes.RECEIVING) }
            )
        }

        composable(Routes.RECEIVING) {
            MaterialReceivingScreen(
                onBack = { navController.popBackStack() },
                onHome = {
                    navController.navigate(unifiedStartRoute(prefs, afterLogin = true)) {
                        popUpTo(0) { inclusive = true }
                        launchSingleTop = true
                    }
                },
                onLogout = {
                    MaterialLoaderApp.instance.authRepository.logout()
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.IQC_INSPECTION) {
            IqcInspectionScreen(
                onHome = { navController.navigate(unifiedStartRoute(prefs, afterLogin = true)) { popUpTo(0) { inclusive = true } } },
                onBack = { navController.popBackStack() },
                onLogout = {
                    MaterialLoaderApp.instance.authRepository.logout()
                    navController.navigate(Routes.LOGIN) { popUpTo(0) { inclusive = true } }
                }
            )
        }

        composable(Routes.OUTBOUND) {
            OutboundListScreen(
                onBack = { navController.popBackStack() },
                onNavigateToDetail = { docId -> navController.navigate("${Routes.OUTBOUND_DETAIL}/$docId") },
                onNavigateToCreate = { navController.navigate(Routes.OUTBOUND_EDIT_NEW) }
            )
        }

        composable(Routes.REQUISITION) {
            RequisitionListScreen(
                onBack = { navController.popBackStack() },
                onNavigateToDetail = { docId -> navController.navigate("${Routes.REQUISITION_DETAIL}/$docId") },
                onNavigateToCreate = { navController.navigate(Routes.REQUISITION_EDIT_NEW) }
            )
        }

        composable(Routes.MATERIAL_FETCHING) {
            // 领料 entry now opens the WMS pick-list → check → sign acceptance flow.
            PickAcceptanceScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.PICK_ACCEPT) {
            PickAcceptanceScreen(onBack = { navController.popBackStack() })
        }

  composable(Routes.COLLECT) {
    CollectScreen(
      onBack = {
        // Collector lands here straight after login: nothing to pop,
        // so fall back to logout -> login instead of a dead button.
        if (!navController.popBackStack()) {
          MaterialLoaderApp.instance.authRepository.logout()
          navController.navigate(Routes.LOGIN) {
            popUpTo(0) { inclusive = true }
          }
        }
      },
      onLogout = {
        MaterialLoaderApp.instance.authRepository.logout()
        navController.navigate(Routes.LOGIN) {
          popUpTo(0) { inclusive = true }
        }
      }
    )
  }

  composable(Routes.SHORTAGE) {
    ShortageScreen(
      onBack = {
        // Warehouse manager lands here straight after login: nothing to pop,
        // so fall back to logout -> login instead of a dead button.
        if (!navController.popBackStack()) {
          MaterialLoaderApp.instance.authRepository.logout()
          navController.navigate(Routes.LOGIN) {
            popUpTo(0) { inclusive = true }
          }
        }
      },
      onLogout = {
        MaterialLoaderApp.instance.authRepository.logout()
        navController.navigate(Routes.LOGIN) {
          popUpTo(0) { inclusive = true }
        }
      }
    )
  }

  composable(Routes.MATERIAL_COLLECT_PREP) {
    // 集料员 (warehouse, full-scope) landing: same WMS-pushed WO dropdown
    // collect flow, titled as the warehouse Material Collect workspace.
    CollectScreen(
      title = "仓库集料 / Material Collect",
      actorLabel = "集料人",
      onBack = {
        // 集料员 lands here straight after login: nothing to pop,
        // so fall back to logout -> login instead of a dead button.
        if (!navController.popBackStack()) {
          MaterialLoaderApp.instance.authRepository.logout()
          navController.navigate(Routes.LOGIN) {
            popUpTo(0) { inclusive = true }
          }
        }
      },
      onLogout = {
        MaterialLoaderApp.instance.authRepository.logout()
        navController.navigate(Routes.LOGIN) {
          popUpTo(0) { inclusive = true }
        }
      }
    )
  }

        composable(Routes.RETURN_SLIP) {
            ReturnSlipListScreen(
                onBack = { navController.popBackStack() },
                onNavigateToDetail = { docId -> navController.navigate("${Routes.RETURN_SLIP_DETAIL}/$docId") },
                onNavigateToCreate = { navController.navigate(Routes.RETURN_SLIP_EDIT_NEW) }
            )
        }

        composable(Routes.REPLENISHMENT) {
            ReplenishmentListScreen(
                onBack = { navController.popBackStack() },
                onNavigateToDetail = { docId -> navController.navigate("${Routes.REPLENISHMENT_DETAIL}/$docId") },
                onNavigateToCreate = { navController.navigate(Routes.REPLENISHMENT_EDIT_NEW) }
            )
        }

        // ── Document Detail Routes ────────────────────────────────────

        composable("${Routes.INBOUND_DETAIL}/{docId}") { backStackEntry ->
            val docId = backStackEntry.arguments?.getString("docId")?.toLongOrNull() ?: 0L
            InboundDetailScreen(
                onBack = { navController.popBackStack() },
                docId = docId,
                onNavigateToEdit = { id -> navController.navigate("${Routes.INBOUND_EDIT}/$id") },
                onNavigateToList = { navController.popBackStack(Routes.INBOUND, false) }
            )
        }

        composable("${Routes.OUTBOUND_DETAIL}/{docId}") { backStackEntry ->
            val docId = backStackEntry.arguments?.getString("docId")?.toLongOrNull() ?: 0L
            OutboundDetailScreen(
                onBack = { navController.popBackStack() },
                docId = docId,
                onNavigateToEdit = { id -> navController.navigate("${Routes.OUTBOUND_EDIT}/$id") },
                onNavigateToList = { navController.popBackStack(Routes.OUTBOUND, false) }
            )
        }

        composable("${Routes.REQUISITION_DETAIL}/{docId}") { backStackEntry ->
            val docId = backStackEntry.arguments?.getString("docId")?.toLongOrNull() ?: 0L
            RequisitionDetailScreen(
                onBack = { navController.popBackStack() },
                docId = docId,
                onNavigateToEdit = { id -> navController.navigate("${Routes.REQUISITION_EDIT}/$id") },
                onNavigateToList = { navController.popBackStack(Routes.REQUISITION, false) }
            )
        }

        composable("${Routes.RETURN_SLIP_DETAIL}/{docId}") { backStackEntry ->
            val docId = backStackEntry.arguments?.getString("docId")?.toLongOrNull() ?: 0L
            ReturnSlipDetailScreen(
                onBack = { navController.popBackStack() },
                docId = docId,
                onNavigateToEdit = { id -> navController.navigate("${Routes.RETURN_SLIP_EDIT}/$id") },
                onNavigateToList = { navController.popBackStack(Routes.RETURN_SLIP, false) }
            )
        }

        composable("${Routes.REPLENISHMENT_DETAIL}/{docId}") { backStackEntry ->
            val docId = backStackEntry.arguments?.getString("docId")?.toLongOrNull() ?: 0L
            ReplenishmentDetailScreen(
                onBack = { navController.popBackStack() },
                docId = docId,
                onNavigateToEdit = { id -> navController.navigate("${Routes.REPLENISHMENT_EDIT}/$id") },
                onNavigateToList = { navController.popBackStack(Routes.REPLENISHMENT, false) }
            )
        }

        // ── Document Edit Routes ──────────────────────────────────────

        composable("${Routes.INBOUND_EDIT}/{docId}") { backStackEntry ->
            val docIdStr = backStackEntry.arguments?.getString("docId")
            val editId = docIdStr?.toLongOrNull()
            InboundEditScreen(
                onBack = { navController.popBackStack() },
                editId = editId
            )
        }

        composable("${Routes.OUTBOUND_EDIT}/{docId}") { backStackEntry ->
            val docIdStr = backStackEntry.arguments?.getString("docId")
            val editId = docIdStr?.toLongOrNull()
            OutboundEditScreen(
                onBack = { navController.popBackStack() },
                editId = editId
            )
        }

        composable("${Routes.REQUISITION_EDIT}/{docId}") { backStackEntry ->
            val docIdStr = backStackEntry.arguments?.getString("docId")
            val editId = docIdStr?.toLongOrNull()
            RequisitionEditScreen(
                onBack = { navController.popBackStack() },
                editId = editId
            )
        }

        composable("${Routes.RETURN_SLIP_EDIT}/{docId}") { backStackEntry ->
            val docIdStr = backStackEntry.arguments?.getString("docId")
            val editId = docIdStr?.toLongOrNull()
            ReturnSlipEditScreen(
                onBack = { navController.popBackStack() },
                editId = editId
            )
        }

        composable("${Routes.REPLENISHMENT_EDIT}/{docId}") { backStackEntry ->
            val docIdStr = backStackEntry.arguments?.getString("docId")
            val editId = docIdStr?.toLongOrNull()
            ReplenishmentEditScreen(
                onBack = { navController.popBackStack() },
                editId = editId
            )
        }

        // ── New Document Routes ───────────────────────────────────────

        composable(Routes.INBOUND_EDIT_NEW) {
            InboundEditScreen(onBack = { navController.popBackStack() }, editId = null)
        }

        composable(Routes.OUTBOUND_EDIT_NEW) {
            OutboundEditScreen(onBack = { navController.popBackStack() }, editId = null)
        }

        composable(Routes.REQUISITION_EDIT_NEW) {
            RequisitionEditScreen(onBack = { navController.popBackStack() }, editId = null)
        }

        composable(Routes.RETURN_SLIP_EDIT_NEW) {
            ReturnSlipEditScreen(onBack = { navController.popBackStack() }, editId = null)
        }

        composable(Routes.REPLENISHMENT_EDIT_NEW) {
            ReplenishmentEditScreen(onBack = { navController.popBackStack() }, editId = null)
        }
        }

        if (prefs.hasToken() && currentRoute != Routes.LOGIN) {
            val pickup = cockpitState.alerts.firstOrNull { it.title.contains("PICKUP", ignoreCase = true) }
            if (pickup != null && com.smt.materialloader.ui.login.RuntimeRights.can(prefs, "ng.pickup.ack")) {
                Surface(color = Color(0xFF991B1B), shadowElevation = 10.dp, modifier = Modifier.fillMaxWidth().padding(8.dp)) {
                    Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                        Text("URGENT ALARM · 回修完成待取件", color = Color.White)
                        Text(pickup.detail, color = Color.White)
                        Button(onClick = { navController.navigate(Routes.MANAGER_ALERTS) }) { Text("OPEN ALERT") }
                    }
                }
            }
        }
    }
}
