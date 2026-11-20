package com.smt.materialloader.data.api

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Selects the factory WMS endpoint before a business request is sent.
 * Failover chain: 155 (primary) → 122 (secondary) → 234 (tertiary).
 *
 * GET requests cascade through the chain on failure.
 * Non-idempotent requests (POST/PUT/DELETE) are NOT replayed — ambiguous
 * timeouts must be reconciled by MES, not duplicated through fallback.
 */
class EndpointFailoverInterceptor(
    primaryUrl: String,
    secondaryUrl: String,
    tertiaryUrl: String
) : Interceptor {
    private val primary = primaryUrl.toHttpUrl()
    private val secondary = secondaryUrl.toHttpUrl()
    private val tertiary = tertiaryUrl.toHttpUrl()

    private val probeClient = OkHttpClient.Builder()
        .connectTimeout(1500, TimeUnit.MILLISECONDS)
        .readTimeout(1500, TimeUnit.MILLISECONDS)
        .callTimeout(2500, TimeUnit.MILLISECONDS)
        .build()

    @Volatile private var selected: HttpUrl = primary
    @Volatile private var selectedAt: Long = 0L

    /** Returns the route label for a given endpoint. */
    private fun routeLabel(url: HttpUrl) = when (url) {
        primary -> "FACTORY_155_PRIMARY"
        secondary -> "FACTORY_122_SECONDARY"
        tertiary -> "FACTORY_234_TERTIARY"
        else -> "FACTORY_UNKNOWN"
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val base = selectEndpoint()
        val routed = original.newBuilder()
            .url(rewrite(original.url, base))
            .removeHeader("X-PDA-WMS-OCR")
            .header("X-PDA-Route", routeLabel(base))
            .apply {
                if (original.method !in setOf("GET", "HEAD", "OPTIONS")) {
                    header("X-Request-ID", original.header("X-Request-ID") ?: UUID.randomUUID().toString())
                }
            }
            .build()

        // Try endpoints in order; only GET requests cascade on failure.
        return tryEndpoint(chain, routed, base, listOf(secondary, tertiary).filter { healthy(it) })
    }

    /**
     * Recursively tries endpoints, cascading through the chain for GET requests.
     * Stops at first successful response or exhausts all candidates.
     */
    private fun tryEndpoint(
        chain: Interceptor.Chain,
        request: Request,
        currentBase: HttpUrl,
        remaining: List<HttpUrl>
    ): Response {
        val response = chain.proceed(request)
        if (response.isSuccessful || request.method != "GET" || remaining.isEmpty()) {
            return response
        }
        // GET failed and we have a next candidate — cascade.
        response.close()
        val nextBase = remaining.first()
        val next = request.newBuilder()
            .url(rewrite(request.url, nextBase))
            .header("X-PDA-Route", routeLabel(nextBase))
            .build()
        return tryEndpoint(chain, next, nextBase, remaining.drop(1))
    }

    @Synchronized
    private fun selectEndpoint(): HttpUrl {
        val now = System.currentTimeMillis()
        if (now - selectedAt < 15_000) return selected
        selected = when {
            healthy(primary) -> primary
            healthy(secondary) -> secondary
            healthy(tertiary) -> tertiary
            else -> primary
        }
        selectedAt = now
        return selected
    }

    private fun healthy(base: HttpUrl): Boolean = runCatching {
        val health = base.resolve("health") ?: return false
        probeClient.newCall(Request.Builder().url(health).get().build()).execute().use {
            it.isSuccessful
        }
    }.getOrDefault(false)

    private fun rewrite(original: HttpUrl, base: HttpUrl): HttpUrl {
        val relativePath = original.encodedPath.removePrefix("/")
        val target = base.resolve(relativePath) ?: base
        return target.newBuilder().encodedQuery(original.encodedQuery).build()
    }
}
