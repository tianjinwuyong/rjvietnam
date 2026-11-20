package com.smt.materialloader.util

import android.content.Context
import android.content.SharedPreferences
import com.smt.materialloader.data.api.dto.UserInfo
import com.google.gson.Gson

class PreferencesManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val gson = Gson()

    fun saveJwtToken(token: String) {
        prefs.edit().putString(KEY_JWT, token).apply()
    }

    fun getJwtToken(): String? = prefs.getString(KEY_JWT, null)

    fun clearToken() {
        prefs.edit().remove(KEY_JWT).apply()
    }

    fun saveLocale(locale: String) {
        prefs.edit().putString(KEY_LOCALE, locale).apply()
    }

    fun getLocale(): String = prefs.getString(KEY_LOCALE, "zh-CN") ?: "zh-CN"

    fun saveLineCode(lineCode: String) {
        prefs.edit().putString(KEY_LINE_CODE, lineCode).apply()
    }

    fun getLineCode(): String = prefs.getString(KEY_LINE_CODE, "L001") ?: "L001"

    fun saveSiteCode(siteCode: String) {
        prefs.edit().putString(KEY_SITE_CODE, siteCode.trim()).apply()
    }

    fun getSiteCode(): String = prefs.getString(KEY_SITE_CODE, "VN-RJ") ?: "VN-RJ"

    fun saveUser(user: UserInfo) {
        prefs.edit().putString(KEY_USER, gson.toJson(user)).apply()
    }

    fun getUser(): UserInfo? {
        val json = prefs.getString(KEY_USER, null) ?: return null
        return try {
            gson.fromJson(json, UserInfo::class.java)
        } catch (e: Exception) {
            null
        }
    }

    fun clearSession() {
        prefs.edit()
            .remove(KEY_JWT)
            .remove(KEY_USER)
            .remove(KEY_SESSION_EXPIRES_AT)
            .remove(KEY_LINE_CODE)
            .remove(KEY_SITE_CODE)
            .apply()
    }
    fun saveSessionExpiry(expiresAt: String) {
        prefs.edit().putString(KEY_SESSION_EXPIRES_AT, expiresAt).apply()
    }

    fun getSessionExpiry(): String? = prefs.getString(KEY_SESSION_EXPIRES_AT, null)

    /** True when MES issued an expiry that is already in the past. */
    fun isSessionExpired(now: Long = System.currentTimeMillis()): Boolean {
        val raw = getSessionExpiry() ?: return false
        val parsed = runCatching {
            java.time.Instant.parse(raw).toEpochMilli()
        }.recoverCatching {
            java.time.OffsetDateTime.parse(raw).toInstant().toEpochMilli()
        }.recoverCatching {
            java.time.LocalDateTime.parse(raw).atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
        }.getOrNull() ?: return false
        return parsed <= now
    }

    fun hasToken(): Boolean = getJwtToken() != null

    companion object {
        private const val PREFS_NAME = "material_loader_prefs"
        private const val KEY_SESSION_EXPIRES_AT = "session_expires_at"
        private const val KEY_JWT = "jwt_token"
        private const val KEY_LOCALE = "locale"
        private const val KEY_LINE_CODE = "line_code"
        private const val KEY_SITE_CODE = "site_code"
        private const val KEY_USER = "user_info"
    }
}
