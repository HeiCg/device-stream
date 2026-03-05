plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.fromapptoviral.deviceserver"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Target the :app module for instrumentation
        testApplicationId = "com.fromapptoviral.deviceserver.test"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // NanoHTTPD - lightweight HTTP server
    androidTestImplementation("org.nanohttpd:nanohttpd:2.3.1")

    // AndroidX Test + UiAutomator
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test:rules:1.5.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")

    // JSON
    androidTestImplementation("org.json:json:20231013")
}
