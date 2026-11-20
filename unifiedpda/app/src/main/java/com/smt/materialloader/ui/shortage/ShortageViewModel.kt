package com.smt.materialloader.ui.shortage

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One 缺料 line pushed by WMS: material code + qty to handle. */
data class ShortageItem(
    val lineId: Long,
    val lineNo: Int,
    val materialCode: String,
    val qty: Double,
    val lotNo: String,
    val locationCode: String,
    val locationQr: String,
    val markedBy: String,
    val markedAt: String,
    val workOrderCode: String,
    val slipNo: String,
    val taskStatus: String?
)

data class ShortageUiState(
    val items: List<ShortageItem> = emptyList(),
    val loading: Boolean = false,
    val busyId: Long? = null,
    val error: String? = null,
    val message: String? = null
)

class ShortageViewModel : ViewModel() {

    private val api = MaterialLoaderApp.instance.apiService

    private val _state = MutableStateFlow(ShortageUiState())
    val state: StateFlow<ShortageUiState> = _state.asStateFlow()

    init { load() }

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            try {
                val res = api.getShortages()
                if (!res.isSuccessful) throw IllegalStateException("HTTP ${res.code()}")
                val root = res.body() ?: JsonObject()
                val data = if (root.has("data")) root.getAsJsonObject("data") else root
                val arr = if (data.has("items") && !data.get("items").isJsonNull)
                    data.getAsJsonArray("items") else JsonArray()
                _state.value = ShortageUiState(items = arr.map { e ->
                    val o = e.asJsonObject
                    ShortageItem(
                        lineId = o.get("lineId").asLong,
                        lineNo = if (o.has("lineNo") && !o.get("lineNo").isJsonNull) o.get("lineNo").asInt else 0,
                        materialCode = o.text("materialCode"),
                        qty = if (o.has("qty") && !o.get("qty").isJsonNull) o.get("qty").asDouble else 0.0,
                        lotNo = o.text("lotNo"),
                        locationCode = o.text("locationCode"),
                        locationQr = o.text("locationQr"),
                        markedBy = o.text("markedBy"),
                        markedAt = o.text("markedAt"),
                        workOrderCode = o.text("workOrderCode"),
                        slipNo = o.text("slipNo"),
                        taskStatus = o.text("taskStatus").ifBlank { null }
                    )
                })
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.message ?: "Load failed")
            }
        }
    }

    /** Warehouse manager handled it (replenished/substituted): line requeued. */
    fun resolve(lineId: Long) {
        _state.value = _state.value.copy(busyId = lineId, error = null)
        viewModelScope.launch {
            try {
                val res = api.resolveShortage(lineId)
                if (!res.isSuccessful) throw IllegalStateException("HTTP ${res.code()}")
                _state.value = _state.value.copy(busyId = null, message = "已处理 ✓ 刷新中…")
                load()
            } catch (e: Exception) {
                _state.value = _state.value.copy(busyId = null, error = e.message ?: "Resolve failed")
            }
        }
    }
}

private fun JsonObject.text(key: String): String =
    if (has(key) && !get(key).isJsonNull) get(key).asString else ""
