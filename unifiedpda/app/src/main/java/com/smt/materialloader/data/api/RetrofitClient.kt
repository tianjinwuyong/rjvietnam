package com.smt.materialloader.data.api

import com.smt.materialloader.BuildConfig
import com.smt.materialloader.util.PreferencesManager
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {

    private var apiService: ApiService? = null

    fun initialize(prefs: PreferencesManager) {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG)
                HttpLoggingInterceptor.Level.BODY
            else
                HttpLoggingInterceptor.Level.NONE
        }

        val client = OkHttpClient.Builder()
            .addInterceptor(EndpointFailoverInterceptor(
                BuildConfig.PRIMARY_API_BASE_URL,
                BuildConfig.SECONDARY_API_BASE_URL,
                BuildConfig.TERTIARY_API_BASE_URL
            ))
            .addInterceptor(AuthInterceptor(prefs))
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(150, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(BuildConfig.PRIMARY_API_BASE_URL)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()

        apiService = retrofit.create(ApiService::class.java)
    }

    fun getApiService(): ApiService {
        return apiService ?: throw IllegalStateException(
            "RetrofitClient not initialized. Call initialize() first."
        )
    }
}
