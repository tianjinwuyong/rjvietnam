package com.smt.materialloader.ui.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.ShelfAction
import com.smt.materialloader.data.api.dto.ShelfTransaction
import com.smt.materialloader.data.repository.ShelfRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HistoryUiState(
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val transactions: List<ShelfTransaction> = emptyList(),
    val filter: ShelfAction? = null
)

class HistoryViewModel : ViewModel() {
    private val shelfRepo: ShelfRepository = MaterialLoaderApp.instance.shelfRepository

    private val _state = MutableStateFlow(HistoryUiState())
    val state: StateFlow<HistoryUiState> = _state.asStateFlow()

    init {
        loadTransactions()
    }

    fun loadTransactions() {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            val filter = _state.value.filter
            shelfRepo.getTransactions(
                action = filter?.name,
                limit = 100
            ).fold(
                onSuccess = { res ->
                    _state.value = _state.value.copy(
                        transactions = res.transactions,
                        isLoading = false,
                        isRefreshing = false
                    )
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(
                        error = e.message,
                        isLoading = false,
                        isRefreshing = false
                    )
                }
            )
        }
    }

    fun setFilter(action: ShelfAction?) {
        _state.value = _state.value.copy(filter = action)
        loadTransactions()
    }

    fun refresh() {
        _state.value = _state.value.copy(isRefreshing = true)
        loadTransactions()
    }
}