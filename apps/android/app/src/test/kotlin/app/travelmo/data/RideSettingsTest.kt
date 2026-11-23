package app.travelmo.data

import app.travelmo.core.HomeCorrection
import app.travelmo.core.MAX_HIDDEN_RIDE_NEEDS
import app.travelmo.core.MAX_RIDE_COMPANIES
import app.travelmo.core.RideCompany
import app.travelmo.core.RideNear
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class RideSettingsTest {
    @Test
    fun `reads the user document's ride fields, leaving out what does not parse`() {
        val data = mapOf(
            "rideCompanies" to listOf(
                mapOf("name" to "Example Cars", "url" to "https://cars.example.com/book", "near" to "home"),
                mapOf("name" to "Bad", "url" to "javascript:alert(1)", "near" to "home"),
                "not a company",
            ),
            "hiddenRideNeeds" to listOf("s1/car", 7),
            "homes" to listOf(mapOf("city" to "London", "country" to "GB", "from" to "2021-03-12"), mapOf("city" to ""), mapOf("city" to "Paris", "from" to "2026-99-99")),
        )
        rideSettingsOf(data) shouldBe RideSettings(
            companies = listOf(RideCompany("Example Cars", "https://cars.example.com/book", RideNear.HOME)),
            hidden = listOf("s1/car"),
            homes = listOf(HomeCorrection("London", "GB", "2021-03-12")),
        )
        rideSettingsOf(null) shouldBe RideSettings()
    }

    @Test
    fun `hiding keeps the newest when the list is full`() {
        withHidden(listOf("a/car", "b/car"), "a/car") shouldBe listOf("b/car", "a/car")
        val full = (1..MAX_HIDDEN_RIDE_NEEDS).map { "s$it/car" }
        withHidden(full, "new/car").let {
            it.size shouldBe MAX_HIDDEN_RIDE_NEEDS
            it.first() shouldBe "s2/car"
            it.last() shouldBe "new/car"
        }
    }

    @Test
    fun `adds and removes a company leaving every other stored entry as it was`() {
        // The web's schema takes a link with a space in its query; this one doesn't, but keeps it.
        val fromWeb = mapOf("name" to "Web Cars", "url" to "https://cars.example/book?pickup=London Heathrow", "near" to "anywhere")
        val cabs = RideCompany("Village Cabs", "https://cabs.example/", RideNear.HOME)
        val cabsStored = mapOf("name" to "Village Cabs", "url" to "https://cabs.example/", "near" to "home")
        val added = rideCompaniesAdding(listOf(fromWeb), cabs)
        added shouldBe listOf(fromWeb, cabsStored)
        rideCompaniesAdding(added!!, cabs) shouldBe null
        rideCompaniesRemoving(added, cabs) shouldBe listOf(fromWeb)
        rideCompaniesRemoving(listOf(fromWeb), cabs) shouldBe null
    }

    @Test
    fun `counts entries it cannot read towards the limit`() {
        val fromWeb = mapOf("name" to "Web Cars", "url" to "https://cars.example/book?pickup=London Heathrow", "near" to "anywhere")
        val stored = listOf(fromWeb) + (1 until MAX_RIDE_COMPANIES).map { mapOf("name" to "Cabs $it", "url" to "https://cabs.example/", "near" to "home") }
        org.junit.jupiter.api.assertThrows<IllegalStateException> { rideCompaniesAdding(stored, RideCompany("Island Cars", "https://cars.example/", RideNear.ANYWHERE)) }.message shouldBe "At most 20."
    }

    @Test
    fun `reads and writes the countries a company is limited to`() {
        val stored = mapOf("name" to "Cretan Cars", "url" to "https://cretan.example/", "near" to "anywhere", "countries" to listOf("GR"))
        rideSettingsOf(mapOf("rideCompanies" to listOf(stored))).companies shouldBe listOf(RideCompany("Cretan Cars", "https://cretan.example/", RideNear.ANYWHERE, listOf("GR")))
        rideCompaniesAdding(emptyList<Any>(), RideCompany("Cretan Cars", "https://cretan.example/", RideNear.ANYWHERE, listOf("GR"))) shouldBe listOf(stored)
        rideCompaniesAdding(emptyList<Any>(), RideCompany("Cabs", "https://cabs.example/", RideNear.HOME)) shouldBe listOf(mapOf("name" to "Cabs", "url" to "https://cabs.example/", "near" to "home"))
        // Countries in another order are the company already there.
        val both = mapOf("name" to "Cabs", "url" to "https://cabs.example/", "near" to "home", "countries" to listOf("GB", "FR"))
        val reordered = RideCompany("Cabs", "https://cabs.example/", RideNear.HOME, listOf("FR", "GB"))
        rideCompaniesAdding(listOf(both), reordered) shouldBe null
        rideCompaniesRemoving(listOf(both), reordered) shouldBe emptyList<Any>()
    }
}
