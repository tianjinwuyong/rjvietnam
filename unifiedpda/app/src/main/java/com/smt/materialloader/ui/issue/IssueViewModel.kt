package com.smt.materialloader.ui.issue

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.MaterialLotDto
import com.smt.materialloader.data.api.dto.WorkOrderDto
import com.smt.materialloader.data.repository.MaterialRepository
import com.smt.materialloader.data.repository.WorkOrderRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class IssueStep {
    SCAN_LOT, SCAN_WO, SELECT_WO, INPUT_QTY, CONFIRM, SIGN, SUCCESS
}

data class IssueUiState(
    val step: IssueStep = IssueStep.SCAN_LOT,
    val lotNo: String = "",
    val workOrderCode: String = "",
    val qty: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val scannedLot: MaterialLotDto? = null,
    val scannedWo: WorkOrderDto? = null,
    val matchedWos: List<WorkOrderDto> = emptyList(),
    val txNo: String? = null,
    val issueTxId: Long? = null,
    val receiverOperator: String = "",
    val signedTxNo: String? = null
)

class IssueViewModel : ViewModel() {

    private val materialRepo: MaterialRepository = MaterialLoaderApp.instance.materialRepository
    private val woRepo: WorkOrderRepository = MaterialLoaderApp.instance.workOrderRepository
    private val authRepo = MaterialLoaderApp.instance.authRepository

    private val _state = MutableStateFlow(IssueUiState())
    val state: StateFlow<IssueUiState> = _state.asStateFlow()

    fun onLotScanned(barcode: String) {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            val result = materialRepo.getMaterialLots(lotNo = barcode)
            result.fold(
                onSuccess = { lots ->
                    if (lots.isNotEmpty()) {
                        val lot = lots.first()
                        _state.value = _state.value.copy(
                            lotNo = barcode,
                            scannedLot = lot,
                            step = IssueStep.SCAN_WO,
                            isLoading = false
                        )
                    } else {
                        _state.value = _state.value.copy(
                            error = "Lot not found: $barcode",
                            isLoading = false
                        )
                    }
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message ?: "Failed to look up lot",
                        isLoading = false
                    )
                }
            )
        }
    }

    fun onWorkOrderScanned(barcode: String) {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            val result = woRepo.getWorkOrders(query = barcode)
            result.fold(
                onSuccess = { wos ->
                    if (wos.isEmpty()) {
                        _state.value = _state.value.copy(
                            error = "Work order not found: $barcode",
                            isLoading = false
                        )
                    } else if (wos.size == 1) {
                        // Single match - auto select
                        _state.value = _state.value.copy(
                            workOrderCode = wos[0].code,
                            scannedWo = wos[0],
                            step = IssueStep.INPUT_QTY,
                            isLoading = false
                        )
                    } else {
                        // Multiple matches - let user pick
                        _state.value = _state.value.copy(
                            matchedWos = wos,
                            step = IssueStep.SELECT_WO,
                            isLoading = false
                        )
                    }
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message ?: "Failed to look up work order",
                        isLoading = false
                    )
                }
            )
        }
    }

    fun selectWorkOrder(wo: WorkOrderDto) {
        _state.value = _state.value.copy(
            workOrderCode = wo.code,
            scannedWo = wo,
            step = IssueStep.INPUT_QTY,
            matchedWos = emptyList()
        )
    }

    fun cancelWoSelection() {
        _state.value = _state.value.copy(
            step = IssueStep.SCAN_WO,
            matchedWos = emptyList(),
            error = null
        )
    }

    fun onQtyChanged(qty: String) {
        _state.value = _state.value.copy(qty = qty, error = null)
    }

    fun confirmIssue() {
        val s = _state.value
        val qty = s.qty.toIntOrNull()
        if (qty == null || qty <= 0) {
            _state.value = s.copy(error = "Invalid quantity")
            return
        }
        if (s.scannedLot != null && qty > s.scannedLot.availableQty) {
            _state.value = s.copy(error = "Quantity exceeds available (${s.scannedLot.availableQty})")
            return
        }

        _state.value = s.copy(step = IssueStep.CONFIRM, isLoading = true, error = null)
        viewModelScope.launch {
            val user = authRepo.getCurrentUser()
            val operator = user?.username ?: "operator"
            val result = materialRepo.issueToLine(s.lotNo, s.workOrderCode, qty, operator)
            result.fold(
                onSuccess = { response ->
                    _state.value = _state.value.copy(
                        step = IssueStep.SIGN,
                        txNo = response.txNo,
                        issueTxId = response.id.toLongOrNull(),
                        isLoading = false
                    )
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message ?: "Failed to issue material",
                        isLoading = false,
                        step = IssueStep.INPUT_QTY
                    )
                }
            )
        }
    }

    fun onReceiverChanged(value: String) {
        _state.value = _state.value.copy(receiverOperator = value, error = null)
    }

    fun onSignConfirmed(signaturePngDataUrl: String?) {
        val s = _state.value
        val receiver = s.receiverOperator.trim()
        if (receiver.isEmpty()) {
            _state.value = s.copy(error = "RECEIVER_REQUIRED")
            return
        }
        val issueTxId = s.issueTxId
        if (issueTxId == null) {
            _state.value = s.copy(error = "Issue transaction id missing; cannot sign handover")
            return
        }
        val nonce = System.currentTimeMillis().toString(36) + signaturePngDataUrl?.length?.toString(36).orEmpty()
        val signatureHash = sha256(listOf(s.workOrderCode, s.lotNo, s.qty, receiver, nonce).joinToString("|"))
        val evidenceQr = "WO-HANDOVER:${s.workOrderCode}:$issueTxId"

        _state.value = s.copy(isLoading = true, error = null)
        viewModelScope.launch {
            val result = materialRepo.handover(
                workOrderCode = s.workOrderCode,
                operatorTo = receiver,
                signatureHash = signatureHash,
                evidenceQr = evidenceQr,
                notes = null,
                issueTxId = issueTxId
            )
            result.fold(
                onSuccess = {
                    _state.value = _state.value.copy(
                        step = IssueStep.SUCCESS,
                        signedTxNo = s.txNo,
                        isLoading = false
                    )
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message ?: "Failed to sign handover",
                        isLoading = false
                    )
                }
            )
        }
    }

    private fun sha256(input: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        return digest.digest(input.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    fun reset() {
        _state.value = IssueUiState()
    }
}
