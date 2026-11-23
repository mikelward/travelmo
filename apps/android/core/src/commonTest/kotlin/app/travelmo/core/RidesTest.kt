package app.travelmo.core

import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldNotContain
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/rides.test.ts.
private val lhr = Place("London Heathrow", code = "LHR", city = "London", country = "GB")
private val bos = Place("Boston Logan", code = "BOS", city = "Boston", country = "US")
private val jfk = Place("New York JFK", code = "JFK", city = "New York", country = "US")
private val home = Place("Home", city = "London", country = "GB")
private val london = listOf(HomePeriod("London", "GB"))
private const val NOW = "2026-11-20T00:00:00Z"

private fun seg(id: String, type: SegmentType, start: String, end: String?, origin: Place? = null, destination: Place? = null) =
    Segment(id, "t", type, id, start, end = end, origin = origin, destination = destination)

private val out = seg("out", SegmentType.FLIGHT, "2026-11-24T17:20:00+00:00", "2026-11-24T20:15:00-05:00", lhr, bos)
private val back = seg("back", SegmentType.FLIGHT, "2026-11-29T19:00:00-05:00", "2026-11-30T07:00:00+00:00", bos, lhr)

private fun keys(segments: List<Segment>, periods: List<HomePeriod> = london, now: String = NOW, hidden: List<String> = emptyList()) =
    rideNeeds(segments, periods, now, hidden = hidden).map(::rideNeedKey)

class RidesTest {
    @Test
    fun `asks for a ride to and from the airport at home and a car where the flight lands`() {
        keys(listOf(out, back)) shouldBe listOf("out/toAirport", "out/car", "back/fromAirport")
    }

    @Test
    fun `needs no car when one is hired on landing nor a ride a transfer already covers`() {
        val hire = seg("hire", SegmentType.CAR_RENTAL, "2026-11-24T21:00:00-05:00", "2026-11-29T16:00:00-05:00", bos, bos)
        val cab = seg("cab", SegmentType.OTHER, "2026-11-24T14:30:00+00:00", "2026-11-24T15:15:00+00:00", home, lhr)
        val ride = seg("home", SegmentType.OTHER, "2026-11-30T08:00:00+00:00", null, lhr, home)
        keys(listOf(out, back, hire, cab, ride)) shouldBe emptyList()
    }

    @Test
    fun `counts a transfer only for the end of the flight it meets`() {
        val cab = seg("cab", SegmentType.OTHER, "2026-11-24T14:30:00+00:00", "2026-11-24T15:15:00+00:00", home, lhr)
        keys(listOf(out, back, cab)) shouldBe listOf("out/car", "back/fromAirport")
        val pickup = seg("pickup", SegmentType.OTHER, "2026-11-24T21:00:00-05:00", null, bos, Place("Example Hotel", city = "Boston", country = "US"))
        keys(listOf(out, back, pickup)) shouldBe listOf("out/toAirport", "back/fromAirport")
    }

    @Test
    fun `counts a car only when it is collected where the flight lands`() {
        val rentals = Place("Example Rentals", city = "London", country = "GB")
        val londonCar = seg("ldn", SegmentType.CAR_RENTAL, "2026-11-24T08:00:00+00:00", "2026-11-24T13:00:00+00:00", rentals, rentals)
        keys(listOf(out, back, londonCar)) shouldContain "out/car"
        val downtown = seg("dt", SegmentType.CAR_RENTAL, "2026-11-25T09:00:00-05:00", null, Place("Example Rentals Back Bay", city = "Boston", country = "US"))
        keys(listOf(out, back, downtown)) shouldNotContain "out/car"
    }

    @Test
    fun `needs nothing at an airport where the traveler connects`() {
        val toJfk = seg("toJfk", SegmentType.FLIGHT, "2026-11-24T09:00:00+00:00", "2026-11-24T12:00:00-05:00", lhr, jfk)
        val toBos = seg("toBos", SegmentType.FLIGHT, "2026-11-24T14:00:00-05:00", "2026-11-24T15:15:00-05:00", jfk, bos)
        keys(listOf(toJfk, toBos)) shouldBe listOf("toJfk/toAirport", "toBos/car")
    }

    @Test
    fun `without a home suggests a car only where a later journey shows the landing is away`() {
        keys(listOf(out, back), periods = emptyList()) shouldBe listOf("out/car")
        // Home only from a later date is no home for these flights either.
        keys(listOf(out, back), periods = listOf(HomePeriod("Paris", "FR", from = "2027-01-01"))) shouldBe listOf("out/car")
    }

    @Test
    fun `asks only for what is still ahead`() {
        keys(listOf(out, back), now = "2026-11-24T18:00:00Z") shouldBe listOf("out/car", "back/fromAirport")
        keys(listOf(out, back), now = "2026-12-01T00:00:00Z") shouldBe emptyList()
    }

    @Test
    fun `leaves out what was dismissed and what was cancelled`() {
        val cancelled = back.copy(cancelledAt = "2026-11-20T00:00:00Z", cancelledBy = "m9")
        keys(listOf(out, cancelled), hidden = listOf("out/car")) shouldBe listOf("out/toAirport")
    }

    @Test
    fun `offers the rental companies then the traveler's own for a car and only their own near home for a ride`() {
        val cars = RideCompany("Example Cars", "https://cars.example.com/book", RideNear.HOME)
        val rentals = RideCompany("Example Rentals", "https://rentals.example.com/", RideNear.ANYWHERE)
        rideCompaniesFor(RideNeedKind.CAR, listOf(cars, rentals)).map { it.name } shouldBe rentalCompanies.map { it.name } + "Example Rentals"
        rideCompaniesFor(RideNeedKind.TO_AIRPORT, listOf(cars, rentals)) shouldBe listOf(CompanyLink("Example Cars", "https://cars.example.com/book"))
        rideCompaniesFor(RideNeedKind.FROM_AIRPORT, emptyList()) shouldBe emptyList()
    }

    @Test
    fun `takes only a named https link`() {
        rideCompanyOrNull("Example Cars", "https://cars.example.com/", "home") shouldBe RideCompany("Example Cars", "https://cars.example.com/", RideNear.HOME)
        rideCompanyOrNull("Example Cars", "http://cars.example.com", "home").shouldBeNull()
        rideCompanyOrNull("Example Cars", "javascript:alert(1)", "home").shouldBeNull()
        rideCompanyOrNull(" ", "https://cars.example.com/", "home").shouldBeNull()
        rideCompanyOrNull("Example Cars", "https://cars.example.com/", "nowhere").shouldBeNull()
        // A link with no host, which the web's schema (`.url()`) refuses too.
        rideCompanyOrNull("Example Cars", "https://?", "home").shouldBeNull()
        rideCompanyOrNull("Example Cars", "https:///cars", "home").shouldBeNull()
        rideCompanyOrNull("Example Cars", "https://#top", "home").shouldBeNull()
        rideCompanyOrNull("Example Cars", "https://cars.example.com?from=home", "home")?.url shouldBe "https://cars.example.com?from=home"
    }

    @Test
    fun `adds a company once and takes it away and refuses one past the limit`() {
        val cabs = RideCompany("Cabs", "https://cabs.example/", RideNear.HOME)
        withRideCompany(emptyList(), cabs) shouldBe listOf(cabs)
        withRideCompany(listOf(cabs), cabs) shouldBe listOf(cabs)
        withoutRideCompany(listOf(cabs), cabs.copy()) shouldBe emptyList()
        val full = (0 until 20).map { cabs.copy(name = "Cabs $it") }
        kotlin.test.assertFailsWith<IllegalStateException> { withRideCompany(full, cabs) }.message shouldBe "At most 20."
    }
}
