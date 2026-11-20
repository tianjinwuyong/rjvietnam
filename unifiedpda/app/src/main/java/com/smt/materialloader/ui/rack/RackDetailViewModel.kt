package com.smt.materialloader.ui.rack

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.ShelfCell
import com.smt.materialloader.data.api.dto.SmartRack
import com.smt.materialloader.data.repository.ShelfRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class RackDetailUiState(
    val isLoading: Boolean = true,
    val error: String? = null,
    val shelf: SmartRack? = null,
    val cells: List<ShelfCell> = emptyList(),
    val lightOn: Boolean = false
)

class RackDetailViewModel : ViewModel() {
    private val shelfRepo: ShelfRepository = MaterialLoaderApp.instance.shelfRepository

    private val _state = MutableStateFlow(RackDetailUiState())
    val state: StateFlow<RackDetailUiState> = _state.asStateFlow()

    fun loadShelf(shelfCode: String) {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            shelfRepo.getShelfDetail(shelfCode).fold(
                onSuccess = { detail ->
                    _state.value = _state.value.copy(
                        shelf = detail.shelf,
                        cells = detail.cells,
                        isLoading = false
                    )
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message ?: "Failed to load rack",
                        isLoading = false
                    )
                }
            )
        }
    }

    fun lightOn(shelfCode: String) {
        // Hardware control — placeholder for emulator
        _state.value = _state.value.copy(lightOn = true)
    }

    fun lightOff(shelfCode: String) {
        _state.value = _state.value.copy(lightOn = false)
    }
}