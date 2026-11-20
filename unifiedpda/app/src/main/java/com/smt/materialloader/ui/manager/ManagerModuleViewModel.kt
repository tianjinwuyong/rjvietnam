package com.smt.materialloader.ui.manager

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.repository.WorkOrderRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

data class ManagerModuleState(
    val mesOnline: Boolean = false,
    val lastUpdated: String = "",
    val items: List<ManagerModuleItem> = emptyList(),
    val kpiSummary: String = "",
    val actionMessage: String? = null,
    val actionSucceeded: Boolean = false,
    val pendingAction: Boolean = false,
    val error: String? = null
)

class ManagerModuleViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService
    private val workOrders = WorkOrderRepository()
    // MES assigns this scope at login (manual/auto/SMT); do not expose a local line switch.
    private val lineCode: String
        get() = MaterialLoaderApp.instance.prefs.getLineCode().ifBlank { "L004" }
    private val _state = MutableStateFlow(ManagerModuleState())
    val state: StateFlow<ManagerModuleState> = _state.asStateFlow()

    fun load(module: ManagerModule, force: Boolean = false) {
        if (!force && _state.value.lastUpdated.isNotEmpty()) return
        viewModelScope.launch {
            try {
                val response = when (module) {
                    ManagerModule.ALERTS, ManagerModule.REPAIR -> api.managerAlerts(lineCode)
                    ManagerModule.DECISIONS -> api.managerDecisions(lineCode)
                    ManagerModule.APPROVALS -> api.managerDecisions("")
                    ManagerModule.ORG_CHART -> api.hrOrgChart()
                    ManagerModule.COMMUNICATIONS -> api.managerChannels()
                    ManagerModule.TEAM -> api.managerTeam(lineCode)
                    ManagerModule.ASSIGNMENTS -> api.managerLineAssignments()
                    ManagerModule.HIRING_REQUESTS -> api.managerHiringRequests()
                    ManagerModule.GRIEVANCE_CASES -> api.managerGrievanceCases()
                    ManagerModule.TARGETS -> api.managerTargets(lineCode)
                    ManagerModule.LINE_STATUS -> api.mesLine(lineCode)
                    ManagerModule.LOADING_STATUS -> api.smtLoadingWorkOrders(lineCode)
                    ManagerModule.WORK_ORDERS -> api.pmcWorkOrders(limit = 100)
                    ManagerModule.HANDOVER -> api.managerHandover(lineCode)
                    ManagerModule.PROFILE -> api.getSession()
                    ManagerModule.PLANT_MANAGER -> api.plantManagerExceptionRequests()
                }
                val body = response.body() as? JsonObject
                val auditBody = if (module == ManagerModule.PROFILE) {
                    runCatching { api.managerAudit(lineCode).body() as? JsonObject }.getOrNull()
                } else null
                val kpi = if (module == ManagerModule.LINE_STATUS) {
                    val k = body?.getAsJsonObject("data")?.getAsJsonObject("stationKpi")
                    if (k != null) "平均工作 ${k["workingHoursToday"]?.asString ?: "0"} h · 平均停机 ${k["stoppedHoursToday"]?.asString ?: "0"} h · 运行率 ${k["availabilityPct"]?.asString ?: "0"}%" else ""
                } else ""
                _state.value = ManagerModuleState(
                    mesOnline = response.isSuccessful,
                    lastUpdated = now(),
                    items = parseItems(module, body) + parseAudit(auditBody),
                    kpiSummary = kpi,
                    error = if (response.isSuccessful) null else local("MES 返回 HTTP ${response.code()}：${module.endpoint}", "MES returned HTTP ${response.code()} for ${module.endpoint}", "MES trả về HTTP ${response.code()} cho ${module.endpoint}")
                )
            } catch (e: Exception) {
                _state.value = ManagerModuleState(lastUpdated = now(), error = local("MES 连接失败：${e.message}", "MES connection failed: ${e.message}", "Kết nối MES thất bại: ${e.message}"))
            }
        }
    }

    fun perform(
        module: ManagerModule,
        action: String,
        recordId: String,
        comment: String,
        owner: String = ""
    ) {
        if (recordId.isBlank()) {
            _state.value = _state.value.copy(actionMessage = local("操作前必须选择 MES 记录", "Select an MES record before this action", "Phải chọn bản ghi MES trước khi thao tác"), actionSucceeded = false)
            return
        }
        if ((action == "reject" || action == "information" || action == "message" || action == "recovery" || action == "confirm" || action == "complete") && comment.isBlank()) {
            _state.value = _state.value.copy(actionMessage = local("必须填写说明或原因", "Comment or reason is required", "Bắt buộc nhập ghi chú hoặc lý do"), actionSucceeded = false)
            return
        }
        if (action == "assign" && owner.isBlank()) {
            _state.value = _state.value.copy(actionMessage = local("必须填写接收人工号", "Owner employee code is required", "Phải nhập mã nhân viên nhận việc"), actionSucceeded = false)
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(pendingAction = true, actionMessage = null)
            try {
                val requestId = UUID.randomUUID().toString()
                val actor = MaterialLoaderApp.instance.authRepository.getCurrentUser()?.username.orEmpty()
                val body = mapOf(
                    "lineCode" to lineCode,
                    "comment" to comment,
                    "reason" to comment,
                    "actor" to actor,
                    "idempotencyKey" to requestId
                )
                val outcome: Pair<Boolean, String?> = when (module) {
                    ManagerModule.ALERTS, ManagerModule.REPAIR -> when (action) {
                        "acknowledge" -> api.managerAcknowledgeAlert(recordId, body).toOutcome()
                        "assign" -> api.managerAssignAlert(
                            recordId,
                            body + mapOf(
                                "ownerEmployeeCode" to owner,
                                "assignee" to owner,
                                "dueAt" to java.time.Instant.now().plusSeconds(2 * 3600).toString()
                            )
                        ).toOutcome()
                        else -> api.managerEscalateAlert(recordId, body).toOutcome()
                    }
                    ManagerModule.DECISIONS, ManagerModule.APPROVALS -> when (action) {
                        "approve" -> api.managerApproveDecision(recordId, body).toOutcome()
                        "reject" -> api.managerRejectDecision(recordId, body).toOutcome()
                        else -> api.managerAskDecisionInformation(recordId, body).toOutcome()
                    }
                    ManagerModule.TEAM -> api.managerSendMessage(body + mapOf("audience" to recordId, "message" to comment, "requiresAcknowledgement" to true)).toOutcome()
                    ManagerModule.TARGETS -> api.managerCreateRecoveryAction(body + mapOf("targetId" to recordId, "ownerEmployeeCode" to recordId)).toOutcome()
                    ManagerModule.HANDOVER -> api.managerConfirmHandover(body + mapOf("receiverEmployeeCode" to recordId)).toOutcome()
                    ManagerModule.WORK_ORDERS -> when (action) {
                        "lock" -> workOrders.lockWorkOrder(recordId, actor).let { it.isSuccess to it.exceptionOrNull()?.message }
                        "unlock" -> workOrders.unlockWorkOrder(recordId, actor).let { it.isSuccess to it.exceptionOrNull()?.message }
                        else -> workOrders.completeWorkOrder(recordId, actor).let { it.isSuccess to it.exceptionOrNull()?.message }
                    }
                    else -> false to local("MES 未提供该操作", "MES does not expose this action", "MES không cung cấp thao tác này")
                }
                val (accepted, serverMessage) = outcome
                _state.value = _state.value.copy(
                    pendingAction = false,
                    actionMessage = if (accepted) local("MES 已确认 $action", "MES confirmed $action", "MES đã xác nhận $action") + (serverMessage?.let { ": $it" } ?: "") else local("MES 拒绝 $action：${serverMessage ?: "请求未被确认"}", "MES rejected $action: ${serverMessage ?: "request not confirmed"}", "MES từ chối $action: ${serverMessage ?: "yêu cầu chưa được xác nhận"}"),
                    actionSucceeded = accepted,
                    lastUpdated = now()
                )
                // Closed loop: the authoritative state is re-read after every
                // accepted write so the list shows MES' result, not a local guess.
                if (accepted) load(module, force = true)
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    pendingAction = false,
                    actionMessage = local("操作结果未知：${e.message}（MES 未确认，请刷新后重试）", "Action outcome unknown: ${e.message} (MES did not confirm; refresh and retry)", "Kết quả chưa rõ: ${e.message} (MES chưa xác nhận; hãy làm mới và thử lại)"),
                    actionSucceeded = false
                )
            }
        }
    }

    private fun parseItems(module: ManagerModule, body: JsonObject?): List<ManagerModuleItem> {
        if (body == null) return emptyList()
        if (module == ManagerModule.LINE_STATUS) {
            val runtime = body.getAsJsonObject("data")?.getAsJsonArray("stationRuntime") ?: return emptyList()
            return runtime.map { element ->
                val o = element.asJsonObject
                ManagerModuleItem(
                    o.string("stationCode") ?: "Station",
                    "状态 ${o.string("status") ?: "UNKNOWN"} · 瞬时心跳 ${o.string("lastSeen") ?: "-"} · 最后事件 ${o.string("lastEventAt") ?: "-"}",
                    "今日运行 ${o.string("runtimeMinutesToday") ?: "0"} 分钟 · 推算停机 ${o.string("inferredStopMinutesToday") ?: "0"} 分钟",
                    o.string("stationCode")
                )
            }
        }
        val array = sequenceOf("data", "items", "employees", "records", "rows")
            .mapNotNull { body.get(it) }
            .mapNotNull { it.asArrayOrNull() }
            .firstOrNull() ?: return emptyList()
        return array.mapNotNull { element ->
            val o = element.asJsonObject
            if (module == ManagerModule.REPAIR) {
                val payload = o.getAsJsonObject("payload")
                val type = o["type"]?.asString ?: payload?.get("type")?.asString
                if (type != "MAINTENANCE_PICKUP_READY" && type != "REPAIR_STATUS" && type != "REPAIR_SLA_ALERT") return@mapNotNull null
            }
            when (module) {
                ManagerModule.TEAM -> ManagerModuleItem(
                    o.string("displayName", "name_zh", "name_en", "code") ?: "Employee",
                    "${o.string("code", "employeeCode") ?: ""} · ${o.string("departmentNameZh", "departmentCode") ?: "HR department"}",
                    "${o.string("positionTitleZh", "positionTitleEn") ?: "Position unknown"} · HR status ${o.string("status") ?: "unknown"}",
                    o.string("code", "employeeCode", "id")
                )
                ManagerModule.LOADING_STATUS -> {
                    val materials = o["materials"]?.asJsonArray?.map { material ->
                        val m = material.asJsonObject
                        "${m.string("materialCode") ?: "-"}: 实际${m.string("actualConsumedQty") ?: "0"}，${m.string("actualConsumptionRatePerMinute") ?: "0"}/分钟"
                    }?.take(6)?.joinToString("；") ?: "暂无实际物料消耗事件"
                    ManagerModuleItem(
                        o.string("workOrderCode", "code") ?: "MES工单",
                        "实际消耗 ${o.string("actualConsumedQty") ?: "0"} · 生产速度 ${o.string("estimatedProductionRatePerMinute") ?: "0"} 产品/分钟\n$materials",
                        "产线 ${o.string("lineCode") ?: "-"} · 速度来源 ${o.string("rateSource") ?: "MES_OUTPUT_HISTORY"}",
                        o.string("workOrderCode", "code", "id")
                    )
                }
                ManagerModule.WORK_ORDERS -> ManagerModuleItem(
                    o.string("code", "workOrderCode", "work_order_code") ?: "PMC工单",
                    "产品 ${o.string("productCode") ?: "-"} · 计划 ${o.string("plannedQty") ?: "0"} · 已完成 ${o.string("completedQty", "actualQty") ?: "0"}",
                    "状态 ${o.string("status") ?: "unknown"} · 产线 ${o.string("lineCode") ?: "-"} · 锁定 ${o.string("lockedBy") ?: "无"}",
                    o.string("code", "workOrderCode", "id")
                )
                else -> ManagerModuleItem(
                    o.string("title", "name", "code", "id") ?: module.title,
                    o.string("detail", "description", "message", "reason") ?: "MES record received",
                    listOfNotNull(
                        o.string("status", "state") ?: "MES status received",
                        o.string("expiresAt", "expiry", "validUntil", "authorizationValidUntil")?.let { local("有效期至 $it", "expires $it", "hết hạn $it") },
                        o.string("requestedBy", "requester", "actor")?.let { local("申请人 $it", "requested by $it", "yêu cầu bởi $it") }
                    ).joinToString(" · "),
                    o.string("id", "alertId", "decisionId", "eventId", "recordId", "code")
                )
            }
        }
    }

    private fun parseAudit(body: JsonObject?): List<ManagerModuleItem> {
        val rows = body?.getAsJsonArray("data") ?: body?.getAsJsonArray("items") ?: return emptyList()
        return rows.map { element ->
            val o = element.asJsonObject
            ManagerModuleItem(
                o.string("action", "eventType", "operation") ?: "AUDIT",
                o.string("detail", "description", "comment", "reason") ?: "MES audit record",
                "${o.string("actor", "performedBy", "operator") ?: "-"} · ${o.string("createdAt", "at", "timestamp") ?: "-"}",
                o.string("id", "auditId")
            )
        }
    }

    private fun now() = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
    private fun local(zh: String, en: String, vi: String): String = when (MaterialLoaderApp.instance.prefs.getLocale()) {
        "vi-VN" -> vi
        "en-US" -> en
        else -> zh
    }
}

private fun JsonElement.asArrayOrNull(): JsonArray? = if (isJsonArray) asJsonArray else null
private fun JsonObject.string(vararg names: String): String =
    names.asSequence().mapNotNull { get(it)?.takeUnless { v -> v.isJsonNull }?.asString }
        .firstOrNull().orEmpty()

private fun retrofit2.Response<JsonObject>.toOutcome(): Pair<Boolean, String?> =
    isSuccessful to (
        body()?.get("message")?.takeUnless { it.isJsonNull }?.asString
            ?: if (isSuccessful) null else "HTTP ${this.code()}"
        )
