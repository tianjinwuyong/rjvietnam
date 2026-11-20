package com.smt.materialloader.ui.wolist

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.WorkOrderDto
import com.smt.materialloader.data.repository.WorkOrderRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class WoListUiState(
    val isLoading: Boolean = true,
    val searchQuery: String = "",
    val workOrders: List<WorkOrderDto> = emptyList(),
    val filteredWos: List<WorkOrderDto> = emptyList(),
    val error: String? = null,
    val selectedWoCode: String? = null
)

class WoListViewModel : ViewModel() {
    private val woRepo: WorkOrderRepository = MaterialLoaderApp.instance.workOrderRepository

    private val _state = MutableStateFlow(WoListUiState())
    val state: StateFlow<WoListUiState> = _state.asStateFlow()

    init {
        loadWorkOrders()
    }

    fun loadWorkOrders() {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            woRepo.getWorkOrders().fold(
                onSuccess = { wos ->
                    _state.value = _state.value.copy(
                        workOrders = wos,
                        filteredWos = wos,
                        isLoading = false
                    )
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message,
                        isLoading = false
                    )
                }
            )
        }
    }

    fun onSearchChanged(query: String) {
        _state.value = _state.value.copy(searchQuery = query)
        if (query.isBlank()) {
            _state.value = _state.value.copy(filteredWos = _state.value.workOrders)
        } else {
            val q = query.uppercase()
            _state.value = _state.value.copy(
                filteredWos = _state.value.workOrders.filter { wo ->
                    wo.code.uppercase().contains(q) ||
                    (wo.productCode?.uppercase()?.contains(q) == true) ||
                    (wo.lineCode?.uppercase()?.contains(q) == true)
                }
            )
        }
    }

    fun onWoSelected(wo: WorkOrderDto) {
        _state.value = _state.value.copy(selectedWoCode = wo.code)
    }
}