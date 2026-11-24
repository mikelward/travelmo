package app.travelmo.data

import app.travelmo.core.ListFilters

/** Where the trip list's filters are kept on this phone (SPEC "Filtering the trip list"). */
interface ListFilterStore {
    fun read(): ListFilters

    fun write(filters: ListFilters)
}

/** Kept only while the app runs: what a test or a preview has. */
class InMemoryListFilterStore(private var filters: ListFilters = ListFilters()) : ListFilterStore {
    override fun read(): ListFilters = filters

    override fun write(filters: ListFilters) {
        this.filters = filters
    }
}
