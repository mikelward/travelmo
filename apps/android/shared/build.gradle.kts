plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
}

// What the Android app shares with the iOS app beyond `:core`: so far the
// text of its screens, as Compose Multiplatform resources (`Res.string.*`,
// `Res.plurals.*` in app.travelmo.shared), read the same way on both. The
// screens themselves follow (SPEC "iOS app").
kotlin {
    jvmToolchain(21)
    android {
        namespace = "app.travelmo.shared"
        compileSdk = 37
        minSdk = 34
        // The resources reach the app's assets, and Robolectric's, from here.
        androidResources { enable = true }
    }
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain.dependencies {
            api(libs.compose.mp.runtime)
            api(libs.compose.mp.resources)
        }
    }
}

compose.resources {
    publicResClass = true
    packageOfResClass = "app.travelmo.shared"
    generateResClass = always
}
