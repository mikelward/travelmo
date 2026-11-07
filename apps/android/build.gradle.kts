// Plugins are declared with `apply false` at the root so every module shares
// one version per plugin. `:core` applies kotlin.jvm; `:app` gets Kotlin from
// AGP 9's built-in support and layers kotlin.compose and kotlin.serialization
// on top. The Firebase plugins are loaded here but applied in `:app` only when
// app/google-services.json is present, so a clone without it still builds.
plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.google.services) apply false
}
