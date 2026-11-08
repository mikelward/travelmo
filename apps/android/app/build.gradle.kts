plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
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
// does not miss the build cache for every task that reads the manifest. A
// screenshot run fixes it too, whichever way it is started: Settings shows
// the version, so a recording made with the real one would never match CI.
val fixedTestVersion: Boolean = listOf("travelmoFixedVersion", "roborazzi.test.record", "roborazzi.test.verify")
    .any { providers.gradleProperty(it).isPresent }

// The four release-keystore variables, normalized once: blank is absent. All
// four or none: a partial set used to attach a signing config with a password
// missing, which fails deep inside AGP naming neither the variable nor this
// block. CI materializes the Play upload keystore from a secret and points
// RELEASE_KEYSTORE_FILE at it (README "Release"); a build without the
// variables makes an unsigned release, so a fresh clone still builds.
fun releaseKeystoreEnv(name: String): String? = providers.environmentVariable(name).orNull?.takeIf { it.isNotBlank() }

val releaseKeystorePath = releaseKeystoreEnv("RELEASE_KEYSTORE_FILE")
val releaseKeystorePassword = releaseKeystoreEnv("RELEASE_KEYSTORE_PASSWORD")
val releaseKeyAlias = releaseKeystoreEnv("RELEASE_KEY_ALIAS")
val releaseKeyPassword = releaseKeystoreEnv("RELEASE_KEY_PASSWORD")
val releaseKeystoreVars = listOf(releaseKeystorePath, releaseKeystorePassword, releaseKeyAlias, releaseKeyPassword)
val releaseSigningConfigured = releaseKeystoreVars.all { it != null }
if (!releaseSigningConfigured && releaseKeystoreVars.any { it != null }) {
    throw GradleException(
        "Release signing needs all of RELEASE_KEYSTORE_FILE, RELEASE_KEYSTORE_PASSWORD, RELEASE_KEY_ALIAS and RELEASE_KEY_PASSWORD, or none; only some are set.",
    )
}

android {
    namespace = "app.travelmo"
    compileSdk = 37

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

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
            // Signed only when the variables are set; Play App Signing re-signs
            // the bundle with its own key, so this one only authenticates the upload.
            if (releaseSigningConfigured) signingConfig = signingConfigs.getByName("release")
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
        unitTests.all {
            it.useJUnitPlatform()
            // The screenshot tests (ScreenScreenshotTest) render each screen to
            // a PNG under app/snapshots/, which is under source control so a UI
            // change shows as an image diff in the PR. `-Proborazzi.test.record`
            // rewrites them; `-Proborazzi.test.verify` (CI) fails on a change.
            it.systemProperty("roborazzi.output.dir", file("snapshots").absolutePath)
            if (project.hasProperty("roborazzi.test.record")) it.systemProperty("roborazzi.test.record", "true")
            if (project.hasProperty("roborazzi.test.verify")) it.systemProperty("roborazzi.test.verify", "true")
            // Robolectric's SDK sandbox reads FileDescriptor internals through
            // jdk.internal.access.SharedSecrets, which java.base does not export.
            it.jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")
        }
        // Coroutines' Android dispatcher asks for the main Looper at class
        // load; with defaults it gets null and steps aside for the test one.
        unitTests.isReturnDefaultValues = true
        // Roborazzi needs the real resources (strings, themes) to render.
        unitTests.isIncludeAndroidResources = true
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
    implementation(libs.androidlog.logging.core)
    implementation(libs.androidlog.logging.android)
    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
    testImplementation(libs.kotest.assertions.core)
    testImplementation(libs.kotlinx.coroutines.test)
    // Screenshot tests: JUnit 4 under Vintage for Robolectric's runner.
    testImplementation(libs.junit4)
    testRuntimeOnly(libs.junit.vintage.engine)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
