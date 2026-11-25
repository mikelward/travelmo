package app.travelmo.ui

import android.content.Context
import androidx.core.content.edit
import app.travelmo.core.CountryCounting
import app.travelmo.data.CountingStore

/**
 * How Reports counts days in each country, in its own SharedPreferences file on this phone, like
 * the list's filters: a choice about what the screen shows, not synced (SPEC "Reports").
 */
class CountingPrefs(context: Context) : CountingStore {
    private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    // A value from a later version this one doesn't know falls back to the default.
    override fun read(): CountryCounting = CountryCounting.entries.firstOrNull { it.name == prefs.getString(KEY, null) } ?: CountryCounting.PART

    override fun write(counting: CountryCounting) = prefs.edit { putString(KEY, counting.name) }

    private companion object {
        const val FILE = "reports"
        const val KEY = "counting"
    }
}
