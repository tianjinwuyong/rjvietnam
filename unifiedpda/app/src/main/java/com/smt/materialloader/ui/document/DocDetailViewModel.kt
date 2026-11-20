package com.smt.materialloader.ui.document

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.DocDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DocDetailState(
    val doc: DocDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val actionLoading: Boolean = false,
    val successMessage: String? = null
)

class DocDetailViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService

    private val _state = MutableStateFlow(DocDetailState())
    val state: StateFlow<DocDetailState> = _state.asStateFlow()

    fun loadDoc(type: DocType, id: Long) {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
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
                        doc = res.body()?.data,
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
        _state.value = _state.value.copy(actionLoading = true, error = null)
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
                    _state.value = _state.value.copy(
                        actionLoading = false,
                        successMessage = "$verb success"
                    )
                    loadDoc(type, id)
                } else {
                    _state.value = _state.value.copy(actionLoading = false, error = "Action failed: HTTP ${res?.code()}")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(actionLoading = false, error = e.message)
            }
        }
    }

    fun deleteDoc(type: DocType, id: Long, onDeleted: () -> Unit) {
        _state.value = _state.value.copy(actionLoading = true)
        viewModelScope.launch {
            try {
                val res = when (type) {
                    DocType.INBOUND -> api.deleteInboundOrder(id)
                    DocType.OUTBOUND -> api.deleteOutboundOrder(id)
                    DocType.REQUISITION -> api.deleteRequisition(id)
                    DocType.RETURN -> api.deleteReturnSlip(id)
                    DocType.REPLENISHMENT -> api.deleteReplenishment(id)
                }
                if (res.isSuccessful) {
                    _state.value = _state.value.copy(actionLoading = false)
                    onDeleted()
                } else {
                    _state.value = _state.value.copy(actionLoading = false, error = "Delete failed")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(actionLoading = false, error = e.message)
            }
        }
    }

    fun clearError() { _state.value = _state.value.copy(error = null) }
    fun clearSuccess() { _state.value = _state.value.copy(successMessage = null) }
}
