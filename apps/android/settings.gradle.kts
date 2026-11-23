@file:Suppress("UnstableApiUsage")

// The Android app of the travelmo monorepo. A Gradle build of its own, rooted
// here rather than at the repository root, so the pnpm workspace above and
// this build never read each other's files; CI runs both.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        // Google's mirror of Maven Central, tried first: repo.maven.apache.org
        // rate-limits shared CI and sandbox egress (HTTP 429), failing builds.
        // Central stays as the fallback for anything the mirror lacks.
        maven {
            name = "mavenCentralMirror"
            url = uri("https://maven-central.storage-download.googleapis.com/maven2/")
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        // Google's mirror of Maven Central, tried first: repo.maven.apache.org
        // rate-limits shared CI and sandbox egress (HTTP 429), failing builds.
        // Central stays as the fallback for anything the mirror lacks.
        maven {
            name = "mavenCentralMirror"
            url = uri("https://maven-central.storage-download.googleapis.com/maven2/")
        }
        mavenCentral()
        // mikelward/androidlog publishes its own Maven repository into the
        // `maven` branch of that repository, which raw.githubusercontent.com
        // serves; scoped to its group so no other coordinate is looked for here.
        maven {
            name = "androidlog"
            url = uri("https://raw.githubusercontent.com/mikelward/androidlog/maven")
            content { includeGroup("com.mikelward.androidlog") }
        }
        // mikelward/androidzoom, the text size the sibling apps share,
        // publishes the same way and is scoped the same way.
        maven {
            name = "androidzoom"
            url = uri("https://raw.githubusercontent.com/mikelward/androidzoom/maven")
            content { includeGroup("com.mikelward.androidzoom") }
        }
    }
}

rootProject.name = "travelmo"

// `:core` is a plain Kotlin JVM module, not an Android library: the models
// and the logic the web app's packages/core also has (grouping, what comes
// next, the status lines, date formatting) live there, testable without an
// SDK, and `:core:verifyNoAndroid` keeps it that way. `:app` owns Android:
// Compose, Firebase, sign-in.
include(":core")
include(":app")
