plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
}

// Firestore for both apps, through GitLive's Firebase Kotlin SDK, which
// wraps Google's own Android and iOS SDKs: `FirestoreTrips` implements the
// shared `TripStore` once. A module of its own, so `:shared`'s tests run on
// the iOS Simulator without linking Firebase.
kotlin {
    jvmToolchain(21)
    android {
        namespace = "app.travelmo.firestore"
        compileSdk = 37
        minSdk = 34
        withHostTest {}
    }
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain.dependencies {
            api(project(":shared"))
            api(libs.gitlive.firebase.firestore)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotest.assertions.core)
        }
    }
}
