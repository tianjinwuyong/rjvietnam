package com.smt.materialloader.ui.manager

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import android.media.AudioManager
import android.media.ToneGenerator
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.BuildConfig
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class ManagerAlert(val eventId: String, val title: String, val detail: String, val severity: String)

data class ManagerCockpitState(
    val loading: Boolean = true,
    val mesOnline: Boolean = false,
    val manualPdasOnline: Int = 0,
    val openViolations: Int = 0,
    val alerts: List<ManagerAlert> = emptyList(),
    val lastUpdated: String = "",
    val error: String? = null
    ,val actionMessage: String? = null
)

class ManagerCockpitViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService
    private val seenPickupEvents = mutableSetOf<String>()
    private val seenAlarmEvents = mutableSetOf<String>()
    private val _state = MutableStateFlow(ManagerCockpitState())
    val state: StateFlow<ManagerCockpitState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            while (isActive) {
                refresh()
                delay(10_000)
            }
        }
    }

    fun refreshNow() {
        viewModelScope.launch { refresh() }
    }

    private suspend fun refresh() {
        try {
            val heartbeat = api.pdaHeartbeats()
            val violations = api.smtLoadingOfflineViolations("OPEN")
            val lineCode = MaterialLoaderApp.instance.prefs.getLineCode().ifBlank { "L004" }
            val managerAlertResponse = runCatching { api.managerAlerts(lineCode, "open") }.getOrNull()
            val hb = heartbeat.body()
            val open = violations.body()
            val heartbeatRows = hb?.getAsJsonArray("heartbeats")?.filter { row ->
                val station = row.asJsonObject["stationCode"]?.asString.orEmpty().lowercase()
                station.contains("manu") || row.asJsonObject["lineCode"]?.asString.equals("L004", true)
            } ?: emptyList()
            val violationRows = open?.getAsJsonArray("data") ?: emptyList()
            val alerts = violationRows.take(5).map { row ->
                val obj = row.asJsonObject
                ManagerAlert(
                    eventId = obj["eventId"]?.asString ?: obj["id"]?.asString ?: obj["work_order_code"]?.asString.orEmpty(),
                    title = "Loading violation",
                    detail = "WO ${obj["work_order_code"]?.asString ?: "—"} · ${obj["material_code"]?.asString ?: "material"}",
                    severity = "CRITICAL"
                )
            }
            val pickupAlerts = managerAlertRows(managerAlertResponse?.body())
            pickupAlerts.filter { seenPickupEvents.add(it.first) }.forEach { alarmTone() }
            violationRows.mapNotNull { row ->
                val obj = row.asJsonObject
                obj["eventId"]?.asString ?: obj["id"]?.asString
                    ?: obj["work_order_code"]?.asString
            }.filter { seenAlarmEvents.add("LOADING:$it") }.forEach { alarmTone() }
            _state.value = ManagerCockpitState(
                loading = false,
                mesOnline = heartbeat.isSuccessful && violations.isSuccessful,
                manualPdasOnline = heartbeatRows.count { it.asJsonObject["online"]?.asBoolean != false },
                openViolations = violationRows.count(),
                alerts = (pickupAlerts.map { (eventId, detail) ->
                    ManagerAlert(eventId, "REPAIRED NG READY · GO TO REPAIR STATION / 已修复NG待取", detail, "CRITICAL")
                } + alerts).take(10),
                lastUpdated = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())
            )
        } catch (e: Exception) {
            _state.value = _state.value.copy(loading = false, mesOnline = false, error = e.message)
        }
    }

    /** Group-leader receipt is a MES command: the scan is evidence, not a local release. */
    fun acknowledgeScanned(alert: ManagerAlert, scanValue: String) {
        viewModelScope.launch {
            val user = MaterialLoaderApp.instance.authRepository.getCurrentUser()
            val response = runCatching {
                api.managerAcknowledgeAlert(alert.eventId, mapOf(
                    "action" to "RECEIVE_NG_SHIPMENT",
                    "scanValue" to scanValue,
                    "eventId" to alert.eventId,
                    "actor" to (user?.username ?: "UNAUTHENTICATED"),
                    "role" to "GROUP_LEADER",
                    "source" to "GROUP_LEADER_PDA_CAMERA"
                ))
            }.getOrNull()
            _state.value = _state.value.copy(
                actionMessage = if (response?.isSuccessful == true)
                    "MES 已确认接收：${alert.eventId}"
                else
                    "MES 未确认（HTTP ${response?.code() ?: "OFFLINE"}），保持 NG 待处理"
            )
            if (response?.isSuccessful == true) refresh()
        }
    }

    fun clearActionMessage() { _state.value = _state.value.copy(actionMessage = null) }

    /** Extracts MES-owned pickup alerts; quantity and repair-station recheck are mandatory. */
    private fun managerAlertRows(body: JsonObject?): List<Pair<String, String>> {
        val rows = body?.getAsJsonArray("data") ?: body?.getAsJsonArray("items") ?: return emptyList()
        return rows.mapNotNull { element ->
            val obj = element.asJsonObject
            val payload = obj.getAsJsonObject("payload")
            val type = obj["type"]?.asString ?: payload?.get("type")?.asString
            if (type != "MAINTENANCE_PICKUP_READY") return@mapNotNull null
            val eventId = obj["eventId"]?.asString ?: payload?.get("eventId")?.asString ?: return@mapNotNull null
            val wo = obj["workOrderNo"]?.asString ?: payload?.get("workOrderNo")?.asString ?: "-"
            val sn = obj["sn"]?.asString ?: payload?.get("sn")?.asString ?: "-"
            val sourceStation = obj["sourceStation"]?.asString ?: payload?.get("sourceStation")?.asString
                ?: obj["stationCode"]?.asString ?: payload?.get("stationCode")?.asString ?: "-"
            val sns = (obj["sns"] ?: payload?.get("sns"))?.takeIf { it.isJsonArray }?.asJsonArray
                ?.mapNotNull { it.asString?.takeIf(String::isNotBlank) }
                ?: listOf(sn).filter { it != "-" }
            val station = obj["repairStation"]?.asString ?: payload?.get("repairStation")?.asString ?: "manu_rework"
            val quantity = obj["quantity"]?.asString ?: payload?.get("quantity")?.asString
                ?: obj["shipmentQuantity"]?.asString ?: payload?.get("shipmentQuantity")?.asString
                ?: obj["qty"]?.asString ?: payload?.get("qty")?.asString
            val number = obj["number"]?.asString ?: payload?.get("number")?.asString
                ?: obj["ngNumber"]?.asString ?: payload?.get("ngNumber")?.asString ?: quantity ?: "-"
            val boxQr = obj["boxQr"]?.asString ?: payload?.get("boxQr")?.asString
                ?: obj["bucketQr"]?.asString ?: payload?.get("bucketQr")?.asString ?: "-"
            val sendMode = obj["sendMode"]?.asString ?: payload?.get("sendMode")?.asString
                ?: obj["dispatchMode"]?.asString ?: payload?.get("dispatchMode")?.asString ?: "UNSPECIFIED"
            val ruleVersion = obj["routingRuleVersion"]?.asString ?: payload?.get("routingRuleVersion")?.asString ?: "-"
            val trigger = obj["triggerReason"]?.asString ?: payload?.get("triggerReason")?.asString ?: "MES_RULE"
            val status = obj["status"]?.asString ?: payload?.get("status")?.asString
                ?: obj["repairStatus"]?.asString ?: payload?.get("repairStatus")?.asString ?: "PENDING_PICKUP"
            val qtyLabel = quantity?.takeIf { it.isNotBlank() }?.let { "QTY $it" } ?: "QTY MISSING — MES MUST ASSIGN"
            val sendLabel = if (sendMode.equals("AUTO", true)) "MES RULE AUTO SEND" else "AUTHORIZED $sendMode SEND"
            val snLabel = if (sns.isEmpty()) "SN LIST MISSING" else "SN LIST ${sns.joinToString(", ")}"
            if (sns.isNotEmpty()) {
                return@mapNotNull eventId to "SOURCE $sourceStation / NUMBER $number / NG COUNT ${sns.size} / QUANTITY $quantity / BOX QR $boxQr / $snLabel\nWO $wo / STATUS $status / $sendLabel / RULE $ruleVersion / TRIGGER $trigger / DESTINATION $station\nBIND AT MES SEND: GO TO THE $station BUCKET, SCAN ITS QR, RECEIVE, AND RECHECK AT THE REPAIR STATION BEFORE HANDOVER"
            }
            eventId to "WO $wo · STATUS $status · SN $sn · $qtyLabel · $sendLabel · RULE $ruleVersion · TRIGGER $trigger · DESTINATION $station\nBIND AT MES SEND: GO TO THE $station BUCKET, SCAN ITS QR, RECEIVE, AND RECHECK AT THE REPAIR STATION BEFORE HANDOVER"
        }
    }

    private fun alarmTone() {
        viewModelScope.launch {
            runCatching {
                val tone = ToneGenerator(AudioManager.STREAM_ALARM, 100)
                repeat(3) {
                    tone.startTone(ToneGenerator.TONE_PROP_BEEP, 180)
                    delay(180)
                }
                delay(220)
                tone.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 700)
                delay(700)
                tone.release()
            }
        }
    }
}
