import org.gradle.api.artifacts.component.ModuleComponentSelector
import org.gradle.api.artifacts.result.ResolvedDependencyResult
import org.gradle.api.artifacts.result.UnresolvedDependencyResult

plugins {
    alias(libs.plugins.kotlin.jvm)
    `java-library`
}

// A plain Kotlin JVM module on purpose: the models and the logic shared with
// the web app's packages/core take strings and clocks and nothing else, so
// `./gradlew :core:test` needs no Android SDK, and nothing here can reach for
// a Context or a composable.
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

// The airport table (IATA code to time zone) is the web's generated
// packages/core/src/airports.json, read from there rather than copied, so
// `pnpm --filter @travelmo/core airports` refreshes both apps.
sourceSets {
    main {
        resources.srcDir(rootProject.file("../../packages/core/src"))
        resources.srcDir(rootProject.file("../web/src/lib"))
        resources.include("airports.json", "airportPlaces.json", "worldMap.json")
    }
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
    testImplementation(libs.kotest.assertions.core)

    // Self-test only: `-PverifyNoAndroidSelfTest` puts an Android artifact on
    // the classpath so CI can prove `verifyNoAndroid` fails.
    if (providers.gradleProperty("verifyNoAndroidSelfTest").isPresent) {
        implementation("androidx.core:core-ktx:1.13.1")
    }
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

// The seam above is a convention until something enforces it. This task fails
// when an Android plugin or an Android artifact enters `:core`, whether or not
// the tests still pass (the shape the sibling apps use).
val verifyNoAndroid = tasks.register("verifyNoAndroid") {
    description = "Fails if an Android plugin or dependency enters :core."
    group = "verification"
    val androidPlugins = plugins.map { it.javaClass.name }.filter { it.startsWith("com.android.") }
    val classpaths = listOf("compileClasspath", "runtimeClasspath")
        .mapNotNull { name -> configurations.findByName(name)?.let { name to it } }
    // Requested and actual selectors alike, so a substitution rule cannot
    // hide an Android module, and unresolved ones count too: an AAR never
    // resolves on a JVM module, which is exactly the case to catch.
    val classpathModules = provider {
        classpaths.associate { (name, configuration) ->
            name to configuration.incoming.resolutionResult.allDependencies.flatMap { result ->
                val requested = (result.requested as? ModuleComponentSelector)?.let { "${it.group}:${it.module}" }
                val actual = when (result) {
                    is ResolvedDependencyResult -> result.selected.moduleVersion?.let { "${it.group}:${it.name}" }
                    is UnresolvedDependencyResult -> (result.attempted as? ModuleComponentSelector)?.let { "${it.group}:${it.module}" }
                    else -> null
                }
                listOfNotNull(requested, actual)
            }.distinct()
        }
    }
    doLast {
        check(androidPlugins.isEmpty()) {
            ":core stays free of Android so its logic is testable on the JVM, but these Android plugins are applied: $androidPlugins."
        }
        val banned = listOf("com.android", "androidx.", "com.google.android", "org.robolectric")
        val modules = classpathModules.get()
        check(modules.values.any { it.isNotEmpty() }) {
            "verifyNoAndroid resolved no modules on ${modules.keys}, so it proved nothing."
        }
        val offenders = modules
            .mapValues { (_, ids) -> ids.filter { id -> banned.any(id::startsWith) } }
            .filterValues { it.isNotEmpty() }
        check(offenders.isEmpty()) {
            ":core stays free of Android so its logic is testable on the JVM, but these Android modules are on its classpath: $offenders."
        }
    }
}

tasks.named("check") {
    dependsOn(verifyNoAndroid)
}
