plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Firebase's plugin is applied only when app/google-services.json is present
// (README "Android"): CI and a fresh clone carry none, so without this guard
// the build would fail on the missing file. Without it the app runs with no
// Firebase project behind it, and the sign-in screen says so.
val firebaseConfigured: Boolean = file("google-services.json").exists()
if (firebaseConfigured) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
} else {
    logger.lifecycle("travelmo: app/google-services.json not found; building with Firebase dormant.")
}

// versionCode is the commit count of the whole repository, monotonic as long
// as main only moves forward, and versionName names the commit, as the
// sibling apps do. A shallow clone answers `rev-list --count` with a
// confident wrong number, so it is detected rather than trusted, and a
// release build refuses a version it could not derive.
fun gitOutput(vararg args: String, fallback: String): String {
    val command = "git ${args.joinToString(" ")}"
    return try {
        val run = providers.exec {
            commandLine("git", *args)
            isIgnoreExitValue = true
        }
        val output = run.standardOutput.asText.get().trim()
        when {
            run.result.get().exitValue != 0 || output.isEmpty() -> {
                logger.warn("Version derivation: `$command` gave nothing usable; using \"$fallback\".")
                fallback
            }
            else -> output
        }
    } catch (e: Exception) {
        logger.warn("Version derivation: `$command` failed (${e.javaClass.simpleName}); using \"$fallback\".")
        fallback
    }
}

val versionProblems = mutableListOf<String>()
val shallowAnswer = gitOutput("rev-parse", "--is-shallow-repository", fallback = "unknown")
if (shallowAnswer == "true") versionProblems += "the clone is shallow, so the commit count is truncated (run `git fetch --unshallow`)"
if (shallowAnswer != "true" && shallowAnswer != "false") versionProblems += "whether the clone is shallow could not be determined"
val gitCommitCount: Int = gitOutput("rev-list", "--count", "HEAD", fallback = "").toIntOrNull() ?: run {
    versionProblems += "the commit count could not be read, so versionCode fell back to 1"
    1
}
val gitShortSha: String = gitOutput("rev-parse", "--short", "HEAD", fallback = "unknown").also {
    if (it == "unknown") versionProblems += "the commit hash could not be read"
}
// CI's test and lint runs set -PtravelmoFixedVersion so a per-commit version
// does not miss the build cache for every task that reads the manifest.
val fixedTestVersion: Boolean = providers.gradleProperty("travelmoFixedVersion").isPresent

android {
    namespace = "app.travelmo"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.travelmo"
        // Android 14: the device floor across the sibling apps.
        minSdk = 34
        targetSdk = 36
        versionCode = if (fixedTestVersion) 1 else gitCommitCount
        versionName = if (fixedTestVersion) "test" else "$gitCommitCount ($gitShortSha)"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    testOptions {
        unitTests.all { it.useJUnitPlatform() }
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
        lintConfig = file("lint.xml")
        // targetSdk follows the sibling apps (36 while compileSdk is 37);
        // moving it is a deliberate step, taken with its behavior changes read.
        disable += "OldTargetApi"
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21
    }
}

val checkReleaseVersionDerivation = tasks.register("checkReleaseVersionDerivation") {
    description = "Fails a release build whose version was not derived from real git history."
    val problems = versionProblems.toList() + (if (fixedTestVersion) listOf("-PtravelmoFixedVersion is set") else emptyList())
    doLast {
        if (problems.isNotEmpty()) {
            throw GradleException("Refusing to build a release with an underived version: ${problems.joinToString("; ")}.")
        }
    }
}
tasks.configureEach {
    if (name.startsWith("pre") && name.endsWith("ReleaseBuild")) dependsOn(checkReleaseVersionDerivation)
}

dependencies {
    implementation(project(":core"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.core)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.kotlinx.serialization.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.googleid)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
    testImplementation(libs.kotest.assertions.core)
    testImplementation(libs.kotlinx.coroutines.test)
}
