package com.smt.materialloader.ui.document

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.RetrofitClient
import com.smt.materialloader.data.api.dto.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class DocType { INBOUND, OUTBOUND, REQUISITION, RETURN, REPLENISHMENT }

data class DocListState(
    val docType: DocType = DocType.INBOUND,
    val items: List<DocDto> = emptyList(),
    val selectedItem: DocDto? = null,
    val isLoading: Boolean = false,
    val isActionLoading: Boolean = false,
    val error: String? = null,
    val successMessage: String? = null,
    val filterStatus: String = ""
)

class DocListViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService

    private val _state = MutableStateFlow(DocListState())
    val state: StateFlow<DocListState> = _state.asStateFlow()

    fun load(type: DocType, status: String? = null) {
        _state.value = _state.value.copy(docType = type, isLoading = true, error = null)
        viewModelScope.launch {
            try {
                val res = when (type) {
                    DocType.INBOUND -> api.getInboundOrders(status = (status ?: "").ifEmpty { null })
                    DocType.OUTBOUND -> api.getOutboundOrders(status = (status ?: "").ifEmpty { null })
                    DocType.REQUISITION -> api.getRequisitions(status = (status ?: "").ifEmpty { null })
                    DocType.RETURN -> api.getReturnSlips(status = (status ?: "").ifEmpty { null })
                    DocType.REPLENISHMENT -> api.getReplenishments(status = (status ?: "").ifEmpty { null })
                }
                if (res.isSuccessful) {
                    val body = res.body()
                    if (body?.data != null) {
                        _state.value = _state.value.copy(
                            items = body.data.items,
                            isLoading = false
                        )
                    } else {
                        _state.value = _state.value.copy(isLoading = false, error = body?.error?.message ?: "Empty response")
                    }
                } else {
                    _state.value = _state.value.copy(isLoading = false, error = "HTTP ${res.code()}")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(isLoading = false, error = e.message ?: "Unknown error")
            }
        }
    }

    fun loadDetail(type: DocType, id: Long) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true)
            try {
                val res = when (type) {
                    DocType.INBOUND -> api.getInboundOrder(id)
                    DocType.OUTBOUND -> api.getOutboundOrder(id)
                    DocType.REQUISITION -> api.getRequisition(id)
                    DocType.RETURN -> api.getReturnSlip(id)
                    DocType.REPLENISHMENT -> api.getReplenishment(id)
                }
                if (res.isSuccessful) {
                    _state.value = _state.value.copy(
                        selectedItem = res.body()?.data,
                        isLoading = false
                    )
                } else {
                    _state.value = _state.value.copy(isLoading = false, error = "HTTP ${res.code()}")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(isLoading = false, error = e.message)
            }
        }
    }

    fun doAction(type: DocType, id: Long, verb: String) {
        _state.value = _state.value.copy(isActionLoading = true)
        viewModelScope.launch {
            try {
                val res = when (type) {
                    DocType.INBOUND -> when (verb) {
                        "submit" -> api.submitInboundOrder(id)
                        "approve" -> api.approveInboundOrder(id)
                        "reject" -> api.rejectInboundOrder(id)
                        "execute" -> api.executeInboundOrder(id)
                        "complete" -> api.completeInboundOrder(id)
                        else -> null
                    }
                    DocType.OUTBOUND -> when (verb) {
                        "submit" -> api.submitOutboundOrder(id)
                        "approve" -> api.approveOutboundOrder(id)
                        "reject" -> api.rejectOutboundOrder(id)
                        "execute" -> api.executeOutboundOrder(id)
                        "complete" -> api.completeOutboundOrder(id)
                        else -> null
                    }
                    DocType.REQUISITION -> when (verb) {
                        "submit" -> api.submitRequisition(id)
                        "approve" -> api.approveRequisition(id)
                        "reject" -> api.rejectRequisition(id)
                        "execute" -> api.executeRequisition(id)
                        "complete" -> api.completeRequisition(id)
                        else -> null
                    }
                    DocType.RETURN -> when (verb) {
                        "submit" -> api.submitReturnSlip(id)
                        "reject" -> api.rejectReturnSlip(id)
                        "execute" -> api.executeReturnSlip(id)
                        "complete" -> api.completeReturnSlip(id)
                        else -> null
                    }
                    DocType.REPLENISHMENT -> when (verb) {
                        "submit" -> api.submitReplenishment(id)
                        "approve" -> api.approveReplenishment(id)
                        "reject" -> api.rejectReplenishment(id)
                        "execute" -> api.executeReplenishment(id)
                        "complete" -> api.completeReplenishment(id)
                        else -> null
                    }
                }
                if (res != null && res.isSuccessful) {
                    _state.value = _state.value.copy(isActionLoading = false, successMessage = "$verb success")
                    load(type, _state.value.filterStatus)
                } else {
                    _state.value = _state.value.copy(isActionLoading = false, error = "Action failed: HTTP ${res?.code()}")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(isActionLoading = false, error = e.message)
            }
        }
    }

    fun deleteDoc(type: DocType, id: Long) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isActionLoading = true)
            try {
                val res = when (type) {
                    DocType.INBOUND -> api.deleteInboundOrder(id)
                    DocType.OUTBOUND -> api.deleteOutboundOrder(id)
                    DocType.REQUISITION -> api.deleteRequisition(id)
                    DocType.RETURN -> api.deleteReturnSlip(id)
                    DocType.REPLENISHMENT -> api.deleteReplenishment(id)
                }
                if (res.isSuccessful) {
                    _state.value = _state.value.copy(isActionLoading = false)
                    load(type, _state.value.filterStatus)
                } else {
                    _state.value = _state.value.copy(isActionLoading = false, error = "Delete failed")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(isActionLoading = false, error = e.message)
            }
        }
    }

    fun setFilter(status: String) {
        _state.value = _state.value.copy(filterStatus = status)
        load(_state.value.docType, status)
    }

    fun clearError() { _state.value = _state.value.copy(error = null) }
    fun clearSuccess() { _state.value = _state.value.copy(successMessage = null) }
}
