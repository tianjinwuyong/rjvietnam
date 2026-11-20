package com.smt.materialloader.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.smt.materialloader.MaterialLoaderApp

/** Starts background MES alarms only after a valid MES session exists. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val app = context.applicationContext as? MaterialLoaderApp ?: return
        if (app.prefs.hasToken()) ManagerAlarmService.start(app)
    }
}
