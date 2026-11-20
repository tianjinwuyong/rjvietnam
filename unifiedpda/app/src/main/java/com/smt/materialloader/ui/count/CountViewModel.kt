package com.smt.materialloader.ui.count

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class CountViewStep { SESSION_LIST, SESSION_DETAIL, COUNT_ITEM, SUBMITTED }

data class CountUiState(
    val step: CountViewStep = CountViewStep.SESSION_LIST,
    val sessions: List<CountSessionDto> = emptyList(),
    val alerts: List<CountAlertDto> = emptyList(),
    val selectedSession: CountSessionDto? = null,
    val selectedItem: CountItemDto? = null,
    val items: List<CountItemDto> = emptyList(),
    val countInput: String = "",
    val variance: Int? = null,
    val variancePct: Double? = null,
    val isLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val error: String? = null,
    val successMessage: String? = null,
    val filterStatus: String = "open"  // open | in_progress | all
)

class CountViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService
    private val prefs = MaterialLoaderApp.instance.prefs

    private val _state = MutableStateFlow(CountUiState())
    val state: StateFlow<CountUiState> = _state.asStateFlow()

    init {
        loadSessions()
    }

    fun loadSessions(status: String? = null) {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            val res = api.getCountSessions(status = if (status == "all") null else status)
            if (res.isSuccessful) {
                val items = res.body()?.data?.items ?: emptyList()
                _state.value = _state.value.copy(
                    sessions = items,
                    isLoading = false,
                    filterStatus = status ?: "open"
                )
            } else {
                _state.value = _state.value.copy(isLoading = false, error = "Failed to load sessions")
            }
        }
        loadAlerts()
    }

    private fun loadAlerts() {
        viewModelScope.launch {
            val res = api.getCountAlerts(acknowledged = false)
            if (res.isSuccessful) {
                _state.value = _state.value.copy(
                    alerts = res.body()?.data?.items ?: emptyList()
                )
            }
        }
    }

    fun onSessionClick(session: CountSessionDto) {
        _state.value = _state.value.copy(selectedSession = session, isLoading = true)
        viewModelScope.launch {
            val res = api.getCountSessionDetail(session.id)
            if (res.isSuccessful) {
                val detail = res.body()?.data
                _state.value = _state.value.copy(
                    selectedSession = detail?.session,
                    items = detail?.items ?: emptyList(),
                    step = CountViewStep.SESSION_DETAIL,
                    isLoading = false
                )
            } else {
                _state.value = _state.value.copy(isLoading = false, error = "Failed to load session")
            }
        }
    }

    fun claimSession(sessionId: String) {
        _state.value = _state.value.copy(isLoading = true)
        viewModelScope.launch {
            val res = api.claimCountSession(sessionId)
            if (res.isSuccessful) {
                loadSessions(_state.value.filterStatus)
                // Reload detail
                val detailRes = api.getCountSessionDetail(sessionId)
                if (detailRes.isSuccessful) {
                    val detail = detailRes.body()?.data
                    _state.value = _state.value.copy(
                        selectedSession = detail?.session,
                        items = detail?.items ?: emptyList(),
                        step = CountViewStep.SESSION_DETAIL,
                        isLoading = false
                    )
                } else {
                    _state.value = _state.value.copy(isLoading = false, step = CountViewStep.SESSION_DETAIL)
                }
            } else {
                _state.value = _state.value.copy(isLoading = false, error = "Failed to claim session")
            }
        }
    }

    fun onItemClick(item: CountItemDto) {
        _state.value = _state.value.copy(
            selectedItem = item,
            countInput = item.systemQty.toString(),
            variance = null,
            variancePct = null,
            step = CountViewStep.COUNT_ITEM
        )
    }

    fun onCountInputChanged(input: String) {
        val item = _state.value.selectedItem ?: return
        val qty = input.toIntOrNull()
        val var_ = qty?.let { it - item.systemQty }
        val varPct = if (item.systemQty > 0 && qty != null) {
            Math.round(Math.abs(var_!!) / item.systemQty.toDouble() * 100 * 100) / 100.0
        } else null
        _state.value = _state.value.copy(
            countInput = input,
            variance = var_,
            variancePct = varPct
        )
    }

    fun confirmCount() {
        val item = _state.value.selectedItem ?: return
        val qty = _state.value.countInput.toIntOrNull() ?: return
        _state.value = _state.value.copy(isLoading = true)
        viewModelScope.launch {
            val user = MaterialLoaderApp.instance.authRepository.getCurrentUser()
            val req = CountItemCountRequest(
                countedQty = qty,
                operatorId = user?.id?.toLong(),
                operatorName = user?.displayName
            )
            val res = api.countItem(item.id, req)
            if (res.isSuccessful) {
                // Reload session detail to get updated items
                val sessionId = _state.value.selectedSession?.id ?: return@launch
                val detailRes = api.getCountSessionDetail(sessionId)
                if (detailRes.isSuccessful) {
                    val detail = detailRes.body()?.data
                    val updatedItems = detail?.items ?: emptyList()
                    val updatedItem = updatedItems.find { it.id == item.id }
                    val hasVarAlert = updatedItem?.variance?.let {
                        val th = _state.value.selectedSession?.thresholdPct ?: 10
                        val pct: Double = if (item.systemQty > 0) Math.abs(it) * 100.0 / item.systemQty else 100.0
                        pct > th
                    } ?: false
                    _state.value = _state.value.copy(
                        items = updatedItems,
                        selectedItem = null,
                        countInput = "",
                        variance = null,
                        variancePct = null,
                        step = CountViewStep.SESSION_DETAIL,
                        isLoading = false,
                        successMessage = if (hasVarAlert) "差异已记录，预警已触发" else "已确认"
                    )
                } else {
                    _state.value = _state.value.copy(isLoading = false, step = CountViewStep.SESSION_DETAIL)
                }
            } else {
                _state.value = _state.value.copy(isLoading = false, error = "确认失败")
            }
        }
    }

    fun skipCount() {
        _state.value = _state.value.copy(
            selectedItem = null,
            countInput = "",
            variance = null,
            variancePct = null,
            step = CountViewStep.SESSION_DETAIL
        )
    }

    fun submitSession() {
        val session = _state.value.selectedSession ?: return
        _state.value = _state.value.copy(isSubmitting = true)
        viewModelScope.launch {
            val res = api.submitCountSession(session.id, CountSubmitRequest(notes = null))
            if (res.isSuccessful) {
                _state.value = _state.value.copy(
                    isSubmitting = false,
                    step = CountViewStep.SUBMITTED,
                    successMessage = "盘点已提交"
                )
            } else {
                _state.value = _state.value.copy(isSubmitting = false, error = "提交失败")
            }
        }
    }

    fun acknowledgeAlert(alertId: String) {
        viewModelScope.launch {
            api.acknowledgeCountAlert(alertId)
            loadAlerts()
        }
    }

    fun goBack() {
        when (_state.value.step) {
            CountViewStep.COUNT_ITEM -> _state.value = _state.value.copy(step = CountViewStep.SESSION_DETAIL, selectedItem = null)
            CountViewStep.SESSION_DETAIL -> _state.value = _state.value.copy(step = CountViewStep.SESSION_LIST, selectedSession = null)
            CountViewStep.SUBMITTED -> _state.value = _state.value.copy(step = CountViewStep.SESSION_LIST, selectedSession = null)
            else -> {}
        }
    }

    fun clearError() { _state.value = _state.value.copy(error = null) }
    fun clearSuccess() { _state.value = _state.value.copy(successMessage = null) }
}
