package com.smt.materialloader.data.api

import com.smt.materialloader.BuildConfig
import com.smt.materialloader.util.PreferencesManager
import okhttp3.Interceptor
import okhttp3.Response

class AuthInterceptor(
    private val prefs: PreferencesManager
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()

        // Skip auth header for login
        if (original.url.encodedPath.contains("/auth/login")) {
            return chain.proceed(original)
        }

        val builder = original.newBuilder()
        if (BuildConfig.TEST_ACTION_BYPASS_ENABLED) {
            builder.header("X-PDA-Test-Mode", "1")
        }
        val token = prefs.getJwtToken()
        if (token != null) {
            builder.header("Authorization", "Bearer $token")
        }
        val response = chain.proceed(builder.build())
        // MES is the authority: an expired/revoked token invalidates the cached
        // role snapshot immediately instead of leaving stale rights in force.
        if (response.code == 401) {
            prefs.clearSession()
        }
        return response
    }
}
