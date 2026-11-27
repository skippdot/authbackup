// AuthBackupCore for Android: a port of extension/lib (and of ios/Core), plain Kotlin on the JVM with no Android
// APIs, so the conformance vectors run anywhere with a JDK.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin { jvmToolchain(17) }

dependencies {
    api(libs.kotlinx.serialization.json)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // The file the extension's JS core writes (npm run vectors); every case must give the same result here.
    val vectors = rootProject.layout.projectDirectory.file("../tests/vectors/core.json").asFile
    inputs.file(vectors)
    systemProperty("vectors", vectors.absolutePath)
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
