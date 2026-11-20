package com.smt.materialloader.ui.pdaloading

import android.app.Application
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonObject
import com.smt.materialloader.BuildConfig
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.offline.OfflineLoadingStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit

enum class LoadingStep { SETUP, MATERIAL, MACHINE, SLOT, FEEDER, REEL, CONFIRM, RELEASED }

data class BoundSlot(
    val id: Long, val machine: String, val slot: String, val feeder: String,
    val materialSn: String, val material: String, val lot: String, val qty: String
)

data class MesWorkOrder(
    val code: String, val status: String, val productCode: String,
    val productName: String, val plannedQty: Int,
    val materialCount: Int, val boundMaterialCount: Int,
    val materials: List<MesWoMaterial>,
    val lineCode: String = "",
    val plannedStartAt: String? = null,
    val plannedFinishAt: String? = null,
    val loadingTimeStatus: String = "NOT_SCHEDULED",
    val loadingOpenAt: String? = null,
    val materialLoadingStatus: String = "NOT_SCHEDULED",
    val estimatedProductionRatePerHour: Double = 0.0,
    val estimatedProductionFinishAt: String? = null,
    val rateSource: String = "MES_OUTPUT_HISTORY",
    val estimatedProductionRatePerMinute: Double = 0.0,
    val requiredPdaCount: Int = 0,
    val activePdaCount: Int = 0
    ,val activeForLoading: Boolean = false
)

data class MesWoMaterial(
    val code: String, val name: String, val qtyPer: String,
    val requiredQty: String, val availableQty: String, val projectedQty: String,
    val safetyStockQty: String, val supplySafe: Boolean,
    val uom: String, val bound: Boolean, val loadingSequence: Int = 0,
    val rollQty: String = "0", val consumptionRatePerHour: String = "0",
    val consumptionRatePerMinute: String = "0",
    val actualConsumedQty: String = "0", val actualConsumptionRatePerMinute: String = "0",
    val estimatedDepletionAt: String? = null
)

data class PdaQualityCheck(val label: String, val pass: Boolean)

data class PdaBindingSuccess(
    val materialCode: String,
    val materialSn: String,
    val boundCount: Int,
    val requiredCount: Int,
    val allMaterialsBound: Boolean
)

data class PdaLoadingState(
    val language: String = "zh",
    val workOrder: String = "",
    val workOrders: List<MesWorkOrder> = emptyList(),
    val assignedMaterialCodes: Set<String> = emptySet(),
    val dispatchReady: Boolean = false,
    val loadingWorkOrders: Boolean = true,
    val testBypassAllChecks: Boolean = false,
    val testBypassReason: String = "",
    val testBypassAuthorizedBy: String = "",
    val testBypassedActions: Set<String> = emptySet(),
    val testLoadingStartAt: String? = null,
    val testLoadingCloseAt: String? = null,
    val deferMaterialApproval: Boolean = false,
    val machine: String = "",
    val sessionId: Long? = null,
    val step: LoadingStep = LoadingStep.SETUP,
    val slot: String = "",
    val feeder: String = "",
    val materialSn: String = "",
    val material: String = "",
    val materialVerified: Boolean = false,
    val materialQty: String = "",
    val materialRemainingQty: String = "",
    val registrationRequired: Boolean = false,
    val expectedMachine: String = "",
    val expectedSlot: String = "",
    val expectedFeeder: String = "",
    val lot: String = "",
    val dateCode: String = "",
    val boundSlots: List<BoundSlot> = emptyList(),
    val busy: Boolean = false,
    val online: Boolean = true,
    val offlinePending: Int = 0,
    val offlineExpiresAt: String? = null,
    val loadingBlocked: Boolean = false,
    val qualityChecks: List<PdaQualityCheck> = emptyList(),
    val bindingSuccess: PdaBindingSuccess? = null,
    val completedWorkOrderCode: String? = null,
    val alarm: String? = null,
    val message: String = ""
)

class PdaLoadingViewModel(application: Application) : AndroidViewModel(application) {
    private val api = MaterialLoaderApp.instance.apiService
    private val offlineStore = OfflineLoadingStore(application)
    private val deviceId = Settings.Secure.getString(
        application.contentResolver, Settings.Secure.ANDROID_ID
    ) ?: android.os.Build.MODEL
    private val _state = MutableStateFlow(PdaLoadingState())
    val state: StateFlow<PdaLoadingState> = _state.asStateFlow()

    // MES is the source of truth. The PDA never lets the operator choose a
    // line locally; lineCode and operator identity come from the login session.
    private fun mesLineCode(): String? = MaterialLoaderApp.instance.prefs.getUser()
        ?.lineCode?.trim()?.uppercase()?.takeIf { it.isNotBlank() }

    private fun mesOperatorBadge(): String? = MaterialLoaderApp.instance.prefs.getUser()
        ?.username?.trim()?.uppercase()?.takeIf { it.isNotBlank() }

    init { refreshWorkOrders(false) }

    fun language(value: String) { _state.value = _state.value.copy(language = value) }
    fun selectWorkOrder(value: String) {
        val code = value.uppercase()
        val candidate = _state.value.workOrders.firstOrNull { it.code == code }
        if (candidate == null) return alarm("MES宸ュ崟涓嶅瓨鍦ㄦ垨鏈繕鍥炴墍鏈夋暟鎹� / Work order is not available")
        if (!candidate.activeForLoading) {
            return alarm("MES仅允许当前激活工单上料；该工单正在排队 / Only the MES active work order may be loaded; this work order is queued")
        }
        _state.value = _state.value.copy(workOrder = code, alarm = null)
    }
    fun enableTestBypass(reason: String = "PDA TEST MODE", authorizedBy: String = "PDA-TEST-AUTO") {
        val testStart = Instant.now()
        val testClose = testStart.plus(10, ChronoUnit.MINUTES)
        if (_state.value.workOrder !in setOf("26072019999", "26072019998", "26072019997")) return alarm("测试旁路仅允许测试工单")
        _state.value = _state.value.copy(
            testBypassAllChecks = true,
            testBypassReason = reason.trim(),
            testBypassAuthorizedBy = authorizedBy.trim().uppercase(),
            testLoadingStartAt = testStart.toString(),
            testLoadingCloseAt = testClose.toString(),
            message = "测试直通模式：MES仅保留绑定记录"
        )
    }

    fun refreshWorkOrders(showLoading: Boolean = true) = viewModelScope.launch {
        val lineCode = mesLineCode()
        if (lineCode == null) {
            _state.value = _state.value.copy(
                loadingWorkOrders = false,
                online = false,
                message = "MES 登录会话没有分配产线，请重新登录"
            )
            return@launch
        }
        if (showLoading || _state.value.workOrders.isEmpty()) {
            _state.value = _state.value.copy(loadingWorkOrders = true)
        }
        try {
            val response = api.smtLoadingWorkOrders(lineCode, mesOperatorBadge().orEmpty(), deviceId)
            val body = response.body()
            if (!response.isSuccessful || body == null) {
                throw IllegalStateException(response.errorBody()?.string() ?: "MES work-order request failed")
            }
            val list = body.getAsJsonArray("data")?.map { item ->
                val row = item.asJsonObject
                MesWorkOrder(
                    code = row["workOrderCode"]?.asString ?: "",
                    status = row["status"]?.asString ?: "",
                    productCode = row["productCode"]?.asString ?: "",
                    productName = row["productNameZh"]?.asString ?: "",
                    plannedQty = row["plannedQty"]?.asInt ?: 0,
                    lineCode = row["lineCode"]?.asString ?: "",
                    materialCount = row["materialCount"]?.asInt ?: 0,
                    boundMaterialCount = row["boundMaterialCount"]?.asInt ?: 0,
                    plannedStartAt = row["plannedStartAt"]?.takeIf { !it.isJsonNull }?.asString,
                    plannedFinishAt = row["plannedFinishAt"]?.takeIf { !it.isJsonNull }?.asString,
                    loadingTimeStatus = row["loadingTimeStatus"]?.asString ?: "NOT_SCHEDULED",
                    loadingOpenAt = row["loadingOpenAt"]?.takeIf { !it.isJsonNull }?.asString,
                    materialLoadingStatus = row["materialLoadingStatus"]?.asString ?: "NOT_SCHEDULED",
                    estimatedProductionRatePerHour = row["estimatedProductionRatePerHour"]?.asDouble ?: 0.0,
                    estimatedProductionFinishAt = row["estimatedProductionFinishAt"]?.takeIf { !it.isJsonNull }?.asString,
                    rateSource = row["rateSource"]?.asString ?: "MES_OUTPUT_HISTORY",
                    estimatedProductionRatePerMinute = row["estimatedProductionRatePerMinute"]?.asDouble ?: 0.0,
                    requiredPdaCount = row["requiredPdaCount"]?.asInt ?: 0,
                    activePdaCount = row["activePdaCount"]?.asInt ?: 0,
                    activeForLoading = row["activeForLoading"]?.asBoolean ?: false,
                    materials = row.getAsJsonArray("materials")?.map { material ->
                        val m = material.asJsonObject
                        MesWoMaterial(
                            m["materialCode"]?.asString ?: "",
                            m["nameZh"]?.asString ?: "",
                            m["qtyPer"]?.asString ?: "0",
                            m["requiredQty"]?.asString ?: "0",
                            m["availableQty"]?.asString ?: "0",
                            m["projectedQty"]?.asString ?: "0",
                            m["safetyStockQty"]?.asString ?: "0",
                            m["supplySafe"]?.asBoolean ?: false,
                            m["uom"]?.asString ?: "",
                            m["bound"]?.asBoolean ?: false,
                            m["loadingSequence"]?.asInt ?: 0,
                            m["rollQty"]?.asString ?: "0"
                            ,m["consumptionRatePerHour"]?.asString ?: "0",
                            m["consumptionRatePerMinute"]?.asString ?: "0",
                            m["actualConsumedQty"]?.asString ?: "0",
                            m["actualConsumptionRatePerMinute"]?.asString ?: "0",
                            m["estimatedDepletionAt"]?.takeIf { !it.isJsonNull }?.asString
                        )
                    } ?: emptyList()
                )
            }?.filter { it.code.isNotBlank() } ?: emptyList()
            // MES owns the active-work-order decision. Never fall back to an
            // arbitrary queued WO: loading must stop until MES publishes one.
            val active = list.filter { it.activeForLoading }
            val selected = _state.value.workOrder.takeIf { current -> active.any { it.code == current } }
                ?: active.firstOrNull()?.code.orEmpty()
            val assignmentCodes = fetchDispatchMaterialCodes(selected, lineCode)
            _state.value = _state.value.copy(
                workOrders = list, workOrder = selected,
                assignedMaterialCodes = assignmentCodes ?: emptySet(),
                dispatchReady = true,
                loadingWorkOrders = false,
                online = true, alarm = null,
                message = if (_state.value.step == LoadingStep.SETUP) {
                    if (list.isEmpty()) "等待MES下发工单" else "请选择MES工单"
                } else {
                    _state.value.message
                }
            )
            syncOfflineEvents()
        } catch (e: Exception) {
            _state.value = _state.value.copy(
                loadingWorkOrders = false, online = false,
                alarm = e.message ?: "MES工单下发失败", message = "MES离线，无法接收工单"
            )
            alarmTone()
        }
    }

    private suspend fun fetchDispatchMaterialCodes(workOrderCode: String, lineCode: String): Set<String>? {
        if (workOrderCode.isBlank()) return emptySet()
        return try {
            val response = api.dispatchAssignments(deviceId, workOrderCode, lineCode)
            if (!response.isSuccessful) return emptySet()
            response.body()?.getAsJsonArray("assignments")?.mapNotNull { row ->
                row.asJsonObject["materialCode"]?.asString?.trim()?.uppercase()?.takeIf { it.isNotBlank() }
            }?.toSet() ?: emptySet()
        } catch (_: Exception) {
            null
        }
    }

    fun begin() {
        val s = _state.value
        if (s.testBypassAllChecks && s.testLoadingCloseAt?.let { runCatching { Instant.parse(it) }.getOrNull() }?.let { Instant.now() >= it } == true) {
            alarm("测试上料窗口已关闭 / Test loading window is closed")
            return
        }
        if (s.dispatchReady && s.assignedMaterialCodes.isEmpty()) {
            alarm("MES has not assigned materials to this PDA; loading is blocked")
            return
        }
        if (s.workOrder.isBlank()) {
            alarm("工单不能为空 / Work order is required")
            return
        }
        val selected = s.workOrders.firstOrNull { it.code == s.workOrder }
        if (selected == null || !selected.activeForLoading) {
            alarm("MES has not activated this work order for loading")
            return
        }
        if (selected != null && selected.materialCount > 0 &&
            selected.boundMaterialCount >= selected.materialCount
        ) {
            alarm("该工单物料已全部绑定，请选择下一张工单 / This work order is complete; select the next one")
            return
        }
        _state.value = s.copy(step = LoadingStep.MATERIAL, alarm = null, message = "请扫物料卷码")
    }

    /** Ask MES to move the current published loading window to now after a
     * pause, feeder fault, or replacement. MES keeps the audit record and
     * recalculates the next feeding deadline; the PDA never edits schedule
     * data locally. */
    fun recalculateLoadingStart(reason: String = "PAUSED_LOADING") = viewModelScope.launch {
        val s = _state.value
        val lineCode = mesLineCode() ?: return@launch alarm("MES session has no assigned line")
        val operatorBadge = mesOperatorBadge() ?: return@launch alarm("MES session has no operator identity")
        if (s.workOrder.isBlank()) return@launch alarm("Work order is required")
        _state.value = s.copy(busy = true, alarm = null)
        try {
            val response = api.smtLoadingRecalculateStart(payload(mapOf(
                "workOrderCode" to s.workOrder,
                "lineCode" to lineCode,
                "domainCode" to "MANUAL_LINE",
                "operatorBadge" to operatorBadge,
                "reason" to reason
            )))
            val data = requireData(response.isSuccessful, response.body(), response.errorBody()?.string())
            _state.value = _state.value.copy(
                busy = false,
                online = true,
                message = "MES recalculated loading start: ${data["plannedStartAt"]?.asString ?: "now"}",
                alarm = null
            )
            successTone()
            refreshWorkOrders(false)
        } catch (e: Exception) {
            _state.value = _state.value.copy(busy = false, alarm = e.message ?: "MES recalculation failed")
            alarmTone()
        }
    }

    fun reportFeederRemaining(remainingQty: Double, reason: String = "PERIODIC_CHECK") = viewModelScope.launch {
        val s = _state.value
        val session = s.sessionId ?: return@launch alarm("请先开始上料会话")
        val operatorBadge = mesOperatorBadge() ?: return@launch alarm("MES session has no operator identity")
        val current = s.boundSlots.lastOrNull()
        val machine = s.machine.ifBlank { current?.machine.orEmpty() }
        val slot = s.slot.ifBlank { current?.slot.orEmpty() }
        val feeder = s.feeder.ifBlank { current?.feeder.orEmpty() }
        val material = s.material.ifBlank { current?.material.orEmpty() }
        if (machine.isBlank() || slot.isBlank() || feeder.isBlank() || material.isBlank()) {
            return@launch alarm("请先完成机器、通道、飞达和物料绑定")
        }
        if (!remainingQty.isFinite() || remainingQty < 0) return@launch alarm("剩余数量必须是非负数字")
        _state.value = s.copy(busy = true, alarm = null)
        try {
            val response = api.smtLoadingFeederRemaining(payload(mapOf(
                "sessionId" to session, "machineCode" to machine, "slotNo" to slot,
                "feederCode" to feeder, "materialCode" to material,
                "remainingQty" to remainingQty, "operatorBadge" to operatorBadge, "reason" to reason
            )))
            requireData(response.isSuccessful, response.body(), response.errorBody()?.string())
            _state.value = _state.value.copy(busy = false, online = true,
                message = "已上报飞达剩余数量 $remainingQty，MES 将计算下一次上料时间", alarm = null)
            successTone()
        } catch (e: Exception) {
            _state.value = _state.value.copy(busy = false, alarm = e.message ?: "剩余数量上报失败")
            alarmTone()
        }
    }

    fun returnLoadingHome() {
        val s = _state.value
        _state.value = s.copy(
            step = LoadingStep.SETUP,
            machine = "",
            sessionId = null,
            slot = "",
            feeder = "",
            materialSn = "",
            material = "",
            materialVerified = false,
            materialQty = "",
            materialRemainingQty = "",
            registrationRequired = false,
            expectedMachine = "",
            expectedSlot = "",
            expectedFeeder = "",
            lot = "",
            dateCode = "",
            qualityChecks = emptyList(),
            bindingSuccess = null,
            alarm = null,
            message = ""
        )
        refreshWorkOrders(false)
    }

    fun simulateCurrentScan() {
        val s = _state.value
        if (!BuildConfig.TEST_ACTION_BYPASS_ENABLED || !s.testBypassAllChecks || s.busy) return
        val wo = s.workOrders.firstOrNull { it.code == s.workOrder }
        val number = ((wo?.boundMaterialCount ?: 0) + 1).coerceAtLeast(1)
        val suffix = number.toString().padStart(3, '0')
        val expectedMaterial = wo?.materials?.getOrNull(number - 1)?.code.orEmpty()
        val prefix = when (s.workOrder) {
            "26072019998" -> "B"
            "26072019997" -> "C"
            else -> "A"
        }
        val simulated = when (s.step) {
            LoadingStep.MATERIAL -> "VTEST3WO-${s.workOrder}-MATERIAL-001"
            LoadingStep.MACHINE -> "VTEST-SMT-3WO-$prefix"
            LoadingStep.SLOT -> "F$suffix"
            LoadingStep.FEEDER -> "VTEST3WO-FD$suffix"
            LoadingStep.REEL -> {
                if (expectedMaterial.isBlank()) return
                _state.value = s.copy(material = expectedMaterial)
                "VTEST3WO-$prefix-$expectedMaterial-REEL$suffix"
            }
            else -> return
        }
        scan(simulated)
    }

    fun scan(raw: String) {
        val code = raw.trim().uppercase()
        if (code.isBlank() || _state.value.busy || _state.value.loadingBlocked) return
        when (_state.value.step) {
            LoadingStep.MATERIAL -> resolveMaterialFirst(code)
            LoadingStep.MACHINE -> startSession(code)
            LoadingStep.SLOT -> {
                val s = _state.value
                if (s.expectedSlot.isNotBlank() && !s.expectedSlot.equals(code, true)) {
                    alarm("通道不匹配：应为 ${s.expectedSlot}，扫描到 $code")
                } else {
                    _state.value = s.copy(slot = code, step = LoadingStep.FEEDER, message = "请扫飞达号")
                }
            }
            LoadingStep.FEEDER -> {
                val s = _state.value
                if (s.expectedFeeder.isNotBlank() && !s.expectedFeeder.equals(code, true)) {
                    alarm("Feeder不匹配：应为 ${s.expectedFeeder}，扫描到 $code")
                } else {
                    _state.value = s.copy(
                        feeder = code,
                        step = if (s.materialVerified) LoadingStep.CONFIRM else LoadingStep.REEL,
                        message = if (s.materialVerified) "机位、通道和Feeder已核验，正在完成上料" else "请扫物料盘码"
                    )
                    if (s.materialVerified) {
                        if (s.registrationRequired) confirmBinding() else completeRegisteredLoading()
                    }
                }
            }
            LoadingStep.REEL -> {
                _state.value = _state.value.copy(
                materialSn = code,
                step = LoadingStep.CONFIRM,
                message = "物料SN已读取，请核对并确认绑定 / Material SN accepted"
                )
                confirmBinding()
            }
            else -> alarm("当前步骤不接受扫码 / Scan is not accepted at this step")
        }
    }

    fun backStep() {
        val s = _state.value
        if (s.busy) return
        if (s.step == LoadingStep.RELEASED) {
            alarm("已放行记录不能返回修改 / Released records cannot be changed")
            return
        }
        if (s.boundSlots.isNotEmpty() && s.step == LoadingStep.SLOT) {
            alarm("已绑定记录不能用返回键撤销 / A committed binding cannot be undone with Back")
            return
        }
        _state.value = when (s.step) {
            LoadingStep.MATERIAL -> s.copy(step = LoadingStep.SETUP, message = "请选择MES工单", alarm = null)
            LoadingStep.MACHINE -> s.copy(step = LoadingStep.MATERIAL, message = "请扫物料卷码", alarm = null)
            LoadingStep.SLOT -> s.copy(
                step = LoadingStep.MACHINE, machine = "", sessionId = null,
                message = "请扫机位码", alarm = null
            )
            LoadingStep.FEEDER -> s.copy(
                step = LoadingStep.SLOT, slot = "", message = "请扫槽号", alarm = null
            )
            LoadingStep.REEL -> s.copy(
                step = LoadingStep.FEEDER, feeder = "", message = "请扫飞达号", alarm = null
            )
            LoadingStep.CONFIRM -> s.copy(
                step = LoadingStep.FEEDER, feeder = "", message = "请扫飞达号", alarm = null
            )
            else -> s
        }
    }

    fun enableMaterialCheckBypass() {
        if (!BuildConfig.TEST_ACTION_BYPASS_ENABLED) return
        val s = _state.value
        if (s.workOrder !in setOf("26072019999", "26072019998", "26072019997") || !s.testBypassAllChecks) {
            return alarm("必须先由线长启用测试工单旁路 / Test bypass authorization required")
        }
        _state.value = s.copy(
            deferMaterialApproval = false,
            testBypassedActions = s.testBypassedActions + setOf("MATERIAL_APPROVAL", "WMS_ROLL_VALIDATION"),
            message = "物料SN及全部物料审批已旁路；立即绑定，MES仅保留记录"
        )
    }

    fun bypassAction(requestedStep: LoadingStep) {
        val s = _state.value
        if (!BuildConfig.TEST_ACTION_BYPASS_ENABLED ||
            s.workOrder !in setOf("26072019999", "26072019998", "26072019997") ||
            !s.testBypassAllChecks
        ) {
            alarm("必须先由线长启用测试工单旁路 / Test bypass authorization required")
            return
        }
        if (s.step != requestedStep) {
            alarm("只能旁路当前步骤 / Only the current step can be bypassed")
            return
        }
        val action = s.step.name
        _state.value = s.copy(testBypassedActions = s.testBypassedActions + action)
        when (s.step) {
            LoadingStep.MATERIAL -> scan("VTEST3WO-${s.workOrder}-MATERIAL-001")
            LoadingStep.MACHINE -> startSession("VTEST-SMT-PDA-M01")
            LoadingStep.SLOT -> scan("F01")
            LoadingStep.FEEDER -> scan("VTEST-SMT-PDA-FD01")
            LoadingStep.REEL -> scan("VTEST-SMT-PDA-REEL-01")
            LoadingStep.CONFIRM -> confirmBinding()
            // Release still uses the real line-leader/manager who authorized test mode.
            LoadingStep.RELEASED, LoadingStep.SETUP -> Unit
        }
    }

    fun bypassRelease() {
        val s = _state.value
        if (!BuildConfig.TEST_ACTION_BYPASS_ENABLED ||
            s.workOrder !in setOf("26072019999", "26072019998", "26072019997") ||
            !s.testBypassAllChecks ||
            s.boundSlots.isEmpty()
        ) {
            alarm("测试放行旁路尚不可用 / Test release bypass is not available")
            return
        }
        _state.value = s.copy(testBypassedActions = s.testBypassedActions + "RELEASE")
        release(s.testBypassAuthorizedBy)
    }

    /**
     * Material-first loading gate. WMS owns the roll identity and quantity;
     * MES owns whether that roll already has a machine/slot/feeder binding.
     * A roll is never loaded from a locally typed material code.
     */
    private fun resolveMaterialFirst(materialQr: String) = viewModelScope.launch {
        val s = _state.value
        _state.value = s.copy(busy = true, alarm = null, message = "正在向WMS核验物料卷…")
        try {
            val response = api.resolveMaterialRoll(materialQr)
            val data = response.body()?.getAsJsonObject("data")
            val canIssue = data?.get("canIssue")?.asBoolean == true
            val canBind = data?.get("canBind")?.asBoolean == true
            if (!response.isSuccessful || data == null || (!canIssue && !canBind && !s.testBypassAllChecks)) {
                val reason = data?.get("validation")?.asString
                    ?: data?.get("message")?.asString
                    ?: "WMS拒绝该物料卷：未释放、数量不足或SN不存在"
                throw IllegalStateException(reason)
            }
            val wmsMaterial = data["materialCode"]?.asString.orEmpty()
                .ifBlank { data["vietnamMaterialCode"]?.asString.orEmpty() }
            val lot = data["lotNo"]?.asString.orEmpty()
            val dateCode = data["dateCode"]?.asString.orEmpty()
            val qty = data["availableQty"]?.asString.orEmpty()
                .ifBlank { data["quantity"]?.asString.orEmpty() }
            val expectedMaterial = s.workOrders.firstOrNull { it.code == s.workOrder }
                ?.materials?.firstOrNull { !it.bound }?.code.orEmpty()
            if (expectedMaterial.isNotBlank() && wmsMaterial.isNotBlank() &&
                !expectedMaterial.equals(wmsMaterial, ignoreCase = true)
            ) {
                throw IllegalStateException("物料不匹配：工单需要 $expectedMaterial，扫描到 $wmsMaterial")
            }

            var binding: JsonObject? = null
            if (!s.testBypassAllChecks) {
                val active = api.activeMaterialRollBinding(s.workOrder, materialQr)
                if (active.isSuccessful) {
                    binding = active.body()?.getAsJsonObject("data")
                } else if (active.code() != 404) {
                    val activeReason = active.errorBody()?.string().orEmpty()
                    if (!activeReason.contains("MATERIAL_NOT_BOUND", true)) {
                        throw IllegalStateException("MES查询物料绑定失败 (${active.code()})")
                    }
                }
            }
            val machine = binding?.get("machineCode")?.asString.orEmpty()
                .ifBlank { binding?.get("machine")?.asString.orEmpty() }
            val slot = binding?.get("slotNo")?.asString.orEmpty()
                .ifBlank { binding?.get("channel")?.asString.orEmpty() }
            val feeder = binding?.get("feederCode")?.asString.orEmpty()
                .ifBlank { binding?.get("feeder")?.asString.orEmpty() }
            val registered = machine.isNotBlank() && slot.isNotBlank() && feeder.isNotBlank()
            _state.value = _state.value.copy(
                busy = false, online = true, materialSn = materialQr,
                material = wmsMaterial, materialVerified = true,
                materialQty = qty, materialRemainingQty = data["remainingQty"]?.asString ?: qty,
                lot = lot, dateCode = dateCode, registrationRequired = !registered,
                expectedMachine = machine, expectedSlot = slot, expectedFeeder = feeder,
                step = LoadingStep.MACHINE,
                message = if (registered) {
                    "物料已注册：请扫描机位 $machine、通道 $slot、Feeder $feeder"
                } else {
                    "物料未注册：请扫描机位、通道和Feeder进行注册并上料"
                }
            )
            successTone()
        } catch (e: Exception) {
            _state.value = _state.value.copy(busy = false, alarm = e.message ?: "物料核验失败", message = "物料卷未通过WMS/MES核验")
            alarmTone()
        }
    }

    /** Complete a previously registered roll without creating a duplicate binding. */
    private fun completeRegisteredLoading() = viewModelScope.launch {
        val s = _state.value
        val operatorBadge = mesOperatorBadge() ?: return@launch alarm("MES 登录会话没有员工身份")
        _state.value = s.copy(busy = true, alarm = null)
        try {
            val response = api.smtLoadingComplete(payload(mapOf(
                "eventId" to java.util.UUID.randomUUID().toString(),
                "sessionId" to s.sessionId,
                "workOrderCode" to s.workOrder,
                "materialSn" to s.materialSn,
                "machineCode" to s.machine,
                "channelCode" to s.slot,
                "feederCode" to s.feeder,
                "loadedQty" to s.materialQty,
                "operator" to operatorBadge,
                "deviceId" to deviceId
            )))
            requireData(response.isSuccessful, response.body(), response.errorBody()?.string())
            _state.value = _state.value.copy(
                machine = "", sessionId = null, slot = "", feeder = "", materialSn = "", material = "",
                materialVerified = false, materialQty = "", materialRemainingQty = "", lot = "", dateCode = "",
                registrationRequired = false, expectedMachine = "", expectedSlot = "", expectedFeeder = "",
                step = LoadingStep.MATERIAL, busy = false, online = true,
                message = "上料成功，请扫下一卷物料"
            )
            successTone()
        } catch (e: Exception) {
            _state.value = _state.value.copy(busy = false, alarm = e.message ?: "MES拒绝上料", message = "上料未完成，请勿取下物料")
            alarmTone()
        }
    }

    private fun startSession(machineCode: String) = viewModelScope.launch {
        val s = _state.value
        if (s.expectedMachine.isNotBlank() && !s.expectedMachine.equals(machineCode, true)) {
            return@launch alarm("机位不匹配：应为 ${s.expectedMachine}，扫描到 $machineCode")
        }
        val lineCode = mesLineCode() ?: return@launch alarm("MES 登录会话没有分配产线")
        val operatorBadge = mesOperatorBadge() ?: return@launch alarm("MES 登录会话没有员工身份")
        _state.value = s.copy(busy = true, alarm = null)
        try {
            val response = api.smtLoadingStart(payload(mapOf(
                "workOrderCode" to s.workOrder, "lineCode" to lineCode,
                "machineCode" to machineCode, "operatorBadge" to operatorBadge,
                "deviceId" to android.os.Build.MODEL,
                "testBypassAllChecks" to s.testBypassAllChecks,
                "testBypassedActions" to s.testBypassedActions.toList(),
                "testBypassReason" to s.testBypassReason,
                "testBypassAuthorizedBy" to s.testBypassAuthorizedBy
            )))
            val data = requireData(response.isSuccessful, response.body(), response.errorBody()?.string())
            _state.value = s.copy(
                machine = machineCode, sessionId = data["id"].asLong,
                step = LoadingStep.SLOT, busy = false, online = true,
                alarm = null, loadingBlocked = false,
                message = "请扫槽号"
            )
            try {
                acquireOfflineLease(s.workOrder, machineCode, operatorBadge)
            } catch (leaseError: Exception) {
                _state.value = _state.value.copy(
                    alarm = "在线上料可继续，但本机未取得离线操作权：${leaseError.message}",
                    offlineExpiresAt = null
                )
                alarmTone()
            }
            successTone()
            refreshWorkOrders(false)
        } catch (e: java.io.IOException) {
            offlineStore.markDisconnected()
            _state.value = s.copy(
                machine = machineCode, sessionId = -1, step = LoadingStep.SLOT,
                busy = false, online = false, message = "MES离线：进入30分钟受控上料"
            )
            alarm("MES离线：仅允许本地缓存中合格物料，所有记录稍后由MES和线长审查")
        } catch (e: Exception) { networkAlarm(e) }
    }

    fun confirmBinding() = viewModelScope.launch {
        val s = _state.value
        val operatorBadge = mesOperatorBadge() ?: return@launch alarm("MES 登录会话没有员工身份")
        val session = s.sessionId ?: return@launch alarm("没有活动上料会话")
        if (s.step != LoadingStep.CONFIRM) return@launch alarm("扫码步骤尚未完成")
        _state.value = s.copy(busy = true, alarm = null)
        try {
            val expectedMaterial = s.material.ifBlank {
                val number = Regex("""(\d+)$""").find(s.slot)?.groupValues?.getOrNull(1)?.toIntOrNull()
                val wo = s.workOrders.firstOrNull { it.code == s.workOrder }
                number?.let { wo?.materials?.getOrNull(it - 1)?.code }.orEmpty()
            }
            var wmsRoll: JsonObject? = null
            if (!s.testBypassAllChecks && !s.testBypassedActions.contains("WMS_ROLL_VALIDATION")) {
                val wmsResponse = api.resolveMaterialRoll(s.materialSn)
                val wmsData = wmsResponse.body()?.getAsJsonObject("data")
                val canIssue = wmsData?.get("canIssue")?.asBoolean == true
                val wmsMaterial = wmsData?.get("materialCode")?.asString.orEmpty()
                if (!wmsResponse.isSuccessful || wmsData == null || !canIssue) {
                    val reason = wmsData?.get("validation")?.asString ?: "WMS roll not released or quantity is unavailable"
                    _state.value = _state.value.copy(busy = false, alarm = reason, message = "WMS rejected material roll")
                    alarmTone()
                    return@launch
                }
                if (expectedMaterial.isNotBlank() && wmsMaterial.isNotBlank() &&
                    !expectedMaterial.equals(wmsMaterial, ignoreCase = true)
                ) {
                    _state.value = _state.value.copy(busy = false, alarm = "Wrong material roll: expected $expectedMaterial, scanned $wmsMaterial", message = "Material mismatch")
                    alarmTone()
                    return@launch
                }
                wmsRoll = wmsData
            }
            val response = api.smtLoadingBind(payload(mapOf(
                "sessionId" to session, "machineCode" to s.machine, "slotNo" to s.slot,
                "feederCode" to s.feeder, "materialSn" to s.materialSn,
                "materialCode" to expectedMaterial,
                "wmsRollQr" to wmsRoll?.get("rollQr")?.asString,
                "wmsLotNo" to wmsRoll?.get("lotNo")?.asString,
                "wmsAvailableQty" to wmsRoll?.get("availableQty")?.asString,
                "dateCode" to s.dateCode, "operatorBadge" to operatorBadge,
                "testBypassAllChecks" to s.testBypassAllChecks,
                "testBypassReason" to s.testBypassReason,
                "testBypassAuthorizedBy" to s.testBypassAuthorizedBy,
                "testBypassedActions" to s.testBypassedActions.toList(),
                "deferWoApproval" to s.deferMaterialApproval
            )))
            val data = requireData(response.isSuccessful, response.body(), response.errorBody()?.string())
            val item = BoundSlot(
                id = data["id"].asLong,
                machine = s.machine,
                slot = data["slot_no"].asString,
                feeder = data["feeder_code"].asString,
                materialSn = data["material_sn"].asString,
                material = data["material_code"].asString,
                lot = data["lot_no"].asString,
                qty = data["qty"]?.asString ?: "0"
            )
            val checks = data.getAsJsonArray("qualityChecks")?.map {
                val check = it.asJsonObject
                PdaQualityCheck(check["label"].asString, check["pass"].asBoolean)
            } ?: emptyList()
            val boundCount = data["boundCount"]?.asInt ?: (s.boundSlots.size + 1)
            val requiredCount = data["requiredCount"]?.asInt ?: 0
            val allMaterialsBound = data["allMaterialsBound"]?.asBoolean ?: false
            val boundQty = data["qty"]?.asString ?: "0"
            // A new roll is registered by /bind, then immediately completed as
            // one loading cycle. This keeps registration and physical loading
            // as two auditable MES events without asking the loader to repeat scans.
            val completeResponse = api.smtLoadingComplete(payload(mapOf(
                "eventId" to java.util.UUID.randomUUID().toString(),
                "sessionId" to session,
                "workOrderCode" to s.workOrder,
                "materialSn" to s.materialSn,
                "machineCode" to s.machine,
                "channelCode" to s.slot,
                "feederCode" to s.feeder,
                "loadedQty" to boundQty,
                "operator" to operatorBadge,
                "deviceId" to deviceId
            )))
            requireData(completeResponse.isSuccessful, completeResponse.body(), completeResponse.errorBody()?.string())
            val updatedWorkOrders = s.workOrders.map { wo ->
                if (wo.code != s.workOrder) wo else wo.copy(
                    boundMaterialCount = boundCount,
                    materials = wo.materials.map { material ->
                        if (material.code == item.material) material.copy(bound = true) else material
                    }
                )
            }
            _state.value = s.copy(
                machine = "",
                slot = "", feeder = "", materialSn = "", material = "", lot = "", dateCode = "",
                materialVerified = false, materialQty = "", materialRemainingQty = "",
                registrationRequired = false, expectedMachine = "", expectedSlot = "", expectedFeeder = "",
                deferMaterialApproval = false,
                workOrders = updatedWorkOrders,
                boundSlots = s.boundSlots + item, step = LoadingStep.MATERIAL,
                busy = false, online = true, qualityChecks = checks,
                bindingSuccess = null,
                message = "上料成功，请扫下一卷物料"
            )
            _state.value = _state.value.copy(
                message = "上料成功：机器 ${s.machine}，槽位 ${item.slot}，Feeder ${item.feeder}，物料 ${item.material}，数量 $boundQty，SN ${item.materialSn}。请开始下一卷物料。"
            )
            successTone()
        } catch (e: java.io.IOException) {
            queueOfflineBinding(s)
        } catch (e: Exception) {
            alarm(e.message ?: "MES拒绝绑定")
            _state.value = _state.value.copy(busy = false, online = true)
        }
    }

    fun acknowledgeBindingSuccess() {
        val success = _state.value.bindingSuccess ?: return
        _state.value = _state.value.copy(
            bindingSuccess = null,
            message = if (success.allMaterialsBound) {
                "ALL_MATERIALS_BOUND"
            } else {
                "SCAN_NEXT_MACHINE"
            }
        )
    }

    fun release(lineLeaderBadge: String) = viewModelScope.launch {
        val s = _state.value
        val session = s.sessionId ?: return@launch alarm("没有活动上料会话")
        if (lineLeaderBadge.isBlank()) return@launch alarm("必须扫描线长工号")
        _state.value = s.copy(busy = true, alarm = null)
        try {
            val response = api.smtLoadingRelease(payload(mapOf(
                "sessionId" to session, "lineLeaderBadge" to lineLeaderBadge.trim().uppercase(),
                "testBypassRelease" to s.testBypassAllChecks,
                "testBypassReason" to s.testBypassReason,
                "testBypassedActions" to s.testBypassedActions.toList()
            )))
            requireData(response.isSuccessful, response.body(), response.errorBody()?.string())
            _state.value = s.copy(step = LoadingStep.RELEASED, busy = false, online = true, message = "工单已放行")
            _state.value = PdaLoadingState(
                language = s.language,
                workOrders = s.workOrders,
                loadingWorkOrders = false,
                online = true,
                message = "WORK_ORDER_COMPLETED",
                completedWorkOrderCode = s.workOrder
            )
            successTone()
            refreshWorkOrders(false)
        } catch (e: Exception) { networkAlarm(e) }
    }

    fun acknowledgeWorkOrderComplete() {
        _state.value = _state.value.copy(completedWorkOrderCode = null)
    }

    fun resetAlarm() { _state.value = _state.value.copy(alarm = null) }

    fun checkActiveLoading() = viewModelScope.launch {
        val s = _state.value
        if (s.step == LoadingStep.SETUP || s.machine.isBlank() || s.workOrder.isBlank()) return@launch
        try {
            val response = api.smtLoadingSession(s.workOrder, s.machine)
            if (!response.isSuccessful) return@launch
            val data = response.body()?.getAsJsonObject("data") ?: return@launch
            val remoteBindings = data.getAsJsonArray("bindings")?.mapNotNull { row ->
                row.asJsonObject["materialSn"]?.asString?.trim()?.uppercase()
            }?.toSet() ?: emptySet()
            val localBindings = s.boundSlots.map { it.materialSn.trim().uppercase() }.toSet()
            val missing = localBindings.filterNot { remoteBindings.contains(it) }
            if (missing.isNotEmpty()) {
                _state.value = _state.value.copy(
                    loadingBlocked = true,
                    alarm = "MES 周期复核发现物料 SN 状态变化：${missing.joinToString()}，已锁定上料"
                )
                alarmTone()
            }
        } catch (_: Exception) {
            // A read-only check failure does not invent a production result;
            // the existing MES offline policy controls whether loading may continue.
        }
    }

    private fun payload(data: Map<String, Any?>): Map<String, Any?> = mapOf("payload" to data)

    private suspend fun acquireOfflineLease(workOrder: String, machine: String, operator: String) {
        val lineCode = mesLineCode() ?: throw IllegalStateException("MES 登录会话没有分配产线")
        val response = api.smtLoadingOfflineLease(payload(mapOf(
            "workOrderCode" to workOrder, "lineCode" to lineCode, "machineCode" to machine,
            "deviceId" to deviceId, "operatorBadge" to operator
        )))
        val data = requireData(response.isSuccessful, response.body(), response.errorBody()?.string())
        offlineStore.saveSnapshot(data, workOrder, machine, deviceId, operator)
        _state.value = _state.value.copy(offlineExpiresAt = data["expiresAt"].asString)
    }

    private fun queueOfflineBinding(s: PdaLoadingState) {
        val operator = mesOperatorBadge()
        if (operator == null) {
            _state.value = s.copy(busy = false, online = false, alarm = "MES 登录会话没有员工身份")
            return
        }
        offlineStore.markDisconnected()
        val result = offlineStore.validateAndQueue(
            workOrder = s.workOrder, machine = s.machine, slot = s.slot, feeder = s.feeder,
            rawMaterialScan = s.materialSn, qty = 1.0, operator = operator,
            deviceId = deviceId, appVersion = BuildConfig.VERSION_NAME
        )
        if (!result.allowed) {
            _state.value = s.copy(busy = false, online = false, alarm = result.reason, message = "离线上料被阻断")
            alarmTone()
            return
        }
        val offlineItem = BoundSlot(
            id = -System.currentTimeMillis(), machine = s.machine,
            slot = s.slot, feeder = s.feeder, materialSn = s.materialSn,
            material = result.materialCode, lot = result.lotNo, qty = "1"
        )
        _state.value = s.copy(
            machine = "",
            slot = "", feeder = "", materialSn = "", material = "", lot = "",
            boundSlots = s.boundSlots + offlineItem, step = LoadingStep.MACHINE,
            busy = false, online = false, offlinePending = s.offlinePending + 1,
            qualityChecks = listOf(
                "IQC合格","批次状态可用","可用数量充足","BOM与槽位匹配","有效期未过","MSD状态有效"
            ).map { PdaQualityCheck(it, true) },
            message = "离线上料已保存；MES恢复后按顺序复核"
        )
        successTone()
    }

    private suspend fun syncOfflineEvents() {
        val pending = offlineStore.pendingPayloads()
        if (pending.isEmpty()) return
        val response = api.smtLoadingOfflineEvents(
            payload(mapOf("events" to pending))
        )
        val data = requireData(response.isSuccessful, response.body(), response.errorBody()?.string())
        val results = data.getAsJsonArray("results") ?: return
        val ids = results.map { it.asJsonObject["eventId"].asString }
        offlineStore.markSynced(ids)
        val violations = results.count { it.asJsonObject["reviewStatus"].asString == "VIOLATION" }
        _state.value = _state.value.copy(
            offlinePending = 0,
            alarm = if (violations > 0) "MES发现 $violations 条离线上料违规；线长须在5分钟内决定继续或停线" else null,
            message = if (violations > 0) "离线记录已补传，等待线长处理" else "离线记录已补传并通过MES复核"
        )
        if (violations > 0) alarmTone()
    }

    private fun requireData(ok: Boolean, body: JsonObject?, error: String?): JsonObject {
        if (!ok || body == null) throw IllegalStateException(error ?: "MES request failed")
        return body.getAsJsonObject("data") ?: throw IllegalStateException("MES response has no data")
    }

    private fun networkAlarm(error: Exception) {
        _state.value = _state.value.copy(
            busy = false, online = false,
            alarm = error.message ?: "MES离线，禁止继续上料",
            message = "MES离线：禁止新增绑定和放行"
        )
        alarmTone()
    }

    private fun alarm(message: String) {
        _state.value = _state.value.copy(alarm = message)
        alarmTone()
    }

    private fun alarmTone() {
        ToneGenerator(AudioManager.STREAM_ALARM, 100).startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 700)
        val vibrator = getApplication<Application>().getSystemService(Vibrator::class.java)
        vibrator?.vibrate(VibrationEffect.createOneShot(600, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    private fun successTone() {
        ToneGenerator(AudioManager.STREAM_NOTIFICATION, 75).startTone(ToneGenerator.TONE_PROP_ACK, 160)
    }
}
