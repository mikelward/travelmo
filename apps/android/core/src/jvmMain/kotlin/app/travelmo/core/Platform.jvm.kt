package app.travelmo.core

import java.util.IllformedLocaleException
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

internal actual fun isoCountryCodes(): List<String> = Locale.getISOCountries().toList()

private val displayCountryCache = ConcurrentHashMap<String, String>()

// Built rather than `Locale.of`, which Android gained only at API 36 and the app runs from 34.
internal actual fun displayCountry(code: String, language: String?): String {
    val locale = if (language == null) Locale.getDefault() else Locale.forLanguageTag(language)
    val key = "${locale.toLanguageTag()}|$code"
    displayCountryCache[key]?.let { return it }
    val name = try {
        Locale.Builder().setRegion(code).build().getDisplayCountry(locale)
    } catch (e: IllformedLocaleException) {
        // Not a region code at all ("G1"): the platform knows no name for it, which the callers expect.
        ""
    }
    if (displayCountryCache.size >= 1024) displayCountryCache.clear()
    displayCountryCache[key] = name
    return name
}

internal actual fun decomposed(text: String): String = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD)
