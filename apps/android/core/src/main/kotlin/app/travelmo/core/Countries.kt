package app.travelmo.core

import java.util.Locale

// Countries by name, as packages/core/src/countries.ts: the ISO code for a
// country written in English ("Australia", "U.S.A.", "The Netherlands").

// Names people write that the platform does not: short forms, old names,
// parts of a country. "America" alone is left out: too often a continent.
private val aliases = mapOf(
    "usa" to "US", "us" to "US", "united states of america" to "US",
    "uk" to "GB", "great britain" to "GB", "britain" to "GB", "england" to "GB", "scotland" to "GB", "wales" to "GB", "northern ireland" to "GB",
    "holland" to "NL", "the netherlands" to "NL", "czech republic" to "CZ", "south korea" to "KR", "korea" to "KR", "russia" to "RU",
    "uae" to "AE", "ivory coast" to "CI", "macedonia" to "MK", "burma" to "MM", "republic of ireland" to "IE",
)

private fun normalize(name: String): String =
    name.lowercase().replace(".", "").replace(Regex("""\bsaint\b"""), "st").replace(Regex("""[\s-]+"""), " ").trim()

private val byName: Map<String, String> by lazy {
    val map = HashMap(aliases)
    for (code in Locale.getISOCountries()) {
        // Built rather than `Locale.of`, which Android gained only at API 36.
        val label = Locale.Builder().setRegion(code).build().getDisplayCountry(Locale.ENGLISH)
        if (label.isNotEmpty() && label != code) map[normalize(label)] = code
    }
    map
}

/** The ISO code for a country written by name in English, or null when the text is not one. */
fun countryCodeOf(name: String): String? {
    val key = normalize(name)
    if (key.isEmpty()) return null
    return byName[key] ?: byName[key.removePrefix("the ")]
}
