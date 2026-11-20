package com.smt.materialloader.ui.shelfin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.ShelfInRequest
import com.smt.materialloader.data.repository.ShelfRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class ShelfInStep { SCAN_LABEL, SCAN_MATERIAL, REVIEW, SUCCESS }

data class ShelfInUiState(
    val step: ShelfInStep = ShelfInStep.SCAN_LABEL,
    val labelId: String = "",
    val materialCode: String = "",
    val lotNo: String = "",
    val qty: String = "1",
    val isLoading: Boolean = false,
    val error: String? = null,
    val resultMessage: String? = null
)

class ShelfInViewModel : ViewModel() {
    private val shelfRepo: ShelfRepository = MaterialLoaderApp.instance.shelfRepository

    private val _state = MutableStateFlow(ShelfInUiState())
    val state: StateFlow<ShelfInUiState> = _state.asStateFlow()

    fun onLabelScanned(barcode: String) {
        _state.value = _state.value.copy(labelId = barcode.trim(), step = ShelfInStep.SCAN_MATERIAL)
    }

    fun onMaterialCodeChanged(code: String) {
        _state.value = _state.value.copy(materialCode = code)
    }

    fun onLotNoChanged(lot: String) {
        _state.value = _state.value.copy(lotNo = lot)
    }

    fun onQtyChanged(qty: String) {
        _state.value = _state.value.copy(qty = qty)
    }

    fun nextStep() {
        val s = _state.value
        when (s.step) {
            ShelfInStep.SCAN_LABEL -> {
                if (s.labelId.isNotBlank()) {
                    _state.value = s.copy(step = ShelfInStep.SCAN_MATERIAL)
                }
            }
            ShelfInStep.SCAN_MATERIAL -> {
                if (s.materialCode.isNotBlank() && s.lotNo.isNotBlank() && (s.qty.toIntOrNull() ?: 0) > 0) {
                    _state.value = s.copy(step = ShelfInStep.REVIEW)
                }
            }
            else -> {}
        }
    }

    fun prevStep() {
        val s = _state.value
        when (s.step) {
            ShelfInStep.SCAN_MATERIAL -> _state.value = s.copy(step = ShelfInStep.SCAN_LABEL)
            ShelfInStep.REVIEW -> _state.value = s.copy(step = ShelfInStep.SCAN_MATERIAL)
            else -> {}
        }
    }

    fun execute(shelfCode: String, cellNumber: String) {
        val s = _state.value
        _state.value = s.copy(isLoading = true, error = null)
        viewModelScope.launch {
            val user = MaterialLoaderApp.instance.authRepository.getCurrentUser()
            val operator = user?.username ?: "operator"
            val req = ShelfInRequest(
                labelId = s.labelId,
                shelfCode = shelfCode,
                cellNumber = cellNumber,
                materialCode = s.materialCode,
                lotNo = s.lotNo,
                qty = s.qty.toIntOrNull() ?: 1,
                operator = operator
            )
            shelfRepo.shelfIn(req).fold(
                onSuccess = {
                    _state.value = _state.value.copy(
                        step = ShelfInStep.SUCCESS,
                        isLoading = false,
                        resultMessage = "Shelf in successful!"
                    )
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message ?: "Shelf in failed",
                        isLoading = false
                    )
                }
            )
        }
    }

    fun reset() {
        _state.value = ShelfInUiState()
    }
}