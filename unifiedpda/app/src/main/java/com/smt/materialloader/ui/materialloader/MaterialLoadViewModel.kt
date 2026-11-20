package com.smt.materialloader.ui.materialloader

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.WorkOrderDto
import com.smt.materialloader.data.api.dto.StockWarning
import com.smt.materialloader.data.api.dto.ReturnReasonDto
import com.smt.materialloader.data.repository.WorkOrderRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class MaterialLoadView { WO_SELECT, MATERIAL_LIST, SCAN_FLOW, COMPLETE_CONFIRM }
enum class ScanPhase { MACHINE, CHANNEL, FEEDER, REEL }

/** 判断是否为非SMT辅料（包装材料/辅材），用于上料流程分流 */
private fun isNonSmtKeyword(nameZh: String?): Boolean {
    if (nameZh == null) return false
    val n = nameZh.lowercase()
    return n.contains("外箱") || n.contains("隔卡") || n.contains("吸塑") ||
           n.contains("珍珠棉") || n.contains("纸箱") || n.contains("cpe袋") ||
           n.contains("封口贴") || n.contains("底部封口") || n.contains("包装") ||
           n.contains("辅料") || n.contains("说明书") || n.contains("保护膜")
}

data class MaterialRequirement(
    val seq: Int,
    val materialCode: String,
    val materialNameZh: String,
    val unit: String,
    val requiredQty: Int,
    val pickedQty: Int,
    val remainingQty: Int,
    val status: String, // "pending", "loading", "fulfilled", "error"
    val isSmt: Boolean = true, // true=SMT贴片件, false=辅料/包装材料
    val scannedLotNo: String? = null,
    val scannedQty: Int? = null,
    val txNo: String? = null,
    val errorMessage: String? = null
)

data class BindingSuccess(
    val materialCode: String,
    val lotNo: String,
    val remainingCount: Int,
    val allMaterialsLoaded: Boolean
)

data class MaterialLoadUiState(
    val view: MaterialLoadView = MaterialLoadView.WO_SELECT,
    val pendingAutoSelectWoCode: String? = null,
    val isLoadingWos: Boolean = true,
    val workOrders: List<WorkOrderDto> = emptyList(),
    val selectedWo: WorkOrderDto? = null,
    val requirements: List<MaterialRequirement> = emptyList(),
    val scanMode: String = "single",
    val showScanner: Boolean = false,
    val scanPhase: ScanPhase = ScanPhase.REEL,
    val lastFeedback: Pair<Boolean, String>? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val fulfilledCount: Int = 0,
    val operator: String = "",
    val allMaterialsLoaded: Boolean = false,
    val stockWarning: StockWarning? = null,
    // Return dialog
    val returnDialogReq: MaterialRequirement? = null,
    val returnReasonCode: String = "",
    val returnReasonNote: String = "",
    val qualityVerdict: String = "PASS",
    val returnReasons: List<ReturnReasonDto> = emptyList(),
    val returnSubmitting: Boolean = false,
    val returnError: String? = null,
    // Work-start state
    val workStarted: Boolean = false,
    val workStartError: String? = null,
    val workStartLoading: Boolean = false,
    // 3-QR scan state
    val scannedMachine: String? = null,
    val scannedChannel: String? = null,
    val scannedFeeder: String? = null,
    val pendingFeederLot: String? = null,
    // Dup scan prevention: lots already used in this session (across all materials)
    val usedLotNos: Set<String> = emptySet(),
    // Pending reel scan awaiting confirm button
    val pendingReelBarcode: String? = null,
    // Line operator's drawn-signature token captured at reel confirm (null = unsigned)
    val pendingSignatureToken: String? = null,
    // 4-way binding validation errors from last scan
    val bindingErrors: List<com.smt.materialloader.data.api.dto.BindingErrorDto> = emptyList(),
    val bindingWarnings: List<com.smt.materialloader.data.api.dto.BindingWarningDto> = emptyList(),
    val qualityGateChecks: List<com.smt.materialloader.data.api.dto.QualityGateCheckDto> = emptyList(),
    // A successful binding must be acknowledged before the scan flow advances.
    val bindingSuccess: BindingSuccess? = null,
    // Set after MES completion/unlock so the operator can explicitly start the next WO.
    val completedWorkOrderCode: String? = null
)

class MaterialLoadViewModel : ViewModel() {
    private val woRepo: WorkOrderRepository = MaterialLoaderApp.instance.workOrderRepository

    private val _state = MutableStateFlow(
        MaterialLoadUiState(operator = MaterialLoaderApp.instance.prefs.getUser()?.username.orEmpty())
    )
    val state: StateFlow<MaterialLoadUiState> = _state.asStateFlow()

    init {
        loadWorkOrders()
    }

    private fun loadWorkOrders() {
        _state.value = _state.value.copy(isLoadingWos = true)
        viewModelScope.launch {
            woRepo.getWorkOrders().fold(
                onSuccess = { wos ->
                    val pending = _state.value.pendingAutoSelectWoCode
                    _state.value = _state.value.copy(workOrders = wos, isLoadingWos = false)
                    if (pending != null) {
                        val wo = wos.find { it.code == pending }
                        if (wo != null) {
                            selectWorkOrder(wo)
                        } else {
                            _state.value = _state.value.copy(error = "Work order not found: $pending")
                        }
                    }
                },
                onFailure = {
                    _state.value = _state.value.copy(workOrders = emptyList(), isLoadingWos = false, error = "Failed to load work orders")
                }
            )
        }
    }

    fun selectWoByCode(woCode: String) {
        val s = _state.value
        val wo = s.workOrders.find { it.code == woCode }
        if (wo != null) {
            selectWorkOrder(wo)
        } else if (s.isLoadingWos) {
            // Race: WO list still loading, store pending and retry after load
            _state.value = s.copy(pendingAutoSelectWoCode = woCode)
        } else {
            _state.value = s.copy(error = "Work order not found: $woCode")
        }
    }

    fun selectWorkOrder(wo: WorkOrderDto) {
        val operator = _state.value.operator

        // Check if WO is locked by another operator
        if (wo.isLocked && wo.lockedBy != operator) {
            _state.value = _state.value.copy(error = "WO ${wo.code} is locked by ${wo.lockedBy}")
            return
        }

        _state.value = _state.value.copy(
            selectedWo = wo,
            isLoading = true,
            error = null
        )

        // Try to lock the WO
        viewModelScope.launch {
            woRepo.lockWorkOrder(wo.code, operator).fold(
                onSuccess = {
                    // Lock successful, fetch BOM
                    fetchBomForWorkOrder(wo)
                },
                onFailure = { err ->
                    _state.value = _state.value.copy(
                        selectedWo = null,
                        isLoading = false,
                        error = err.message ?: "Failed to lock work order"
                    )
                }
            )
        }
    }

    private fun fetchBomForWorkOrder(wo: WorkOrderDto) {
        viewModelScope.launch {
            woRepo.getBomForProduct(wo.productCode ?: "").fold(
                onSuccess = { bom ->
                    val plannedQty = wo.plannedQty
                    val requirements = bom.lines.mapIndexed { index, line ->
                        val requiredQty = (line.qtyPer * plannedQty * (1 + line.lossRate)).toInt()
                        MaterialRequirement(
                            seq = index + 1,
                            materialCode = line.materialCode,
                            materialNameZh = line.materialNameZh ?: line.materialCode,
                            unit = line.unit,
                            requiredQty = requiredQty,
                            pickedQty = 0,
                            remainingQty = requiredQty,
                            status = "pending",
                            isSmt = !isNonSmtKeyword(line.materialNameZh)
                        )
                    }
                    _state.value = _state.value.copy(
                        requirements = requirements,
                        view = MaterialLoadView.MATERIAL_LIST,
                        isLoading = false
                    )
                },
                onFailure = { err ->
                    // Unlock on BOM fetch failure
                    unlockCurrentWo()
                    _state.value = _state.value.copy(
                        selectedWo = null,
                        isLoading = false,
                        error = "BOM not found: ${err.message}"
                    )
                }
            )
        }
    }

    fun triggerWorkStart(onSuccess: () -> Unit = {}) {
        val wo = _state.value.selectedWo ?: return
        val operator = _state.value.operator
        _state.value = _state.value.copy(workStartLoading = true, workStartError = null)
        viewModelScope.launch {
            woRepo.placeWoToRack(
                workOrderCode = wo.code,
                operator = operator
            ).fold(
                onSuccess = {
                    _state.value = _state.value.copy(workStarted = true, workStartLoading = false)
                    onSuccess()
                },
                onFailure = { err ->
                    _state.value = _state.value.copy(
                        workStartLoading = false,
                        workStartError = err.message ?: "Work start failed"
                    )
                }
            )
        }
    }

    fun startScan() {
        // Mark first pending material as "loading"
        val s = _state.value
        // Include "loading" state so non-SMT materials already advanced by auto-advance are found
        val firstPending = s.requirements.firstOrNull { it.status == "pending" || it.status == "loading" }
        val updatedReqs = s.requirements.map { req ->
            if (req.status == "pending") req.copy(status = "loading") else req
        }
        // 辅料(non-SMT) materials skip 机台/通道/飞达 → go directly to 料盘
        val initialPhase = if (firstPending?.isSmt == false) ScanPhase.REEL else ScanPhase.MACHINE
        _state.value = s.copy(
            requirements = updatedReqs,
            view = MaterialLoadView.SCAN_FLOW,
            scanPhase = initialPhase,
            lastFeedback = null,
            error = null,
            pendingSignatureToken = null,
            scannedMachine = null,
            scannedChannel = null,
            scannedFeeder = null
        )
    }

    fun onBarcodeScanned(barcode: String) {
        val s = _state.value
        val cleanBarcode = barcode.trim().uppercase()

        // ── Dup scan prevention ────────────────────────────────────────
        val dupMsg = when (s.scanPhase) {
            ScanPhase.MACHINE -> if (cleanBarcode == s.scannedMachine) "此机台已扫描，请扫描不同的机台" else null
            ScanPhase.CHANNEL -> if (cleanBarcode == s.scannedChannel) "此槽位已扫描，请扫描不同的槽位" else null
            ScanPhase.FEEDER -> if (cleanBarcode == s.scannedFeeder) "此飞达已扫描，请扫描不同的飞达" else null
            ScanPhase.REEL -> when {
                s.usedLotNos.contains(cleanBarcode) -> "此物料批次已被使用，请扫描不同的批次"
                s.requirements.any { it.scannedLotNo == cleanBarcode && it.status == "fulfilled" } -> "此物料批次已上料，请扫描不同的批次"
                else -> null
            }
        }
        if (dupMsg != null) {
            _state.value = s.copy(lastFeedback = Pair(false, dupMsg))
            return
        }
        // ── End dup prevention ─────────────────────────────────────────

        when (s.scanPhase) {
            ScanPhase.MACHINE -> {
                _state.value = s.copy(scannedMachine = cleanBarcode, scanPhase = ScanPhase.CHANNEL, lastFeedback = null)
            }
            ScanPhase.CHANNEL -> {
                _state.value = s.copy(scannedChannel = cleanBarcode, scanPhase = ScanPhase.FEEDER, lastFeedback = null)
            }
            ScanPhase.FEEDER -> {
                _state.value = s.copy(scannedFeeder = cleanBarcode, isLoading = true, lastFeedback = null)
                validateFeederBeforeReel()
            }
            ScanPhase.REEL -> {
                // Store barcode, wait for confirm button
                _state.value = s.copy(pendingReelBarcode = cleanBarcode, lastFeedback = null)
            }
        }
    }

    fun resetToFeederPhase() {
        _state.value = _state.value.copy(
            scanPhase = ScanPhase.FEEDER,
            scannedFeeder = null,
            pendingReelBarcode = null,
            lastFeedback = null
        )
    }

    fun onSignatureCaptured(token: String?) {
        _state.value = _state.value.copy(pendingSignatureToken = token, lastFeedback = null)
    }

    fun confirmReelScan() {
        val s = _state.value
        val barcode = s.pendingReelBarcode
        if (barcode == null) return
        if (s.pendingSignatureToken.isNullOrBlank()) {
            _state.value = s.copy(lastFeedback = Pair(false, "请先签名确认拣料 / Sign to confirm the pick first"))
            return
        }
        _state.value = s.copy(isLoading = true, pendingReelBarcode = null)
        processReelScan(barcode)
    }

    private fun validateFeederBeforeReel() {
        val s = _state.value
        val wo = s.selectedWo
        val req = s.requirements.firstOrNull { it.status == "loading" }
        val machine = s.scannedMachine
        val channel = s.scannedChannel
        val feeder = s.scannedFeeder
        if (wo == null || req == null || machine.isNullOrBlank() || channel.isNullOrBlank() || feeder.isNullOrBlank()) {
            _state.value = s.copy(isLoading = false, lastFeedback = Pair(false, "MES校验缺少机台、通道或飞达信息，已阻止上料"))
            return
        }
        viewModelScope.launch {
            woRepo.validateFeeder(wo.code, wo.lineCode, feeder, channel, machine, channel, req.materialCode, s.operator).fold(
                onSuccess = { result ->
                    if (result.passed) {
                        _state.value = _state.value.copy(
                            isLoading = false, scanPhase = ScanPhase.REEL,
                            lastFeedback = Pair(true, "MES校验通过：$machine / $channel / $feeder，请扫描物料SN"),
                            bindingErrors = emptyList(), bindingWarnings = emptyList(), qualityGateChecks = emptyList()
                        )
                    } else {
                        _state.value = _state.value.copy(
                            isLoading = false, scanPhase = ScanPhase.FEEDER, scannedFeeder = null,
                            lastFeedback = Pair(false, "⚠ 上料已阻止：${result.message ?: "机台、通道或飞达与MES登记不一致"}"),
                            bindingErrors = emptyList(), bindingWarnings = emptyList()
                        )
                    }
                },
                onFailure = { err ->
                    _state.value = _state.value.copy(
                        isLoading = false, scanPhase = ScanPhase.FEEDER, scannedFeeder = null,
                        lastFeedback = Pair(false, "⚠ MES校验失败，上料已阻止：${err.message ?: "无法确认机台/通道/飞达"}")
                    )
                }
            )
        }
    }

    private fun validateFeederThenAdvance() {
        // Full quality validation needs the reel lot number. Keep the scanned
        // machine, slot and feeder, then call MES after the reel is scanned.
        _state.value = _state.value.copy(
            isLoading = false,
            scanPhase = ScanPhase.REEL,
            lastFeedback = Pair(true, "飞达已读取，请扫描料盘执行MES六项质量校验"),
            bindingErrors = emptyList(),
            bindingWarnings = emptyList(),
            qualityGateChecks = emptyList()
        )
    }

    private fun processReelScan(lotNo: String) {
        val s = _state.value
        val currentMaterial = s.requirements.firstOrNull { it.status == "loading" }
        val wo = s.selectedWo

        if (currentMaterial == null || wo == null) {
            _state.value = s.copy(
                lastFeedback = Pair(false, "No material to load"),
                scanPhase = ScanPhase.MACHINE,
                pendingReelBarcode = null
            )
            return
        }

        _state.value = s.copy(isLoading = true)

        viewModelScope.launch {
            // Every material, including auxiliary material, must pass the
            // canonical MES/WMS quality gate before loading is confirmed.
            woRepo.getMaterialLotByNo(lotNo).fold(
                onSuccess = { lot ->
                    // Local lot validation (IQC status, qty)
                    val validationError = validateLot(lot, currentMaterial)
                    if (validationError != null) {
                        val updatedReqs = s.requirements.map { req ->
                            if (req.seq == currentMaterial.seq) {
                                req.copy(status = "error", errorMessage = validationError)
                            } else req
                        }
                        _state.value = _state.value.copy(
                            requirements = updatedReqs,
                            isLoading = false,
                            lastFeedback = Pair(false, validationError),
                            scanPhase = ScanPhase.MACHINE,
                            pendingReelBarcode = null,
                            scannedMachine = null,
                            scannedChannel = null,
                            scannedFeeder = null
                        )
                        return@launch
                    }

                    // Step 1: Full 4-way feeder-binding validation
                    woRepo.feederBindingValidate(
                        workOrderCode = wo.code,
                        lineCode = wo.lineCode,
                        machineCode = s.scannedMachine ?: "",
                        channelCode = s.scannedChannel,
                        slotNo = s.scannedChannel ?: "",
                        feederCode = s.scannedFeeder,
                        lotNo = lotNo,
                        materialCode = currentMaterial.materialCode,
                        qty = currentMaterial.requiredQty,
                        operator = s.operator
                    ).fold(
                        onSuccess = { validationResult ->
                            if (!validationResult.pass) {
                                // Validation failed — show errors and reset
                                val errorMsgs = validationResult.errors.joinToString("；") { it.message }
                                val updatedReqs = _state.value.requirements.map { req ->
                                    if (req.seq == currentMaterial.seq) {
                                        req.copy(status = "error", errorMessage = errorMsgs)
                                    } else req
                                }
                                _state.value = _state.value.copy(
                                    requirements = updatedReqs,
                                    isLoading = false,
                                    lastFeedback = Pair(false, errorMsgs.ifEmpty { "4-way验证失败" }),
                                    scanPhase = ScanPhase.MACHINE,
                                    pendingReelBarcode = null,
                                    scannedMachine = null,
                                    scannedChannel = null,
                                    scannedFeeder = null,
                                    bindingErrors = validationResult.errors,
                                    bindingWarnings = validationResult.warnings,
                                    qualityGateChecks = validationResult.qualityChecks
                                )
                                return@launch
                            }

                            // Step 2: Validation passed — confirm the binding
                            val sigToken = s.pendingSignatureToken ?: ""
                            val signatureHash = sha256(
                                listOf(wo.code, lotNo, s.scannedMachine, s.scannedChannel, currentMaterial.materialCode, sigToken).joinToString("|")
                            )
                            val evidenceQr = "LOAD:${wo.code}:$lotNo:${s.scannedChannel ?: s.scannedFeeder ?: "-"}"
                            woRepo.feederBindingConfirm(
                                workOrderCode = wo.code,
                                lineCode = wo.lineCode,
                                machineCode = s.scannedMachine ?: "",
                                channelCode = s.scannedChannel,
                                slotNo = s.scannedChannel ?: "",
                                feederCode = s.scannedFeeder,
                                lotNo = lotNo,
                                materialCode = currentMaterial.materialCode,
                                qty = currentMaterial.requiredQty,
                                operator = s.operator,
                                signatureHash = signatureHash,
                                signedBy = s.operator,
                                evidenceQr = evidenceQr
                            ).fold(
                                onSuccess = { response ->
                                    val updatedReqs = _state.value.requirements.map { req ->
                                        if (req.seq == currentMaterial.seq) {
                                            req.copy(
                                                status = "fulfilled",
                                                scannedLotNo = lotNo,
                                                scannedQty = currentMaterial.requiredQty,
                                                txNo = response.id,
                                                pickedQty = currentMaterial.requiredQty,
                                                remainingQty = 0
                                            )
                                        } else req
                                    }
                                    val pendingCount = updatedReqs.count { it.status == "pending" || it.status == "loading" }
                                    val allLoaded = pendingCount == 0

                                    _state.value = _state.value.copy(
                                        requirements = updatedReqs,
                                        isLoading = false,
                                        lastFeedback = Pair(true, "${currentMaterial.materialCode} → $lotNo ✓ 上料成功"),
                                        scanPhase = ScanPhase.MACHINE,
                                        scannedMachine = null,
                                        scannedChannel = null,
                                        scannedFeeder = null,
                                        fulfilledCount = updatedReqs.count { it.status == "fulfilled" },
                                        allMaterialsLoaded = allLoaded,
                                        usedLotNos = _state.value.usedLotNos + lotNo,
                                        bindingErrors = emptyList(),
                                        bindingWarnings = emptyList(),
                                        qualityGateChecks = validationResult.qualityChecks,
                                        bindingSuccess = BindingSuccess(
                                            materialCode = currentMaterial.materialCode,
                                            lotNo = lotNo,
                                            remainingCount = pendingCount,
                                            allMaterialsLoaded = allLoaded
                                        )
                                    )
                                },
                                onFailure = { err ->
                                    val updatedReqs = _state.value.requirements.map { req ->
                                        if (req.seq == currentMaterial.seq) {
                                            req.copy(status = "error", errorMessage = err.message)
                                        } else req
                                    }
                                    _state.value = _state.value.copy(
                                        requirements = updatedReqs,
                                        isLoading = false,
                                        lastFeedback = Pair(false, err.message ?: "绑定确认失败"),
                                        scanPhase = ScanPhase.MACHINE,
                                        scannedMachine = null,
                                        scannedChannel = null,
                                        scannedFeeder = null
                                    )
                                }
                            )
                        },
                        onFailure = { err ->
                            val updatedReqs = _state.value.requirements.map { req ->
                                if (req.seq == currentMaterial.seq) {
                                    req.copy(status = "error", errorMessage = err.message)
                                } else req
                            }
                            _state.value = _state.value.copy(
                                requirements = updatedReqs,
                                isLoading = false,
                                lastFeedback = Pair(false, err.message ?: "4-way验证请求失败"),
                                scanPhase = ScanPhase.MACHINE,
                                scannedMachine = null,
                                scannedChannel = null,
                                scannedFeeder = null
                            )
                        }
                    )
                },
                onFailure = { err ->
                    val updatedReqs = s.requirements.map { req ->
                        if (req.seq == currentMaterial.seq) {
                            req.copy(status = "error", errorMessage = "Lot not found: $lotNo")
                        } else req
                    }
                    _state.value = _state.value.copy(
                        requirements = updatedReqs,
                        isLoading = false,
                        lastFeedback = Pair(false, "Lot not found: $lotNo"),
                        scanPhase = ScanPhase.MACHINE,
                        scannedMachine = null,
                        scannedChannel = null,
                        scannedFeeder = null
                    )
                }
            )
        }
    }

    private fun validateLot(lot: com.smt.materialloader.data.api.dto.MaterialLotDto, requirement: MaterialRequirement): String? {
        // Check 1: Material code matches BOM
        if (lot.materialCode != requirement.materialCode) {
            return "Wrong material: ${lot.materialCode} (expected: ${requirement.materialCode})"
        }

        // Check 2: IQC status is released
        if (lot.iqcStatus != "released") {
            return "IQC not passed: ${lot.iqcStatus} (need: released)"
        }

        // Check 3: Sufficient quantity
        if (lot.availableQty < requirement.requiredQty) {
            return "Insufficient qty: ${lot.availableQty} available (need: ${requirement.requiredQty})"
        }

        return null // All checks passed
    }

    fun retryCurrentMaterial() {
        val s = _state.value
        val errorMaterial = s.requirements.firstOrNull { it.status == "error" }
        if (errorMaterial != null) {
            val updatedReqs = s.requirements.map { req ->
                if (req.seq == errorMaterial.seq) {
                    req.copy(status = "pending", errorMessage = null)
                } else req
            }
            _state.value = s.copy(requirements = updatedReqs)
            startScan()
        }
    }

    fun confirmComplete() {
        val wo = _state.value.selectedWo ?: return
        _state.value = _state.value.copy(view = MaterialLoadView.COMPLETE_CONFIRM)
    }

    fun acknowledgeBindingSuccess() {
        val success = _state.value.bindingSuccess ?: return
        _state.value = _state.value.copy(bindingSuccess = null, lastFeedback = null)
        if (success.allMaterialsLoaded) {
            confirmComplete()
        } else {
            startScan()
        }
    }

    fun finishWorkOrder() {
        val wo = _state.value.selectedWo ?: return
        val operator = _state.value.operator

        _state.value = _state.value.copy(isLoading = true)
        viewModelScope.launch {
            // Complete the WO
            woRepo.completeWorkOrder(wo.code, operator).fold(
                onSuccess = {
                    // Unlock after completion (suspend call, await it)
                    woRepo.unlockWorkOrder(wo.code, operator)
                    // Refresh WO list (suspend call, await it)
                    val freshWos = woRepo.getWorkOrders()
                    _state.value = MaterialLoadUiState(
                        workOrders = freshWos.getOrDefault(emptyList()),
                        isLoadingWos = false,
                        operator = operator,
                        completedWorkOrderCode = wo.code
                    )
                },
                onFailure = { err ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = "Failed to complete: ${err.message}"
                    )
                }
            )
        }
    }

    fun acknowledgeWorkOrderComplete() {
        _state.value = _state.value.copy(completedWorkOrderCode = null)
    }

    fun cancelComplete() {
        _state.value = _state.value.copy(view = MaterialLoadView.MATERIAL_LIST)
    }

    private fun unlockCurrentWo() {
        val wo = _state.value.selectedWo ?: return
        val operator = _state.value.operator
        viewModelScope.launch {
            woRepo.unlockWorkOrder(wo.code, operator)
        }
    }

    fun setScanMode(mode: String) {
        _state.value = _state.value.copy(scanMode = mode)
    }

    fun goBack() {
        val s = _state.value
        when (s.view) {
            MaterialLoadView.MATERIAL_LIST -> {
                unlockCurrentWo()
                _state.value = s.copy(view = MaterialLoadView.WO_SELECT, selectedWo = null, requirements = emptyList(), usedLotNos = emptySet())
            }
            MaterialLoadView.SCAN_FLOW -> {
                // Reset current loading material back to pending
                val updatedReqs = s.requirements.map { req ->
                    if (req.status == "loading") req.copy(status = "pending") else req
                }
                _state.value = s.copy(
                    view = MaterialLoadView.MATERIAL_LIST,
                    requirements = updatedReqs,
                    lastFeedback = null
                )
            }
            MaterialLoadView.COMPLETE_CONFIRM -> _state.value = s.copy(view = MaterialLoadView.MATERIAL_LIST)
            else -> {}
        }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun clearStockWarning() {
        _state.value = _state.value.copy(stockWarning = null)
    }

    // ── Return dialog ──────────────────────────────────────────────────

    fun openReturnDialog(req: MaterialRequirement) {
        _state.value = _state.value.copy(
            returnDialogReq = req,
            returnReasonCode = "",
            returnReasonNote = "",
            qualityVerdict = "PASS",
            returnError = null
        )
        loadReturnReasons()
    }

    private fun loadReturnReasons() {
        viewModelScope.launch {
            woRepo.getReturnReasonCodes().fold(
                onSuccess = { reasons ->
                    _state.value = _state.value.copy(returnReasons = reasons)
                },
                onFailure = {
                    // Silently fail - use empty list
                    _state.value = _state.value.copy(returnReasons = emptyList())
                }
            )
        }
    }

    fun setReturnReasonCode(code: String) {
        _state.value = _state.value.copy(returnReasonCode = code)
    }

    fun setReturnReasonNote(note: String) {
        _state.value = _state.value.copy(returnReasonNote = note)
    }

    fun setQualityVerdict(verdict: String) {
        _state.value = _state.value.copy(qualityVerdict = verdict)
    }

    fun submitReturn() {
        val req = _state.value.returnDialogReq ?: return
        val id = req.txNo
        if (id == null) {
            _state.value = _state.value.copy(returnError = "No feeder loading record found")
            return
        }
        if (_state.value.returnReasonCode.isBlank()) {
            _state.value = _state.value.copy(returnError = "Please select a return reason")
            return
        }

        _state.value = _state.value.copy(returnSubmitting = true, returnError = null)

        viewModelScope.launch {
            woRepo.returnFeederLoad(
                id = id,
                reasonCode = _state.value.returnReasonCode,
                reasonNote = _state.value.returnReasonNote.ifBlank { null },
                qualityVerdict = _state.value.qualityVerdict
            ).fold(
                onSuccess = {
                    // Mark this requirement as no longer fulfilled (reset to pending)
                    val updatedReqs = _state.value.requirements.map { r ->
                        if (r.seq == req.seq) r.copy(
                            status = "pending",
                            scannedLotNo = null,
                            scannedQty = null,
                            txNo = null,
                            pickedQty = 0,
                            remainingQty = r.requiredQty,
                            errorMessage = null
                        ) else r
                    }
                    val newFulfilledCount = updatedReqs.count { it.status == "fulfilled" }
                    _state.value = _state.value.copy(
                        requirements = updatedReqs,
                        fulfilledCount = newFulfilledCount,
                        allMaterialsLoaded = newFulfilledCount == updatedReqs.size,
                        returnDialogReq = null,
                        returnSubmitting = false,
                        usedLotNos = _state.value.usedLotNos - (req.scannedLotNo ?: "")
                    )
                },
                onFailure = { err ->
                    _state.value = _state.value.copy(
                        returnSubmitting = false,
                        returnError = err.message ?: "Return failed"
                    )
                }
            )
        }
    }

    fun clearReturnDialog() {
        _state.value = _state.value.copy(
            returnDialogReq = null,
            returnReasonCode = "",
            returnReasonNote = "",
            qualityVerdict = "PASS",
            returnError = null,
            returnSubmitting = false
        )
    }



    fun reset() {
        _state.value = MaterialLoadUiState(workOrders = _state.value.workOrders, isLoadingWos = false, operator = _state.value.operator)
    }

    private fun sha256(input: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        return digest.digest(input.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
