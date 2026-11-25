package app.travelmo.data

import app.travelmo.core.AirportVisit
import app.travelmo.core.CountryReport
import app.travelmo.core.PlaceVisit
import app.travelmo.core.TravelReport
import app.travelmo.core.YearReport
import io.kotest.assertions.throwables.shouldThrowAny
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Reports' last counts and map, kept on the phone as JSON for the next visit. Invented places.
class ReportSnapshotTest {
    private val report = TravelReport(
        trips = 1,
        days = 5,
        countries = listOf(CountryReport("PT", 5, 1, listOf("lisbon"))),
        years = listOf(YearReport("2026", 1, 5, 1)),
        airports = listOf(AirportVisit("LIS", "PT", 38.77, -9.13)),
        places = listOf(PlaceVisit("Example Guesthouse", "Lisbon", "PT", 38.71, -9.14), PlaceVisit("Somewhere", null, null, 1.0, 2.0)),
        unknownDays = 0,
        unplaced = 0,
        upcoming = 2,
    )

    @Test
    fun `reads back what it wrote for the same account`() {
        decodeReportSnapshot(encodeReportSnapshot("u1", report), "u1") shouldBe report
    }

    @Test
    fun `shows another account's counts to no one`() {
        decodeReportSnapshot(encodeReportSnapshot("u1", report), "u2").shouldBeNull()
        decodeReportSnapshot(null, "u1").shouldBeNull()
    }

    @Test
    fun `refuses text it can't read`() {
        shouldThrowAny { decodeReportSnapshot("""{"uid":""", "u1") }
    }
}
