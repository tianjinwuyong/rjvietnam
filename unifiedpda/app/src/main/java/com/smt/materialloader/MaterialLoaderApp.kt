package com.smt.materialloader

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.smt.materialloader.data.api.ApiService
import com.smt.materialloader.data.api.RetrofitClient
import com.smt.materialloader.data.repository.AuthRepository
import com.smt.materialloader.data.repository.MaterialRepository
import com.smt.materialloader.data.repository.ShelfRepository
import com.smt.materialloader.data.repository.WorkOrderRepository
import com.smt.materialloader.util.PreferencesManager

class MaterialLoaderApp : Application() {

    lateinit var prefs: PreferencesManager
        private set
    lateinit var authRepository: AuthRepository
        private set
    lateinit var materialRepository: MaterialRepository
        private set
    lateinit var workOrderRepository: WorkOrderRepository
        private set
    lateinit var shelfRepository: ShelfRepository
        private set
    lateinit var apiService: ApiService
        private set

    var currentActivity: Activity? = null
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        prefs = PreferencesManager(this)
        RetrofitClient.initialize(prefs)

        authRepository = AuthRepository(prefs)
        materialRepository = MaterialRepository()
        workOrderRepository = WorkOrderRepository()
        shelfRepository = ShelfRepository()
        apiService = RetrofitClient.getApiService()

        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
                currentActivity = activity
            }
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityResumed(activity: Activity) {
                currentActivity = activity
            }
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {
                if (currentActivity == activity) {
                    currentActivity = null
                }
            }
        })
    }

    companion object {
        lateinit var instance: MaterialLoaderApp
            private set
    }
}
