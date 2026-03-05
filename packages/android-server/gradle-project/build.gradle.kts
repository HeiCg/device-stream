// Root build.gradle.kts for Android Device Server
// On-device HTTP server for reliable UI automation

plugins {
    id("com.android.application") version "8.11.0" apply false
    id("com.android.library") version "8.11.0" apply false
    id("org.jetbrains.kotlin.android") version "2.1.20" apply false
}

task("clean") {
    delete(rootProject.layout.buildDirectory)
}
