package com.smt.materialloader.ui.pick

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.dto.PickOrderDto
import com.smt.materialloader.data.api.dto.PickOrderItemDto
import com.smt.materialloader.data.api.dto.PickAcceptLine
import com.smt.materialloader.util.PreferencesManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

internal fun JsonObject.text(key: String): String = if (has(key) && !get(key).isJsonNull) get(key).asString else ""

enum class PickView { PO_LIST, MATERIAL_LIST, SIGN, DONE }

data class PickUiState(
    val view: PickView = PickView.PO_LIST,
    val isLoading: Boolean = false,
    val isSubmitting: Boolean = false,
    val orders: List<PickOrderDto> = emptyList(),
    val selected: PickOrderDto? = null,
    val checked: Set<String> = emptySet(),
    val signatureToken: String? = null,
    val error: String? = null,
    val message: String? = null,
    val acceptanceId: String? = null,
    val announcements: List<JsonObject> = emptyList()
)

class PickAcceptanceViewModel : ViewModel() {
    private val repo = MaterialLoaderApp.instance.materialRepository
    private val prefs: PreferencesManager = MaterialLoaderApp.instance.prefs
    private val api = MaterialLoaderApp.instance.apiService

    private val _state = MutableStateFlow(PickUiState(isLoading = true))
    val state: StateFlow<PickUiState> = _state.asStateFlow()

    init { loadOrders() }

    private fun loadAnnouncements() {
        viewModelScope.launch {
            try {
                val res = api.getIssueAnnouncements(lineCode = prefs.getLineCode())
                if (res.isSuccessful) {
                    val root = res.body() ?: JsonObject()
                    val data = if (root.has("data")) root.getAsJsonObject("data") else root
                    val items = if (data.has("items") && !data.get("items").isJsonNull)
                        data.getAsJsonArray("items") else JsonArray()
                    val ready = mutableListOf<JsonObject>()
                    for (el in items) {
                        val o = el.asJsonObject
                        if (o.text("status") == "READY") ready.add(o)
                    }
                    _state.value = _state.value.copy(announcements = ready)
                }
            } catch (_: Exception) { /* keep empty */ }
        }
    }

    fun ackAnnouncement(id: Long) {
        viewModelScope.launch {
            try { api.ackIssueAnnouncement(id) } catch (_: Exception) {}
            _state.value = _state.value.copy(announcements = _state.value.announcements.filter { it.text("id").toLongOrNull() != id })
        }
    }

    fun loadOrders() {
        _state.value = _state.value.copy(isLoading = true, error = null)
        viewModelScope.launch {
            repo.getPickOrders().fold(
                onSuccess = { orders ->
                    _state.value = _state.value.copy(orders = orders.filter { it.items.isNotEmpty() }, isLoading = false)
                    loadAnnouncements()
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(isLoading = false, error = e.message ?: "加载拣料单失败")
                }
            )
        }
    }

    fun openOrder(order: PickOrderDto) {
        _state.value = _state.value.copy(
            view = PickView.MATERIAL_LIST,
            selected = order,
            checked = order.items.filter { it.status == "picked" }.map { it.id ?: it.materialCode ?: "" }.toSet(),
            error = null, message = null
        )
    }

    fun toggle(item: PickOrderItemDto) {
        val key = item.id ?: item.materialCode ?: return
        val next = _state.value.checked.toMutableSet()
        if (!next.add(key)) next.remove(key)
        _state.value = _state.value.copy(checked = next, error = null)
    }

    fun toggleAll() {
        val s = _state.value
        val all = s.selected?.items?.map { it.id ?: it.materialCode ?: "" }?.toSet() ?: emptySet()
        _state.value = s.copy(checked = if (s.checked.size == all.size) emptySet() else all)
    }

    fun goBack() {
        val s = _state.value
        _state.value = when (s.view) {
            PickView.MATERIAL_LIST, PickView.SIGN -> s.copy(view = PickView.PO_LIST, selected = null, checked = emptySet(), signatureToken = null, error = null)
            else -> s
        }
    }

    fun onSignatureCaptured(token: String?) {
        _state.value = _state.value.copy(signatureToken = token, error = null)
    }

    fun proceedToSign() {
        val s = _state.value
        val items = s.selected?.items ?: return
        if (s.checked.size < items.size) {
            _state.value = s.copy(error = "请勾选全部物料行后再签名")
            return
        }
        _state.value = s.copy(view = PickView.SIGN, error = null)
    }

    fun submit() {
        val s = _state.value
        val order = s.selected ?: return
        val operator = (prefs.getUser()?.username ?: "operator").ifBlank { "operator" }
        if (s.signatureToken.isNullOrBlank()) {
            _state.value = s.copy(error = "请先签名")
            return
        }
        val lines = order.items.mapNotNull { it.toAcceptLine() }
        if (lines.isEmpty()) {
            _state.value = s.copy(error = "没有可提交的物料行")
            return
        }
        val signatureHash = sha256(listOf(order.workOrderCode, operator, lines.joinToString("|") { "${it.lotNo}:${it.qty}" }, s.signatureToken).joinToString("||"))
        val evidenceQr = "PICK:${order.workOrderCode}"
        _state.value = s.copy(isSubmitting = true, error = null)
        viewModelScope.launch {
            repo.acceptPickOrder(order.workOrderCode, operator, signatureHash, evidenceQr, null, lines).fold(
                onSuccess = { res ->
                    _state.value = _state.value.copy(isSubmitting = false, view = PickView.DONE, acceptanceId = res.acceptanceId, message = "已验收，库存已扣减")
                },
                onFailure = { e ->
                    _state.value = _state.value.copy(isSubmitting = false, error = e.message ?: "验收失败")
                }
            )
        }
    }

    fun reset() {
        _state.value = PickUiState(isLoading = true)
        loadOrders()
    }

    private fun PickOrderItemDto.toAcceptLine(): PickAcceptLine? {
        val lot = lotNo?.trim().orEmpty()
        if (lot.isBlank()) return null
        val qty = if (requiredQty > 0) requiredQty else 1
        return PickAcceptLine(materialCode = materialCode, lotNo = lot, qty = qty)
    }

    private fun sha256(input: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        return digest.digest(input.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
