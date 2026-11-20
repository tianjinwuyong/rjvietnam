package com.smt.materialloader.util

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

object LocaleManager {

    private const val LOCALE_ZH = "zh-CN"
    private const val LOCALE_VI = "vi-VN"
    private const val LOCALE_EN = "en-US"

    val supportedLocales = listOf(LOCALE_ZH, LOCALE_VI, LOCALE_EN)

    fun getDisplayName(localeCode: String): String = when (localeCode) {
        LOCALE_ZH -> "中文"
        LOCALE_VI -> "Tiếng Việt"
        LOCALE_EN -> "English"
        else -> "English"
    }

    fun toJavaLocale(localeCode: String): Locale = when (localeCode) {
        LOCALE_ZH -> Locale("zh", "CN")
        LOCALE_VI -> Locale("vi", "VN")
        LOCALE_EN -> Locale("en", "US")
        else -> Locale.ENGLISH
    }

    fun applyLocale(context: Context, localeCode: String): Context {
        val javaLocale = toJavaLocale(localeCode)
        Locale.setDefault(javaLocale)
        val config = Configuration(context.resources.configuration)
        config.setLocale(javaLocale)
        return context.createConfigurationContext(config)
    }
}
