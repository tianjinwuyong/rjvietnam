package com.smt.materialloader.ui.returnmaterial

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

enum class ReturnStep {
    SCAN_LOT, SCAN_WO, SELECT_WO, INPUT, CONFIRM, SUCCESS
}

data class ReturnUiState(
    val step: ReturnStep = ReturnStep.SCAN_LOT,
    val lotNo: String = "",
    val workOrderCode: String = "",
    val qty: String = "",
    val reason: String = "",
    val reasonCode: String = "UNUSED",
    val isLoading: Boolean = false,
    val error: String? = null,
    val scannedLot: MaterialLotDto? = null,
    val scannedWo: WorkOrderDto? = null,
    val matchedWos: List<WorkOrderDto> = emptyList(),
    val txNo: String? = null,
    val reopenedLines: Int = 0
)

/** 退料原因: 未用退仓 / 使用中破损 / 缺料 / 损坏 / 超合理损耗 */
val RETURN_REASON_OPTIONS = listOf(
    "UNUSED" to "未用退仓",
    "DAMAGED" to "使用中破损",
    "MISSING" to "缺料",
    "BROKEN" to "损坏",
    "WASTE" to "超合理损耗"
)

class ReturnViewModel : ViewModel() {

    private val materialRepo: MaterialRepository = MaterialLoaderApp.instance.materialRepository
    private val woRepo: WorkOrderRepository = MaterialLoaderApp.instance.workOrderRepository
    private val authRepo = MaterialLoaderApp.instance.authRepository

    private val _state = MutableStateFlow(ReturnUiState())
    val state: StateFlow<ReturnUiState> = _state.asStateFlow()

    fun onLotScanned(barcode: String) {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            val result = materialRepo.getMaterialLots(lotNo = barcode)
            result.fold(
                onSuccess = { lots ->
                    if (lots.isNotEmpty()) {
                        _state.value = _state.value.copy(
                            lotNo = barcode,
                            scannedLot = lots.first(),
                            step = ReturnStep.SCAN_WO,
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
                        _state.value = _state.value.copy(
                            workOrderCode = wos[0].code,
                            scannedWo = wos[0],
                            step = ReturnStep.INPUT,
                            isLoading = false
                        )
                    } else {
                        _state.value = _state.value.copy(
                            matchedWos = wos,
                            step = ReturnStep.SELECT_WO,
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
            step = ReturnStep.INPUT,
            matchedWos = emptyList()
        )
    }

    fun cancelWoSelection() {
        _state.value = _state.value.copy(
            step = ReturnStep.SCAN_WO,
            matchedWos = emptyList(),
            error = null
        )
    }

    fun onQtyChanged(qty: String) {
        _state.value = _state.value.copy(qty = qty, error = null)
    }

    fun onReasonChanged(reason: String) {
        _state.value = _state.value.copy(reason = reason)
    }

    fun onReasonCodeChanged(code: String) {
        _state.value = _state.value.copy(reasonCode = code)
    }

    fun confirmReturn() {
        val s = _state.value
        val qty = s.qty.toIntOrNull()
        if (qty == null || qty <= 0) {
            _state.value = s.copy(error = "Invalid quantity")
            return
        }

        _state.value = s.copy(step = ReturnStep.CONFIRM, isLoading = true, error = null)
        viewModelScope.launch {
            val user = authRepo.getCurrentUser()
            val operator = user?.username ?: "operator"
            val result = materialRepo.returnFromLine(
                s.lotNo, s.workOrderCode, qty, operator, s.reason, s.reasonCode
            )
            result.fold(
                onSuccess = { response ->
                    _state.value = _state.value.copy(
                        step = ReturnStep.SUCCESS,
                        txNo = response.txNo,
                        reasonCode = response.reasonCode ?: s.reasonCode,
                        reopenedLines = response.reopenedLines ?: 0,
                        isLoading = false
                    )
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message ?: "Failed to return material",
                        isLoading = false,
                        step = ReturnStep.INPUT
                    )
                }
            )
        }
    }

    fun reset() {
        _state.value = ReturnUiState()
    }
}
