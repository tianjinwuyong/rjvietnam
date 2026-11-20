plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

import java.io.FileInputStream
import java.util.Properties

val releaseSigningProperties = Properties()
val releaseSigningFile = rootProject.file("app/release-signing.properties")
if (releaseSigningFile.exists()) {
    FileInputStream(releaseSigningFile).use { releaseSigningProperties.load(it) }
}

android {
    namespace = "com.smt.materialloader"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ruijing.linemanager"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
        // Factory PDA uses 155 as primary, 122 as secondary, 234 as tertiary.
        // Failover chain: 155 → 122 → 234 (GET requests cascade; POST/PUT/DELETE do not replay).
        buildConfigField("String", "PRIMARY_API_BASE_URL", "\"http://192.168.6.155:8080/\"")
        buildConfigField("String", "SECONDARY_API_BASE_URL", "\"http://192.168.6.122:8080/\"")
        buildConfigField("String", "TERTIARY_API_BASE_URL", "\"http://192.168.6.234:8080/\"")
    }

    signingConfigs {
        create("release") {
            storeFile = file(releaseSigningProperties.getProperty("storeFile"))
            storePassword = releaseSigningProperties.getProperty("storePassword")
            keyAlias = releaseSigningProperties.getProperty("keyAlias")
            keyPassword = releaseSigningProperties.getProperty("keyPassword")
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            buildConfigField("boolean", "TEST_ACTION_BYPASS_ENABLED", "true")
            buildConfigField("boolean", "PLANT_MANAGER_APP", "false")
            buildConfigField("boolean", "UNIFIED_MANAGEMENT_APP", "false")
            // Phone smoke test uses the MES host on the factory Wi-Fi.
            buildConfigField("String", "API_BASE_URL", "\"http://192.168.6.155:8080/\"")
        }
        create("hotelDebug") {
            initWith(getByName("debug"))
            // Hotel Wi-Fi uses the workstation's WLAN address. Keep the same
            // unified PDA quick-login and scanner flow as debug builds.
            // Hotel USB test route: adb reverse tcp:8080 tcp:8080
            buildConfigField("String", "API_BASE_URL", "\"http://127.0.0.1:8080/\"")
        }
        create("receivingOnly") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".receiving"
            versionNameSuffix = "-material-receiving"
            matchingFallbacks += listOf("debug")
            buildConfigField("boolean", "RECEIVING_ONLY", "true")
            buildConfigField("String", "API_BASE_URL", "\"http://192.168.6.155:8080/\"")
            resValue("string", "app_name", "Material Receiving PDA")
            resValue("string", "login_title", "Material Receiving PDA")
            resValue("string", "login_subtitle", "WMS Material Receiving")
        }
        release {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("release")
            buildConfigField("boolean", "TEST_ACTION_BYPASS_ENABLED", "false")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_BASE_URL", "\"http://192.168.6.155:8080/\"")
            buildConfigField("boolean", "PLANT_MANAGER_APP", "false")
            buildConfigField("boolean", "UNIFIED_MANAGEMENT_APP", "false")
        }
        create("plantManager") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".plantmanager"
            versionNameSuffix = "-plant-manager"
            matchingFallbacks += listOf("debug")
            // MuMu-only smoke-test shortcut; production release keeps this false.
            buildConfigField("boolean", "TEST_ACTION_BYPASS_ENABLED", "true")
            buildConfigField("boolean", "PLANT_MANAGER_APP", "true")
            buildConfigField("boolean", "UNIFIED_MANAGEMENT_APP", "false")
            resValue("string", "app_name", "Plant Manager PDA")
            resValue("string", "login_title", "Plant Manager PDA")
            resValue("string", "login_subtitle", "MES Plant Manager Approval")
        }
        create("plantManagerRelease") {
            initWith(getByName("release"))
            applicationIdSuffix = ".plantmanager"
            versionNameSuffix = "-plant-manager"
            matchingFallbacks += listOf("release")
            // Production Plant Manager build: authenticated actions only.
            buildConfigField("boolean", "TEST_ACTION_BYPASS_ENABLED", "false")
            buildConfigField("boolean", "PLANT_MANAGER_APP", "true")
            buildConfigField("boolean", "UNIFIED_MANAGEMENT_APP", "false")
            buildConfigField("String", "API_BASE_URL", "\"http://192.168.6.155:8080/\"")
            resValue("string", "app_name", "Plant Manager PDA")
            resValue("string", "login_title", "Plant Manager PDA")
            resValue("string", "login_subtitle", "MES Plant Manager Approval")
        }
        create("unifiedManagement") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".management"
            versionNameSuffix = "-unified-management"
            matchingFallbacks += listOf("debug")
            buildConfigField("boolean", "TEST_ACTION_BYPASS_ENABLED", "true")
            buildConfigField("boolean", "PLANT_MANAGER_APP", "false")
            buildConfigField("boolean", "UNIFIED_MANAGEMENT_APP", "true")
            // Physical factory PDA route: WMS server on factory Wi-Fi.
            buildConfigField("String", "API_BASE_URL", "\"http://192.168.6.155:8080/\"")
            resValue("string", "app_name", "统一管理应用")
            resValue("string", "login_title", "统一管理应用")
            resValue("string", "login_subtitle", "MES 线长 · 组长 · 物料员")
        }
        create("unifiedManagementRelease") {
            initWith(getByName("release"))
            applicationIdSuffix = ".management"
            versionNameSuffix = "-unified-management"
            matchingFallbacks += listOf("release")
            buildConfigField("boolean", "TEST_ACTION_BYPASS_ENABLED", "false")
            buildConfigField("boolean", "PLANT_MANAGER_APP", "false")
            buildConfigField("boolean", "UNIFIED_MANAGEMENT_APP", "true")
            // Physical factory PDA route: WMS server on factory Wi-Fi.
            buildConfigField("String", "API_BASE_URL", "\"http://192.168.6.155:8080/\"")
            resValue("string", "app_name", "统一管理应用")
            resValue("string", "login_title", "统一管理应用")
            resValue("string", "login_subtitle", "MES 线长 · 组长 · 物料员")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
}

dependencies {
    // AndroidX Core
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.3")
    implementation("androidx.activity:activity-compose:1.9.0")

    // Jetpack Compose BOM
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("androidx.compose.material:material-icons-extended")

    // Navigation
    implementation("androidx.navigation:navigation-compose:2.7.7")

    // Retrofit + OkHttp
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Gson
    implementation("com.google.code.gson:gson:2.11.0")

    // DataStore for preferences
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // CameraX for barcode scanning
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    // ML Kit barcode scanning
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    // Bundled/offline Latin OCR for receiving labels (no network dependency).
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("com.google.mlkit:text-recognition-chinese:16.0.1")
    // QR labels for the physical repaired-NG destination buckets
    implementation("com.google.zxing:core:3.5.3")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Debug
    testImplementation("junit:junit:4.13.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
