package app.travelmo.ui

import android.content.Context
import androidx.core.content.edit
import app.travelmo.core.ListFilters
import app.travelmo.data.ListFilterStore

/**
 * The trip list's filters, in their own SharedPreferences file on this
 * phone, like the text size: two switches about what the list shows, not
 * synced (SPEC "Filtering the trip list").
 */
class ListFilterPrefs(context: Context) : ListFilterStore {
    private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    override fun read(): ListFilters = ListFilters(hideCancelled = prefs.getBoolean(KEY_CANCELLED, false), hideLocal = prefs.getBoolean(KEY_LOCAL, false))

    override fun write(filters: ListFilters) = prefs.edit { putBoolean(KEY_CANCELLED, filters.hideCancelled).putBoolean(KEY_LOCAL, filters.hideLocal) }

    private companion object {
        const val FILE = "list_filters"
        const val KEY_CANCELLED = "hide_cancelled"
        const val KEY_LOCAL = "hide_local"
    }
}
