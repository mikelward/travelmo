plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.kotlin.multiplatform.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
}

// What the Android app shares with the iOS app beyond `:core`: the text of
// its screens, as Compose Multiplatform resources (`Res.string.*`,
// `Res.plurals.*` in app.travelmo.shared); the data the screens read and
// the actions they take, as interfaces (app.travelmo.data) each app
// implements, Android with Firebase and the parser; and the log they write
// to (app.travelmo.logging). The screens themselves follow (SPEC "iOS app").
kotlin {
    jvmToolchain(21)
    android {
        namespace = "app.travelmo.shared"
        compileSdk = 37
        minSdk = 34
        // The resources reach the app's assets, and Robolectric's, from here.
        androidResources { enable = true }
        // The common tests run on the JVM here too, as `:shared:testAndroidHostTest`.
        withHostTest {}
    }
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain.dependencies {
            api(project(":core"))
            api(libs.kotlinx.coroutines.core)
            api(libs.lifecycle.viewmodel.mp)
            api(libs.compose.mp.runtime)
            api(libs.compose.mp.resources)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotest.assertions.core)
        }
    }
}

compose.resources {
    publicResClass = true
    packageOfResClass = "app.travelmo.shared"
    generateResClass = always
}
