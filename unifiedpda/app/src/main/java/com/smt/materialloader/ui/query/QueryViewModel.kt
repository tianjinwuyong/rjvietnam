package com.smt.materialloader.ui.query

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.InventoryTransactionDto
import com.smt.materialloader.data.api.dto.MaterialLotDto
import com.smt.materialloader.data.repository.MaterialRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class SearchMode { LOT, MATERIAL, WORK_ORDER }

data class QueryUiState(
    val searchQuery: String = "",
    val searchMode: SearchMode = SearchMode.LOT,
    val isLoading: Boolean = false,
    val error: String? = null,
    val results: List<MaterialLotDto> = emptyList(),
    val selectedLot: MaterialLotDto? = null,
    val transactions: List<InventoryTransactionDto> = emptyList(),
    val isLoadingTransactions: Boolean = false
)

class QueryViewModel : ViewModel() {

    private val materialRepo: MaterialRepository = MaterialLoaderApp.instance.materialRepository
    private var searchJob: Job? = null

    private val _state = MutableStateFlow(QueryUiState())
    val state: StateFlow<QueryUiState> = _state.asStateFlow()

    fun onSearchQueryChanged(query: String) {
        _state.value = _state.value.copy(searchQuery = query, error = null)
        searchJob?.cancel()
        if (query.isBlank()) {
            _state.value = _state.value.copy(results = emptyList())
            return
        }
        searchJob = viewModelScope.launch {
            delay(500) // debounce
            performSearch()
        }
    }

    fun onSearchModeChanged(mode: SearchMode) {
        _state.value = _state.value.copy(searchMode = mode, results = emptyList(), selectedLot = null)
        if (_state.value.searchQuery.isNotBlank()) {
            searchJob?.cancel()
            searchJob = viewModelScope.launch {
                delay(300)
                performSearch()
            }
        }
    }

    private suspend fun performSearch() {
        val query = _state.value.searchQuery.trim()
        if (query.isEmpty()) return

        _state.value = _state.value.copy(isLoading = true, error = null)

        val result = when (_state.value.searchMode) {
            SearchMode.LOT -> materialRepo.getMaterialLots(lotNo = query)
            SearchMode.MATERIAL -> materialRepo.getMaterialLots(q = query)
            SearchMode.WORK_ORDER -> materialRepo.getMaterialLots(q = query)
        }

        result.fold(
            onSuccess = { lots ->
                _state.value = _state.value.copy(
                    results = lots,
                    isLoading = false
                )
            },
            onFailure = { e ->
                _state.value = _state.value.copy(
                    error = e.message ?: "Search failed",
                    isLoading = false
                )
            }
        )
    }

    fun selectLot(lot: MaterialLotDto) {
        _state.value = _state.value.copy(
            selectedLot = lot,
            isLoadingTransactions = true
        )
        viewModelScope.launch {
            val result = materialRepo.getLotTransactions(lot.id)
            result.fold(
                onSuccess = { txs ->
                    _state.value = _state.value.copy(
                        transactions = txs,
                        isLoadingTransactions = false
                    )
                },
                onFailure = {
                    _state.value = _state.value.copy(
                        transactions = emptyList(),
                        isLoadingTransactions = false
                    )
                }
            )
        }
    }

    fun clearSelection() {
        _state.value = _state.value.copy(
            selectedLot = null,
            transactions = emptyList()
        )
    }
}
