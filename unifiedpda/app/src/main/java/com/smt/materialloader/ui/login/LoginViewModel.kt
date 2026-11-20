package com.smt.materialloader.ui.login

import android.app.Activity
import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.BuildConfig
import com.smt.materialloader.data.repository.AuthRepository
import com.smt.materialloader.alarm.ManagerAlarmService
import com.smt.materialloader.util.LocaleManager
import com.smt.materialloader.util.PreferencesManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LoginUiState(
    val username: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val selectedLocale: String = "zh-CN",
    val isSuccess: Boolean = false
)

class LoginViewModel : ViewModel() {

    private val prefs: PreferencesManager = MaterialLoaderApp.instance.prefs
    private val authRepo: AuthRepository = MaterialLoaderApp.instance.authRepository

    private val _state = MutableStateFlow(
        LoginUiState(selectedLocale = prefs.getLocale())
    )
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onUsernameChanged(value: String) {
        _state.value = _state.value.copy(username = value, error = null)
    }

    fun onPasswordChanged(value: String) {
        _state.value = _state.value.copy(password = value, error = null)
    }

    fun onLocaleChanged(locale: String) {
        _state.value = _state.value.copy(selectedLocale = locale)
        prefs.saveLocale(locale)
        // Restart activity to apply new locale immediately
        val activity = MaterialLoaderApp.instance.currentActivity
        if (activity != null) {
            LocaleManager.applyLocale(activity, locale)
            activity.recreate()
        }
    }

    /** Virtual employees are unavailable in production builds by construction. */
    val demoAccounts: List<DemoAccount> = when {
        !BuildConfig.TEST_ACTION_BYPASS_ENABLED -> emptyList()
        BuildConfig.PLANT_MANAGER_APP -> VirtualEmployeeCatalog.seniorManagers
        // The full Unified Management PDA exposes the complete local role
        // catalog, including plant-manager identities, so one APK can be
        // used for receiving, IQC, warehouse, MES, PMC, production,
        // engineering, line leadership, and approvals.
        else -> VirtualEmployeeCatalog.standard + VirtualEmployeeCatalog.seniorManagers + VirtualEmployeeCatalog.plantManager
    }

    fun login() {
        val s = _state.value
        if (s.username.isBlank() || s.password.isBlank()) {
            _state.value = s.copy(error = "Please fill in all fields")
            return
        }

        _state.value = s.copy(isLoading = true, error = null)

        viewModelScope.launch {
            val result = authRepo.login(s.username, s.password)
            result.fold(
                onSuccess = {
                    ManagerAlarmService.start(MaterialLoaderApp.instance)
                    _state.value = _state.value.copy(isLoading = false, isSuccess = true)
                },
                onFailure = { error ->
                    _state.value = _state.value.copy(
                        isLoading = false,
                        error = error.message ?: "Login failed"
                    )
                }
            )
        }
    }

    fun quickLogin(account: DemoAccount) {
        _state.value = _state.value.copy(
            username = account.username,
            password = account.password,
            isLoading = true,
            error = null
        )

        // Every catalog identity must authenticate through MES. A failed login is
        // reported as an error; the PDA never reuses another employee's session or
        // fabricates a role snapshot, because that would grant authority locally.
        viewModelScope.launch {
            val real = authRepo.login(account.username, account.password)
            if (real.isSuccess) {
                prefs.saveLocale(real.getOrNull()?.user?.locale ?: prefs.getLocale())
                ManagerAlarmService.start(MaterialLoaderApp.instance)
                _state.value = _state.value.copy(isLoading = false, isSuccess = true)
            } else {
                _state.value = _state.value.copy(
                    isLoading = false,
                    error = real.exceptionOrNull()?.message ?: "MES rejected the test identity"
                )
            }
        }
    }
}
