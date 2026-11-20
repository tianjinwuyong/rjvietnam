package com.smt.materialloader.ui.document

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.DocDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class EditableLine(
    val materialCode: String = "",
    val qty: String = "",
    val remarks: String = ""
)

data class DocEditState(
    val docType: DocType = DocType.INBOUND,
    val editingId: Long? = null,
    val supplierCode: String = "",
    val workOrderCode: String = "",
    val lines: List<EditableLine> = listOf(EditableLine()),
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null,
    val successMessage: String? = null,
    val savedDocId: Long? = null
)

class DocEditViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService

    private val _state = MutableStateFlow(DocEditState())
    val state: StateFlow<DocEditState> = _state.asStateFlow()

    fun init(type: DocType, editId: Long?) {
        _state.value = DocEditState(docType = type, editingId = editId)
        if (editId != null) {
            loadForEdit(type, editId)
        }
    }

    fun updateSupplierCode(v: String) {
        _state.value = _state.value.copy(supplierCode = v)
    }

    fun updateWorkOrderCode(v: String) {
        _state.value = _state.value.copy(workOrderCode = v)
    }

    fun updateLine(index: Int, line: EditableLine) {
        val lines = _state.value.lines.toMutableList()
        if (index in lines.indices) lines[index] = line
        _state.value = _state.value.copy(lines = lines)
    }

    fun addLine() {
        _state.value = _state.value.copy(lines = _state.value.lines + EditableLine())
    }

    fun removeLine(index: Int) {
        if (_state.value.lines.size <= 1) return
        _state.value = _state.value.copy(lines = _state.value.lines.filterIndexed { i, _ -> i != index })
    }

    fun loadForEdit(type: DocType, id: Long) {
        _state.value = _state.value.copy(isLoading = true)
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
                    val doc = res.body()?.data
                    if (doc != null) {
                        _state.value = _state.value.copy(
                            supplierCode = doc.supplierCode ?: "",
                            workOrderCode = doc.workOrderCode ?: "",
                            lines = doc.lines?.map { line ->
                                EditableLine(
                                    materialCode = line.materialCode ?: "",
                                    qty = line.requestedQty?.toString() ?: "",
                                    remarks = line.remarks ?: ""
                                )
                            } ?: listOf(EditableLine()),
                            isLoading = false,
                            editingId = id
                        )
                    } else {
                        _state.value = _state.value.copy(isLoading = false, error = "Document not found")
                    }
                } else {
                    _state.value = _state.value.copy(isLoading = false, error = "HTTP ${res.code()}")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(isLoading = false, error = e.message)
            }
        }
    }

    fun save() {
        val s = _state.value
        if (s.lines.isEmpty() || s.lines.all { it.materialCode.isBlank() }) {
            _state.value = _state.value.copy(error = "Add at least one material line")
            return
        }
        val linesPayload = s.lines
            .filter { it.materialCode.isNotBlank() }
            .map { mapOf(
                "material_code" to it.materialCode,
                "requested_qty" to (it.qty.toDoubleOrNull() ?: 0.0),
                "remarks" to it.remarks
            ) }
        val body = mutableMapOf<String, Any>(
            "supplier_code" to s.supplierCode,
            "work_order_code" to s.workOrderCode,
            "lines" to linesPayload
        )
        _state.value = _state.value.copy(isSaving = true, error = null)
        viewModelScope.launch {
            try {
                val res = when (s.docType) {
                    DocType.INBOUND -> if (s.editingId != null) {
                        api.updateInboundOrder(s.editingId, body)
                    } else {
                        api.createInboundOrder(body)
                    }
                    DocType.OUTBOUND -> if (s.editingId != null) {
                        api.updateOutboundOrder(s.editingId, body)
                    } else {
                        api.createOutboundOrder(body)
                    }
                    DocType.REQUISITION -> if (s.editingId != null) {
                        api.updateRequisition(s.editingId, body)
                    } else {
                        api.createRequisition(body)
                    }
                    DocType.RETURN -> if (s.editingId != null) {
                        api.updateReturnSlip(s.editingId, body)
                    } else {
                        api.createReturnSlip(body)
                    }
                    DocType.REPLENISHMENT -> if (s.editingId != null) {
                        api.updateReplenishment(s.editingId, body)
                    } else {
                        api.createReplenishment(body)
                    }
                }
                if (res.isSuccessful) {
                    val savedId = res.body()?.data?.id
                    _state.value = _state.value.copy(isSaving = false, successMessage = "Saved", savedDocId = savedId)
                } else {
                    _state.value = _state.value.copy(isSaving = false, error = "Save failed: HTTP ${res.code()}")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(isSaving = false, error = e.message)
            }
        }
    }

    fun clearError() { _state.value = _state.value.copy(error = null) }
    fun clearSuccess() { _state.value = _state.value.copy(successMessage = null) }
}
