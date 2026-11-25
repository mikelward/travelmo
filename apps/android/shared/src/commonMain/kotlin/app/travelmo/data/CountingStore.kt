package app.travelmo.data

import app.travelmo.core.CountryCounting

/** Where Reports' choice of how to count days in each country is kept on this phone (SPEC "Reports"). */
interface CountingStore {
    fun read(): CountryCounting

    fun write(counting: CountryCounting)
}

/** Kept only while the app runs: what a test or a preview has. */
class InMemoryCountingStore(private var counting: CountryCounting = CountryCounting.PART) : CountingStore {
    override fun read(): CountryCounting = counting

    override fun write(counting: CountryCounting) {
        this.counting = counting
    }
}
