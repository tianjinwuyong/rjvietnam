package com.smt.materialloader.ui.shelfout

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.ShelfCell
import com.smt.materialloader.data.api.dto.ShelfOutRequest
import com.smt.materialloader.data.repository.ShelfRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class ShelfOutStep { CONFIRM_CELL, SCAN_WO, REVIEW_EXECUTE, SUCCESS }

data class ShelfOutUiState(
    val step: ShelfOutStep = ShelfOutStep.CONFIRM_CELL,
    val pickQty: String = "1",
    val workOrderCode: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val resultMessage: String? = null,
    val lightOn: Boolean = false
)

class ShelfOutViewModel : ViewModel() {
    private val shelfRepo: ShelfRepository = MaterialLoaderApp.instance.shelfRepository

    private val _state = MutableStateFlow(ShelfOutUiState())
    val state: StateFlow<ShelfOutUiState> = _state.asStateFlow()

    fun initWithCell(cell: ShelfCell) {
        _state.value = _state.value.copy(pickQty = (cell.qty ?: 1).toString())
    }

    fun onPickQtyChanged(qty: String) {
        _state.value = _state.value.copy(pickQty = qty)
    }

    fun onWorkOrderScanned(barcode: String) {
        _state.value = _state.value.copy(workOrderCode = barcode.trim())
    }

    fun nextStep() {
        val s = _state.value
        when (s.step) {
            ShelfOutStep.CONFIRM_CELL -> _state.value = s.copy(step = ShelfOutStep.SCAN_WO)
            ShelfOutStep.SCAN_WO -> _state.value = s.copy(step = ShelfOutStep.REVIEW_EXECUTE)
            else -> {}
        }
    }

    fun prevStep() {
        val s = _state.value
        when (s.step) {
            ShelfOutStep.SCAN_WO -> _state.value = s.copy(step = ShelfOutStep.CONFIRM_CELL)
            ShelfOutStep.REVIEW_EXECUTE -> _state.value = s.copy(step = ShelfOutStep.SCAN_WO)
            else -> {}
        }
    }

    fun execute(shelfCode: String, cell: ShelfCell) {
        val s = _state.value
        _state.value = s.copy(isLoading = true, error = null, lightOn = true)
        viewModelScope.launch {
            val user = MaterialLoaderApp.instance.authRepository.getCurrentUser()
            val operator = user?.username ?: "operator"
            val req = ShelfOutRequest(
                labelIds = if (cell.labelId != null) listOf(cell.labelId) else emptyList(),
                shelfCode = shelfCode,
                cellNumbers = listOf(cell.cellNumber),
                workOrderCode = s.workOrderCode.ifBlank { null },
                operator = operator
            )
            shelfRepo.shelfOut(req).fold(
                onSuccess = {
                    _state.value = _state.value.copy(
                        step = ShelfOutStep.SUCCESS,
                        isLoading = false,
                        resultMessage = "Shelf out successful!",
                        lightOn = false
                    )
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message ?: "Shelf out failed",
                        isLoading = false,
                        lightOn = false
                    )
                }
            )
        }
    }

    fun reset() {
        _state.value = ShelfOutUiState()
    }
}