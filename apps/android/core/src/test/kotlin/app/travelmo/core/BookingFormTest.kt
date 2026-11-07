package app.travelmo.core

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.collections.shouldContain
import org.junit.jupiter.api.Test

class ZoneTest {
    @Test
    fun `offsets follow the zone's rules at the wall time, DST included`() {
        zoneOffset("Europe/London", "2026-12-12", "09:07") shouldBe "+00:00"
        zoneOffset("Europe/London", "2026-07-01", "09:00") shouldBe "+01:00"
        zoneOffset("Asia/Dubai", "2026-12-13", "09:00") shouldBe "+04:00"
        zoneOffset("UTC", "2026-01-01", "00:00") shouldBe "+00:00"
        // 01:30 on 29 March 2026 does not exist in London: the clock showed 02:30 next.
        zoneOffset("Europe/London", "2026-03-29", "01:30") shouldBe "+01:00"
    }

    @Test
    fun `instants split into fields and compose back, and a pinned offset stays pinned`() {
        splitInstant("2026-12-13T09:00:00+05:00") shouldBe InstantParts("2026-12-13", "09:00", "+05:00")
        splitInstant("2026-12-13T09:00Z") shouldBe InstantParts("2026-12-13", "09:00", "+00:00")
        splitInstant("2026-12-13T09:00:00+0530") shouldBe InstantParts("2026-12-13", "09:00", "+05:30")
        composeInstant("2026-12-13", "09:00", "+05:00") shouldBe "2026-12-13T09:00:00+05:00"
        zoneForOffset("+00:00", "2026-12-12", "09:00", "Europe/London") shouldBe "Europe/London"
        zoneForOffset("+05:00", "2026-12-12", "09:00", "Europe/London") shouldBe "offset:+05:00"
        resolveOffset("offset:+05:00", "2026-12-12", "09:00") shouldBe "+05:00"
        resolveOffset("Europe/Paris", "2026-12-12", "09:00") shouldBe "+01:00"
        zoneLabel("offset:+05:00") shouldBe "UTC+05:00 (as imported)"
        zoneLabel("America/New_York") shouldBe "America/New York"
        timeZones().first() shouldBe "UTC"
        timeZones() shouldContain "Europe/London"
    }

    @Test
    fun `airport codes know their zones`() {
        airportZone("MAN") shouldBe "Europe/London"
        airportZone("dxb") shouldBe "Asia/Dubai"
        airportZone("XXXX").shouldBeNull()
        airportZone("").shouldBeNull()
    }
}

class BookingFormTest {
    private val stay = Segment(
        "s", "t", SegmentType.LODGING, "Cove Liverpool", "2026-12-12T15:00:00+00:00", "2026-12-14T11:00:00+00:00",
        destination = Place("Cove Liverpool", city = "Liverpool", country = "GB"),
    )

    @Test
    fun `a new booking starts on the trip's first day in the device's zone, an existing one as stored`() {
        val fresh = initialFields(null, "2026-12-12", here = "Europe/London")
        fresh.startDate shouldBe "2026-12-12"
        fresh.startTime shouldBe "09:00"
        fresh.startZone shouldBe "Europe/London"
        fresh.endDate shouldBe ""
        val edit = initialFields(stay, "2026-12-12", here = "Europe/London")
        edit.type shouldBe SegmentType.LODGING
        edit.startZone shouldBe "Europe/London"
        edit.endDate shouldBe "2026-12-14"
        edit.destinationName shouldBe "Cove Liverpool"
        edit.destinationCountry shouldBe "GB"
        // A flight written in an offset London never has stays pinned to it.
        val flight = Segment("f", "t", SegmentType.FLIGHT, "XX 100", "2026-12-13T09:00:00+05:00")
        initialFields(flight, "2026-12-12", here = "Europe/London").startZone shouldBe "offset:+05:00"
    }

    @Test
    fun `the draft composes the instants, keeps a flight's country, and names a place by its country`() {
        val draft = toDraft(
            BookingFields(
                type = SegmentType.TRAIN, title = " Avanti to Liverpool ", startDate = "2026-12-12", startTime = "09:07", startZone = "Europe/London",
                endDate = "", endTime = "11:25", endZone = "Europe/London",
                originName = "London Euston", originCode = "eus", destinationName = "Liverpool Lime Street", destinationCode = "LIV", destinationCountry = "gb",
                provider = "Avanti West Coast", confirmation = "ABC123", notes = " ",
            ),
            null,
        )
        draft.title shouldBe "Avanti to Liverpool"
        draft.start shouldBe "2026-12-12T09:07:00+00:00"
        draft.end shouldBe "2026-12-12T11:25:00+00:00"
        draft.origin shouldBe PlaceDraft("London Euston", "EUS", null)
        draft.destination shouldBe PlaceDraft("Liverpool Lime Street", "LIV", "GB")
        draft.notes.shouldBeNull()
        // A flight shows no country picker and keeps the booking's own.
        val flight = Segment("f", "t", SegmentType.FLIGHT, "XX 100", "2026-12-13T09:00:00+05:00", origin = Place("Manchester", code = "MAN", country = "GB"))
        toDraft(BookingFields(type = SegmentType.FLIGHT, title = "XX 100", startDate = "2026-12-13", startZone = "Asia/Dubai", originName = "Manchester", originCode = "MAN"), flight)
            .origin shouldBe PlaceDraft("Manchester", "MAN", "GB")
        // A stay with only a country is a place named by it.
        toDraft(BookingFields(type = SegmentType.LODGING, title = "Somewhere", startDate = "2026-12-12", destinationCountry = "FR"), null)
            .destination!!.name shouldBe countryName("FR")
        toDraft(BookingFields(type = SegmentType.LODGING, title = "Somewhere", startDate = "2026-12-12"), null).destination.shouldBeNull()
    }

    @Test
    fun `says what is wrong`() {
        shouldThrow<BookingFormException> { toDraft(BookingFields(title = " ", startDate = "2026-12-12"), null) }.message shouldBe "Title is required"
        shouldThrow<BookingFormException> { toDraft(BookingFields(title = "x", startDate = ""), null) }.message shouldBe "Start date is required"
        shouldThrow<BookingFormException> {
            toDraft(BookingFields(title = "x", startDate = "2026-12-12", startTime = "10:00", endDate = "2026-12-12", endTime = "09:00"), null)
        }.message shouldBe "End must not be before start"
        shouldThrow<BookingFormException> { toDraft(BookingFields(title = "x", startDate = "2026-13-45"), null) }.message shouldBe "Start is not a date and time"
    }

    @Test
    fun `countries are offered by name`() {
        countryName("GB") shouldBe "United Kingdom"
        countryName("Z1") shouldBe "Z1"
        countryChoices().first { it.first == "FR" }.second shouldBe "France"
    }
}
