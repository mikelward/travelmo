package app.travelmo.core

// What only the platform knows: its list of countries and their names in a
// language. The JVM asks java.util.Locale, iOS asks NSLocale.

/** The ISO 3166 two-letter country codes the platform knows. */
internal expect fun isoCountryCodes(): List<String>

/**
 * A country's name in [language] ("en"), or in the device's language when
 * null; empty when the platform does not know the code.
 */
internal expect fun displayCountry(code: String, language: String?): String

/** [text] in Unicode canonical decomposition (NFD), so accents are marks of their own. */
internal expect fun decomposed(text: String): String
