package com.smt.materialloader.alarm

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.smt.materialloader.MainActivity

/** Full-screen alarm; local acknowledgement only hides this popup. */
class AlarmPopupActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val eventId = intent.getStringExtra("eventId") ?: "-"
        val details = intent.getStringExtra("details") ?: "MES NG alarm"
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 42, 48, 42)
            setBackgroundColor(0xFF7F1D1D.toInt())
        }
        root.addView(TextView(this).apply {
            text = "MES NG ALARM"
            textSize = 26f
            setTextColor(0xFFFFFFFF.toInt())
        })
        root.addView(TextView(this).apply {
            text = "$details\nEvent: $eventId"
            textSize = 18f
            setTextColor(0xFFFFE4E6.toInt())
            setPadding(0, 28, 0, 28)
        })
        root.addView(Button(this).apply {
            text = "ACKNOWLEDGE (alarm remains)"
            setOnClickListener { finish() }
        })
        root.addView(Button(this).apply {
            text = "OPEN PDA"
            setOnClickListener {
                startActivity(Intent(this@AlarmPopupActivity, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra("alarmEventId", eventId)
                })
                finish()
            }
        })
        setContentView(root)
    }
}
