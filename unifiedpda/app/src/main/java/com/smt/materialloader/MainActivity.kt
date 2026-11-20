package com.smt.materialloader

import android.content.Context
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.smt.materialloader.ui.navigation.AppNavHost
import com.smt.materialloader.ui.theme.MaterialLoaderTheme
import com.smt.materialloader.util.LocaleManager
import com.smt.materialloader.alarm.ManagerAlarmService
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val keyBuffer = StringBuilder()

    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        // Only intercept when a scanner callback is armed (scan-gun mode on the
        // receiving screen) and the key event is a hardware KEY_EVENT from the
        // embedded scanner — collect printable chars and submit on Enter.
        val cb = scannerResultCallback
        if (cb != null && event.action == android.view.KeyEvent.ACTION_DOWN) {
            val code = event.keyCode
            if (code == android.view.KeyEvent.KEYCODE_ENTER || code == android.view.KeyEvent.KEYCODE_NUMPAD_ENTER) {
                val data = keyBuffer.toString().trim()
                keyBuffer.clear()
                if (data.isNotEmpty()) { if (cb(data)) return true }
            } else {
                val ch = event.unicodeChar
                if (ch in 0x20..0x7E || ch in 0x4E00..0x9FFF) {
                    if (ch.toChar().isLetterOrDigit() || ch.toChar() in "-_*.:".toSet() || ch.toChar().isWhitespace()) {
                        keyBuffer.append(ch.toChar())
                    }
                    // Consume printable scanner chars so they don't leak into UI.
                    if (ch != 0) return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun attachBaseContext(newBase: Context) {
        val locale = MaterialLoaderApp.instance.prefs.getLocale()
        super.attachBaseContext(LocaleManager.applyLocale(newBase, locale))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.TEST_ACTION_BYPASS_ENABLED && intent.getBooleanExtra("testAlarm", false)) {
            ManagerAlarmService.start(this)
            startService(Intent(this, ManagerAlarmService::class.java).apply {
                action = ManagerAlarmService.ACTION_TEST_ALARM
            })
            // Debug-only visual verification. Production alarms still arrive through
            // the service notification/full-screen intent and remain MES-controlled.
            startActivity(Intent(this, com.smt.materialloader.alarm.AlarmPopupActivity::class.java).apply {
                putExtra("eventId", "TEST-NG-DETAIL-001")
                putExtra(
                    "details",
                    "SOURCE manu_depanel / NUMBER 3 / QUANTITY 3 / BOX QR TEST-BOX-QR / " +
                        "SN TEST-SN-001,TEST-SN-002,TEST-SN-003"
                )
            })
        }
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
        }
        enableEdgeToEdge()
        setContent {
                MaterialLoaderTheme {
                Surface(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                    AppNavHost()
                }
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (isActive) {
                    reportHeartbeat()
                    delay(15_000)
                }
            }
        }
    }

    companion object {
        private const val NOTIFICATION_PERMISSION_REQUEST = 7401
        // Injected by the receiving screen to receive a completed barcode read from
        // the embedded scanner when it operates in key-event (KEY_EVENT) mode.
        var scannerResultCallback: ((String) -> Boolean)? = null
    }

    private suspend fun reportHeartbeat() {
        runCatching {
            val user = MaterialLoaderApp.instance.authRepository.getCurrentUser()
            MaterialLoaderApp.instance.apiService.stationHeartbeat(
                stationCode = "smt_pda_loading",
                body = mapOf(
                    "operator" to (user?.username ?: "UNAUTHENTICATED"),
                    "lineCode" to MaterialLoaderApp.instance.prefs.getLineCode(),
                    "deviceId" to android.provider.Settings.Secure.getString(
                        contentResolver,
                        android.provider.Settings.Secure.ANDROID_ID
                    ),
                    "appVersion" to BuildConfig.VERSION_NAME,
                    "status" to if (user == null) "READY" else "WORKING"
                )
            )
        }
    }
}
