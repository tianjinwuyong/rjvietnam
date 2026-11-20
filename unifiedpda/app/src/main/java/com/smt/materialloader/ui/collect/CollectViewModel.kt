package com.smt.materialloader.ui.collect

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.data.api.RetrofitClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One material line the warehouse collector must pick from a location. */
data class CollectLine(
    val id: Long,
    val lineNo: Int,
    val materialCode: String,
    val materialName: String,
    val lotNo: String,
    val materialSn: String,
    val locationCode: String,
    val locationQr: String,
    val requiredQty: Double,
    val status: String,          // PENDING | COLLECTED | ISSUED
    val scannedQr: String,
    val collectedBy: String,
    val processStage: String = "",
    val processDomain: String = "",
    val assignedTo: String = ""
)

data class CollectOrder(
    val id: Long,
    val collectNo: String,
    val workOrderCode: String,
    val lineCode: String,
    val status: String,          // OPEN | PARTIAL | COLLECTED
    val collector: String
)

/** One work order available from WMS to collect for. */
data class CollectWoOption(
    val workOrderCode: String,
    val lineCode: String,
    val materialCount: Int,
    val collectNo: String?,
    val collectStatus: String?,
    val collectedLines: Int = 0,
    val totalLines: Int = 0
)

data class CollectUiState(
    val order: CollectOrder? = null,
    val lines: List<CollectLine> = emptyList(),
    val available: List<CollectWoOption> = emptyList(),
    val loadingAvailable: Boolean = false,
    val loading: Boolean = false,
    val busy: Boolean = false,
    val error: String? = null,
    val message: String? = null,
    val locationScan: String = "",
    val materialScan: String = "",
    val lastScannedLineId: Long? = null,
    val highlightLineId: Long? = null,
    val alarm: String? = null,
    val mineOnly: Boolean = false
)


fun JsonObject.text(key: String): String = if (has(key) && !get(key).isJsonNull) get(key).asString else ""

class CollectViewModel : ViewModel() {

    private val api = MaterialLoaderApp.instance.apiService
    private val prefs = MaterialLoaderApp.instance.prefs

    private val _state = MutableStateFlow(CollectUiState())
    val state: StateFlow<CollectUiState> = _state.asStateFlow()

    /** Kitting home 集料员 defaults to "my assigned segment only" — everyone
     *  else (line pickers) sees the full staged set. */
    init {
        if (collectMode) _state.value = _state.value.copy(mineOnly = true)
        refreshAvailable()
    }

    /** Work-order dropdown synced from WMS: open pick orders + active collect lists. */
    fun refreshAvailable() {
        _state.value = _state.value.copy(loadingAvailable = true)
        viewModelScope.launch {
            try {
                val collectByWo = mutableMapOf<String, JsonObject>()
                try {
                    val cos = api.getCollectOrder(workOrderCode = null, domain = userDomain.ifEmpty { null })
                    if (cos.isSuccessful) {
                        val root = cos.body() ?: JsonObject()
                        val data = if (root.has("data")) root.getAsJsonObject("data") else root
                        val items = if (data.has("items") && !data.get("items").isJsonNull)
                            data.getAsJsonArray("items") else JsonArray()
                        for (el in items) {
                            val o = el.asJsonObject
                            collectByWo[o.text("workOrderCode").uppercase()] = o
                        }
                    }
                } catch (_: Exception) { /* collect endpoints need the restarted API */ }

                val options = mutableListOf<CollectWoOption>()
                // Kitting home (集料员, MATERIAL_COLLECTOR): ONLY WOs that have a
                // collect list are "need material collection" — the pick-order
                // feed belongs to the line-side Material Picking screens.
                if (!collectMode) {
                    try {
                        val pos = api.getPickOrders(workOrderCode = null)
                        if (pos.isSuccessful) {
                            for (po in pos.body()?.data?.items ?: emptyList()) {
                                val wo = po.workOrderCode.trim().uppercase()
                                if (wo.isEmpty()) continue
                                val co = collectByWo[wo]
                                options += CollectWoOption(
                                    workOrderCode = wo,
                                    lineCode = po.lineCode ?: "",
                                    materialCount = po.items.size,
                                    collectNo = co?.text("collectNo"),
                                    collectStatus = co?.text("status")
                                )
                            }
                        }
                    } catch (_: Exception) { /* offline: keep manual input */ }
                }
                // Backfill live progress (collected/total lines) from the WMS
                // collect-order feed for every option that carries a list.
                val byWo = options.associateBy { it.workOrderCode }
                for ((wo, co) in collectByWo) {
                    val existing = byWo[wo]
                    if (existing != null) {
                        val idx = options.indexOf(existing)
                        options[idx] = existing.copy(
                            collectNo = existing.collectNo ?: co.text("collectNo"),
                            collectStatus = existing.collectStatus ?: co.text("status"),
                            collectedLines = co.get("collectedLines")?.asInt ?: existing.collectedLines,
                            totalLines = co.get("totalLines")?.asInt ?: existing.totalLines
                        )
                    } else {
                        options += CollectWoOption(
                            workOrderCode = wo,
                            lineCode = co.text("lineCode"),
                            materialCount = co.get("totalLines")?.asInt ?: 0,
                            collectNo = co.text("collectNo"),
                            collectStatus = co.text("status"),
                            collectedLines = co.get("collectedLines")?.asInt ?: 0,
                            totalLines = co.get("totalLines")?.asInt ?: 0
                        )
                    }
                }
                _state.value = _state.value.copy(available = options, loadingAvailable = false)
            } catch (e: Exception) {
                _state.value = _state.value.copy(available = emptyList(), loadingAvailable = false)
            }
        }
    }

    private val currentUser: String
        get() = prefs.getUser()?.username ?: "VN_WC_001"

    /** 集料员 home (warehouse staging, MATERIAL_COLLECTOR) vs line-side
     *  picking home. Drives which lines are listed and which action a
     *  confirm performs (collect vs pick). */
    val collectMode: Boolean
        get() = (prefs.getUser()?.roleKey?.trim()?.uppercase().orEmpty()) == "MATERIAL_COLLECTOR"

    /** Current logged-in 工号, exposed to the UI for assignment display. */
    val currentUserForDisplay: String
        get() = currentUser

    /** Line-role collectors (VN_WC_SMT/AUTO/MAN …) only see their own domain. */
    val userDomain: String
        get() {
            val u = currentUser.trim().uppercase()
            return when {
                u.contains("_SMT") || u.contains("SMT_") -> "SMT"
                u.contains("_AUTO") || u.contains("AUTO_") -> "AUTO"
                u.contains("_MAN") || u.contains("_MANUAL") || u.contains("MANUAL_") -> "MANUAL"
                u.contains("_PKG") || u.contains("_PACKAGING") || u.contains("PACKAGING_") -> "PACKAGING"
                else -> ""
            }
        }

    private fun orderFromJson(item: JsonObject): CollectOrder? {
        if (!item.has("id")) return null
        return CollectOrder(
            id = item.get("id").asLong,
            collectNo = item.text("collectNo"),
            workOrderCode = item.text("workOrderCode"),
            lineCode = item.text("lineCode"),
            status = item.text("status"),
            collector = item.text("collector")
        )
    }

    private fun linesFromJson(lines: JsonArray): List<CollectLine> {
        val out = mutableListOf<CollectLine>()
        for (el in lines) {
            val item = el.asJsonObject
            val name = if (item.has("materialName") && !item.get("materialName").isJsonNull) {
                val n = item.getAsJsonObject("materialName")
                n.text("zh").takeIf { it.isNotBlank() } ?: n.text("en").takeIf { it.isNotBlank() }
                    ?: n.text("vi").takeIf { it.isNotBlank() } ?: ""
            } else ""
            out += CollectLine(
                id = item.get("id").asLong,
                lineNo = item.get("lineNo").asInt,
                materialCode = item.text("materialCode"),
                materialName = name,
                lotNo = item.text("lotNo"),
                materialSn = item.text("materialSn"),
                locationCode = item.text("locationCode"),
                locationQr = item.text("locationQr"),
                requiredQty = if (item.has("requiredQty") && !item.get("requiredQty").isJsonNull) item.get("requiredQty").asDouble else 0.0,
                status = item.text("status"),
                scannedQr = item.text("scannedQr"),
                collectedBy = item.text("collectedBy"),
                processStage = item.text("processStage"),
                processDomain = item.text("processDomain"),
                assignedTo = item.text("assignedTo")
            )
        }
        return out
    }

    /** Load the active collect order for a WO. Line-role collectors (SMT/AUTO/MAN)
     *  only receive their own domain's lines from the API. When the WO has no
     *  collect list yet it is generated automatically — a released WO always has
     *  materials to collect. */
    fun load(workOrderCode: String) {
        val code = workOrderCode.trim().uppercase()
        if (code.isEmpty()) return
        val domain = userDomain.ifEmpty { null }
        // Server returns the full order; "my tasks only" is a client-side view
        // (unassigned lines are fair game for everyone, assigned lines belong
        // to exactly one PDA). Picking mode always sees every staged line.
        val state = _state.value
        val mineOnly = state.mineOnly
        _state.value = CollectUiState(loading = true, mineOnly = mineOnly)
        viewModelScope.launch {
            try {
                val response = api.getCollectOrder(workOrderCode = code, domain = domain, assignee = null)
                if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code()}")
                val root = response.body() ?: JsonObject()
                val data = if (root.has("data")) root.getAsJsonObject("data") else root
                if (!data.has("order") || data.get("order").isJsonNull) {
                    // No collect list yet — generate it right away (idempotent on
                    // the server: existing OPEN/PARTIAL orders are reused).
                    generate(code)
                    return@launch
                }
                val order = orderFromJson(data.getAsJsonObject("order"))
                val lines = linesFromJson(data.getAsJsonArray("items") ?: JsonArray())
                val summary = if (data.has("summary") && !data.get("summary").isJsonNull)
                    data.getAsJsonObject("summary") else null
                val scopedMsg = summary?.let {
                    "${it.text("domain").ifBlank { "ALL" }}${if (it.text("assignee").isNotBlank()) "/" + it.text("assignee") else ""}: ${it.text("visible")} 行，待领 ${it.text("pending")}"
                } ?: ""
                val domainTag = userDomain.takeIf { it.isNotBlank() }?.let { " [$it]" } ?: ""
                val loadedMsg = "Pick list ${order?.collectNo ?: ""}$domainTag 加载完成" +
                    (if (scopedMsg.isNotBlank()) " · $scopedMsg" else "")

                // mineOnly client-side guard: even when the server returns lines
                // (e.g. pooled user), only show own assigned or unassigned items.
                val effectiveLines = if (_state.value.mineOnly) {
                    lines.filter { l ->
                        l.assignedTo.isBlank() || l.assignedTo.equals(currentUser, ignoreCase = true)
                    }
                } else lines
                _state.value = CollectUiState(
                    order = order,
                    lines = effectiveLines,
                    mineOnly = _state.value.mineOnly,
                    message = loadedMsg
                )
            } catch (e: Exception) {
                _state.value = CollectUiState(error = e.message ?: "Load failed")
            }
        }
    }

    /** WMS generates the collect list for a WO (FIFO material + location). */
    fun generate(workOrderCode: String) {
        val code = workOrderCode.trim().uppercase()
        if (code.isEmpty()) return
        _state.value = _state.value.copy(busy = true, error = null, message = null)
        viewModelScope.launch {
            try {
                val response = api.generateCollectOrder(mapOf("workOrderCode" to code))
                if (!response.isSuccessful) throw IllegalStateException(
                    parseError(response.errorBody()?.string())
                )
                val root = response.body() ?: JsonObject()
                val data = if (root.has("data")) root.getAsJsonObject("data") else root
                val order = if (data.has("order") && !data.get("order").isJsonNull)
                    orderFromJson(data.getAsJsonObject("order")) else null
                val lines = if (data.has("items") && !data.get("items").isJsonNull)
                    linesFromJson(data.getAsJsonArray("items")) else emptyList()
                _state.value = CollectUiState(
                    order = order,
                    lines = lines,
                    busy = false,
                    message = "Collect list ready: ${order?.collectNo ?: ""} · ${lines.size} lines"
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    busy = false,
                    error = e.message ?: "Generate failed"
                )
            }
        }
    }

    /** One-tap confirm of a single line (account login is the authority).
     *  集料员 collects (PENDING/NO_MATERIAL -> COLLECTED, or flags 缺料);
     *  领料员 picks staged lines (COLLECTED -> ISSUED). action = "confirm"
     *  (default), "noMaterial" or "pick"; "auto" resolves it from the role. */
    fun confirmLine(lineId: Long, action: String = "auto") {
        val current = _state.value
        val orderId = current.order?.id ?: return
        val act = when {
            action == "noMaterial" -> "noMaterial"
            action == "pick" || !collectMode -> "pick"
            else -> "confirm"
        }
        _state.value = current.copy(busy = true, error = null, message = null)
        viewModelScope.launch {
            try {
                val response = api.confirmCollectLine(
                    id = orderId,
                    body = mapOf(
                        "lineId" to lineId,
                        "operator" to currentUser,
                        "action" to act
                    )
                )
                if (!response.isSuccessful) throw IllegalStateException(
                    parseError(response.errorBody()?.string())
                )
                val woCode = current.order?.workOrderCode
                val doneMsg = when (act) {
                    "noMaterial" -> "已标记缺料 ✓ 刷新中…"
                    "pick" -> "已确认领取 ✓ 刷新中…"
                    else -> "已确认收集 ✓ 刷新中…"
                }
                if (woCode != null) {
                    _state.value = _state.value.copy(busy = false, message = doneMsg)
                    load(woCode)
                } else {
                    _state.value = _state.value.copy(busy = false, message = "Confirmed ✓")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(busy = false, error = e.message ?: "Confirm failed")
            }
        }
    }

    /** Flag a pending line as 缺料 (no stock on the shelf right now). */
    fun markNoMaterial(lineId: Long) = confirmLine(lineId, "noMaterial")

    /** Claim one PENDING line for this PDA (who takes what is recorded). */
    fun claimLine(lineId: Long) = assignLines(
        mapOf("assignments" to listOf(mapOf("lineId" to lineId, "assignee" to currentUser))),
        "已认领 ✓ 刷新中…"
    )

    /** Release my claim on one line back to the unassigned pool. */
    fun releaseLine(lineId: Long) = assignLines(
        mapOf("assignments" to listOf(mapOf("lineId" to lineId, "assignee" to ""))),
        "已释放 ✓ 刷新中…"
    )

    /** Ask WMS to auto-allocate this order's unassigned lines across the
     *  PDAs working it (dynamic, location-ordered, load-balanced). */
    fun autoAllocate() = assignLines(mapOf("assignees" to emptyList<String>()), "已自动分配 ✓ 刷新中…")

    private fun assignLines(body: Map<String, @JvmSuppressWildcards Any?>, okMsg: String) {
        val current = _state.value
        val orderId = current.order?.id ?: return
        _state.value = current.copy(busy = true, error = null, message = null)
        viewModelScope.launch {
            try {
                val response = api.assignCollectLines(id = orderId, body = body)
                if (!response.isSuccessful) throw IllegalStateException(
                    parseError(response.errorBody()?.string())
                )
                val woCode = current.order?.workOrderCode
                if (woCode != null) {
                    _state.value = _state.value.copy(busy = false, message = okMsg)
                    load(woCode)
                } else {
                    _state.value = _state.value.copy(busy = false, message = "Assigned ✓")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(busy = false, error = e.message ?: "Assign failed")
            }
        }
    }

    /** One-tap take of EVERY available line in this PDA's domain.
     *  Picking PDA only — collection must be confirmed line by line. */
    fun confirmAllDomain() {
        val current = _state.value
        val orderId = current.order?.id ?: return
        val pending = current.lines.count { if (collectMode) it.status == "PENDING" else it.status == "COLLECTED" }
        if (pending == 0) {
            _state.value = current.copy(message = if (collectMode) "本域已全部确认，无需操作" else "本单已集齐物料已全部领走，无需操作")
            return
        }
        _state.value = current.copy(busy = true, error = null, message = null)
        viewModelScope.launch {
            try {
                val response = api.confirmCollectLine(
                    id = orderId,
                    body = mapOf(
                        "confirmAll" to true,
                        "operator" to currentUser,
                        "action" to if (collectMode) "confirm" else "pick"
                    )
                )
                if (!response.isSuccessful) throw IllegalStateException(
                    parseError(response.errorBody()?.string())
                )
                val woCode = current.order?.workOrderCode
                if (woCode != null) {
                    _state.value = _state.value.copy(busy = false, message = if (collectMode) "本域 $pending 项已全部确认 ✓ 刷新中…" else "本域 $pending 项已全部领走 ✓ 刷新中…")
                    load(woCode)
                } else {
                    _state.value = _state.value.copy(busy = false, message = "Confirmed ✓")
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(busy = false, error = e.message ?: "Confirm failed")
            }
        }
    }

    /** Toggle "only my assigned lines" view; reloads the current order. */
    fun toggleMineOnly() {
        val next = !_state.value.mineOnly
        _state.value = _state.value.copy(mineOnly = next, message = if (next) "只显示分给我的料" else "显示全部料")
        val wo = _state.value.order?.workOrderCode
        if (wo != null) load(wo)
    }

    fun reset() {
        _state.value = CollectUiState()
    }

    /**
     * Camera scan on a material box/roll QR: match the scanned value against the
     * loaded lines (lot, material SN, material code, location QR) and highlight
     * the matching item so the collector jumps straight to it.
     */
    fun locateByScan(scanned: String) {
        val current = _state.value
        val qr = scanned.trim().uppercase()
        if (qr.isEmpty()) return
        val norm = { s: String -> s.uppercase().replace(Regex("^WMS-(LOC|AREA):"), "").replace(Regex("[\\s\\-_]"), "") }
        val qrN = norm(qr)
        val match = current.lines.find { l ->
            // Box/roll label codes embed the material code, e.g.
            // "C.165*0.12.01.00.0961X*2026-9-3*300*P001A2*R005" — substring match
            // on any field covers label formats and plain codes alike.
            (l.materialCode.isNotBlank() && qr.contains(l.materialCode.uppercase())) ||
                (l.lotNo.isNotBlank() && (qr.contains(l.lotNo.uppercase()) || l.lotNo.uppercase().contains(qr))) ||
                (l.materialSn.isNotBlank() && norm(l.materialSn) == qrN) ||
                (l.locationQr.isNotBlank() && norm(l.locationQr) == qrN) ||
                (l.locationCode.isNotBlank() && norm(l.locationCode) == qrN)
        }
        if (match == null) {
            // Alarm: the scanned box material is NOT on this collect list.
            _state.value = current.copy(
                error = null,
                alarm = "⚠ 报警：料号 ${qrN} 不在本领料单中！\n请核对料箱是否属于本工单。",
                highlightLineId = null
            )
            return
        }
        _state.value = current.copy(
            error = null,
            alarm = null,
            message = "已定位：${match.materialCode}${if (match.processDomain == "MANUAL") "（插料）" else ""} — ${match.materialName.takeIf { it.isNotBlank() } ?: ""}",
            highlightLineId = match.id
        )
    }

    fun dismissAlarm() {
        _state.value = _state.value.copy(alarm = null)
    }

    private fun normalizeLoc(value: String): String =
        value.uppercase().replace(Regex("^WMS-(LOC|AREA):"), "").replace(Regex("[\\s\\-_]"), "")

    private fun parseError(body: String?): String {
        if (body.isNullOrBlank()) return "Server error"
        return try {
            val obj = com.google.gson.JsonParser.parseString(body).asJsonObject
            if (obj.has("error")) {
                val e = obj.getAsJsonObject("error")
                e.text("message").ifBlank { e.text("code") }
            } else obj.text("message")
        } catch (_: Exception) { body }
    }
}
