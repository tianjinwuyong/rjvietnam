package com.smt.materialloader.alarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.smt.materialloader.MainActivity
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.R
import com.smt.materialloader.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import java.util.Collections

/**
 * Page-independent manager alarm channel. It reports facts from MES only; it
 * never acknowledges, reroutes, or changes an NG decision locally.
 */
class ManagerAlarmService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null
    private val seen = Collections.synchronizedSet(mutableSetOf<String>())
    private val active = Collections.synchronizedSet(mutableSetOf<String>())
    private val lastRangAt = Collections.synchronizedMap(mutableMapOf<String, Long>())
    private lateinit var notifications: NotificationManager

    override fun onCreate() {
        super.onCreate()
        notifications = getSystemService(NotificationManager::class.java)
        loadPersistedAlarmIds()
        createChannel()
        startForeground(FOREGROUND_ID, foregroundNotification())
        pollJob = scope.launch { pollLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_TEST_ALARM && BuildConfig.TEST_ACTION_BYPASS_ENABLED) {
            val test = JsonObject().apply {
                addProperty("sourceStation", "manu_depanel")
                addProperty("quantity", 3)
                addProperty("sns", "TEST-SN-001,TEST-SN-002,TEST-SN-003")
            }
            notifyAlarm(test, "TEST-NG-${System.currentTimeMillis()}")
        }
        if (pollJob?.isActive != true) pollJob = scope.launch { pollLoop() }
        return START_STICKY
    }

    private suspend fun pollLoop() {
        while (scope.isActive) {
            runCatching { pollOnce() }
            delay(POLL_MS)
        }
    }

    private suspend fun pollOnce() {
        val app = MaterialLoaderApp.instance
        // The legacy manager-alert route is not part of the unified WMS
        // receiving test flow and returns 404 on the current API.
        if (BuildConfig.TEST_ACTION_BYPASS_ENABLED) return
        if (!app.prefs.hasToken()) return
        val line = app.prefs.getLineCode().ifBlank { "L004" }
        val response = app.apiService.managerAlerts(line, "open")
        if (!response.isSuccessful) return
        val body = response.body() ?: return
        val items = sequenceOf("data", "items", "alerts")
            .mapNotNull { body.get(it) }
            .flatMap { if (it.isJsonArray) it.asJsonArray.asSequence() else sequenceOf(it) }
            .toList()
        val currentIds = mutableSetOf<String>()
        items.forEach { element ->
            if (!element.isJsonObject) return@forEach
            val item = element.asJsonObject
            val eventId = first(item, "eventId", "id", "alertId") ?: return@forEach
            currentIds += eventId
            if (seen.add(eventId)) {
                notifyAlarm(item, eventId)
            } else if (active.contains(eventId) &&
                System.currentTimeMillis() - (lastRangAt[eventId] ?: 0L) >= REMINDER_MS
            ) {
                lastRangAt[eventId] = System.currentTimeMillis()
                playPattern()
            }
        }
        // The open-alert response is authoritative. A notification is removed
        // only after MES no longer returns that event as open/active.
        (active - currentIds).forEach { id ->
            notifications.cancel(id.hashCode())
            active.remove(id)
            seen.remove(id)
            lastRangAt.remove(id)
        }
        persistAlarmIds()
    }

    private fun notifyAlarm(item: JsonObject, eventId: String) {
        val source = first(item, "sourceStation", "station", "source") ?: "MES"
        val quantity = first(item, "quantity", "ngQuantity", "count") ?: "?"
        val sns = first(item, "sns", "snSet", "sn") ?: "待扫码确认"
        val number = first(item, "number", "ngNumber", "shipmentNumber") ?: quantity
        val boxQr = first(item, "boxQr", "bucketQr", "bucketQR", "containerQr") ?: "待绑定"
        val text = "来源 $source · 编号 $number · 数量 $quantity · 箱 QR $boxQr · SN $sns"
        val open = PendingIntent.getActivity(
            this, eventId.hashCode(), Intent(this, AlarmPopupActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("alarmEventId", eventId)
                putExtra("eventId", eventId)
                putExtra("details", text)
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("MES NG 告警 · 组长确认")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$text\n事件 $eventId\n请打开 PDA，在 MES 中确认并处理。"))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(false)
            .setOngoing(true)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .build()
        notifications.notify(eventId.hashCode(), notification)
        active.add(eventId)
        lastRangAt[eventId] = System.currentTimeMillis()
        persistAlarmIds()
        playPattern()
    }

    private fun playPattern() {
        scope.launch(Dispatchers.Main.immediate) {
            val tone = ToneGenerator(AudioManager.STREAM_ALARM, 100)
            try {
                repeat(3) {
                    tone.startTone(ToneGenerator.TONE_PROP_BEEP, 180)
                    delay(180)
                }
                delay(220)
                tone.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 700)
                val vibrator = getSystemService(Vibrator::class.java)
                if (Build.VERSION.SDK_INT >= 26) {
                    vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 180, 180, 180, 180, 180, 220, 700), -1))
                } else {
                    @Suppress("DEPRECATION") vibrator?.vibrate(longArrayOf(0, 180, 180, 180, 180, 180, 220, 700), -1)
                }
                delay(800)
            } finally {
                tone.release()
            }
        }
    }

    private fun foregroundNotification(): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_popup_sync)
        .setContentTitle("MES 线长告警服务")
        .setContentText("后台监听中；新 NG/取料告警会响铃")
        .setOngoing(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .build()

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            notifications.createNotificationChannel(NotificationChannel(CHANNEL_ID, "MES 线长告警", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "NG 取料和维修闭环告警"
                enableVibration(true)
                setSound(null, null) // custom pattern is generated by the service
            })
        }
    }

    private fun first(obj: JsonObject, vararg names: String): String? = names.asSequence()
        .mapNotNull { obj.get(it) }
        .mapNotNull { elementValue(it) }
        .firstOrNull()

    private fun elementValue(element: JsonElement): String? = when {
        element.isJsonNull -> null
        element.isJsonPrimitive -> element.asJsonPrimitive.toString().trim('"')
        element.isJsonArray -> element.asJsonArray.joinToString(",") { it.toString().trim('"') }
        else -> element.toString()
    }

    override fun onDestroy() {
        pollJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private fun loadPersistedAlarmIds() {
        val raw = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_ACTIVE, "") ?: ""
        active.addAll(raw.split('|').filter { it.isNotBlank() })
        seen.addAll(active)
    }

    private fun persistAlarmIds() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(KEY_ACTIVE, active.joinToString("|"))
            .apply()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "mes_manager_alarm_v2"
        private const val FOREGROUND_ID = 4101
        private const val POLL_MS = 10_000L
        private const val REMINDER_MS = 30 * 60 * 1000L
        private const val PREFS = "manager_alarm_service"
        private const val KEY_ACTIVE = "active_mes_event_ids"
        const val ACTION_TEST_ALARM = "com.ruijing.linemanager.action.TEST_ALARM"

        fun start(context: Context) {
            val intent = Intent(context, ManagerAlarmService::class.java)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }
    }
}
