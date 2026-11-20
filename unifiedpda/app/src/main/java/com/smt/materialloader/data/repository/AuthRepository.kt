package com.smt.materialloader.data.repository

import com.smt.materialloader.data.api.RetrofitClient
import com.smt.materialloader.data.api.dto.*
import com.smt.materialloader.util.PreferencesManager
import com.google.gson.Gson

class AuthRepository(
    private val prefs: PreferencesManager
) {
    private val api get() = RetrofitClient.getApiService()

    suspend fun login(username: String, password: String): Result<LoginResponse> {
        return try {
            val response = api.login(LoginRequest(username, password))
            if (response.isSuccessful) {
                val envelope = response.body()
                val data = envelope?.data
                if (data != null) {
                    val issuedUser = data.roleDefinition?.let { data.user.copy(roleDefinition = it) } ?: data.user
                    prefs.saveJwtToken(data.token)
                    prefs.saveUser(issuedUser)
                    // MES is the authority for line scope; the PDA never lets a user switch it locally.
                    issuedUser.lineCode?.takeIf { it.isNotBlank() }?.let { prefs.saveLineCode(it) }
                    prefs.saveLocale(issuedUser.locale)
                    data.expiresAt.takeIf { it.isNotBlank() }?.let { prefs.saveSessionExpiry(it) }
                    Result.success(data.copy(user = issuedUser))
                } else {
                    Result.failure(Exception(envelope?.error?.message ?: "Login failed"))
                }
            } else {
                val msg = parseErrorMessage(response)
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    /**
     * Re-reads the MES session so the cached role, scope, permissions and expiry
     * track the authority instead of a login-time snapshot. Call on app start and
     * before privileged actions.
     */
    suspend fun restoreSession(): Result<UserInfo> {
        val token = prefs.getJwtToken() ?: return Result.failure(Exception("No token"))
        return try {
            val response = api.getSession()
            if (!response.isSuccessful) {
                prefs.clearSession()
                return Result.failure(Exception("Session expired (${response.code()})"))
            }
            val payload = response.body()?.data
            val session = payload?.session
            if (session == null) {
                return Result.success(prefs.getUser() ?: error("No cached user"))
            }
            val cached = prefs.getUser()
            val refreshed = UserInfo(
                id = session.userId,
                username = session.username,
                displayName = session.displayName,
                locale = session.locale,
                roleKey = session.roleKey,
                permissions = payload.permissions.ifEmpty { cached?.permissions.orEmpty() },
                lineCode = cached?.lineCode,
                roleDefinition = payload.roleDefinition ?: session.roleDefinition ?: cached?.roleDefinition,
                seniority = cached?.seniority
            )
            prefs.saveUser(refreshed)
            session.expiresAt.takeIf { it.isNotBlank() }?.let { prefs.saveSessionExpiry(it) }
            Result.success(refreshed)
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    /** Local guard for privileged actions; MES still re-checks every write. */
    fun hasUsableSession(): Boolean = prefs.hasToken() && !prefs.isSessionExpired()

    fun getCurrentUser(): UserInfo? = prefs.getUser()

    fun isLoggedIn(): Boolean = prefs.hasToken()

    fun logout() {
        prefs.clearSession()
    }

    private fun parseErrorMessage(response: retrofit2.Response<*>): String {
        return try {
            val errorBody = response.errorBody()?.string()
            if (errorBody != null) {
                val error = Gson().fromJson(errorBody, ApiEnvelope::class.java)
                error.error?.message ?: "Unknown error"
            } else {
                "Error ${response.code()}"
            }
        } catch (e: Exception) {
            "Error ${response.code()}"
        }
    }
}
