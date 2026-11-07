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
        mavenCentral()
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
