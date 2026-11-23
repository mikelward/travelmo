package app.travelmo.data

import app.travelmo.core.HomeCorrection
import app.travelmo.core.MAX_HIDDEN_RIDE_NEEDS
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
}
