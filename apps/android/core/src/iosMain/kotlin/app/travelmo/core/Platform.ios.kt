package app.travelmo.core

import platform.Foundation.ISOCountryCodes
import platform.Foundation.NSLocale
import platform.Foundation.currentLocale
import platform.Foundation.localizedStringForCountryCode

internal actual fun isoCountryCodes(): List<String> = NSLocale.ISOCountryCodes.filterIsInstance<String>()

internal actual fun displayCountry(code: String, language: String?): String {
    val locale = if (language == null) NSLocale.currentLocale else NSLocale(localeIdentifier = language)
    return locale.localizedStringForCountryCode(code).orEmpty()
}
