package app.travelmo.core

import io.kotest.matchers.ints.shouldBeGreaterThanOrEqual
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldMatch
import kotlin.test.Test

private fun flight(title: String) = Segment("f", "t", SegmentType.FLIGHT, title, "2026-12-13T09:00:00+05:00")

class AirlinesTest {
    @Test
    fun `reads the airline from the flight number in the title`() {
        airlineCode(flight("QF 1 SYD to LHR")) shouldBe "QF"
        airlineCode(flight("U2 8012 LGW to GVA")) shouldBe "U2"
        airlineCode(flight("Flight to Paris")).shouldBeNull()
        airlineCode(flight("ES 9014 London to Paris").copy(type = SegmentType.TRAIN)).shouldBeNull()
    }

    @Test
    fun `gives the listed airline's window and a day for any other`() {
        checkInHoursBefore(flight("EK 18 MAN to DXB")) shouldBe 48
        checkInHoursBefore(flight("AF 1180 CDG to LHR")) shouldBe 30
        checkInHoursBefore(flight("LH 400 FRA to JFK")) shouldBe 23
        checkInHoursBefore(flight("U2 8012 LGW to GVA")) shouldBe 720
        checkInHoursBefore(flight("XX 100 MAN to DXB")) shouldBe DEFAULT_CHECK_IN_HOURS
        checkInHoursBefore(flight("Flight to Paris")) shouldBe 24
        airlineCheckIn(flight("QF 1 SYD to LHR"))?.site shouldBe "https://www.qantas.com/"
        airlineCheckIn(flight("XX 100 MAN to DXB")).shouldBeNull()
    }

    @Test
    fun `lists only sane windows and https home pages`() {
        // The same 19 airlines as packages/core/src/airlines.ts.
        airlineCheckIns.size shouldBe 19
        for ((code, entry) in airlineCheckIns) {
            code shouldMatch Regex("[A-Z0-9]{2}")
            entry.hours shouldBeGreaterThanOrEqual 1
            entry.hours shouldBeLessThanOrEqual 30 * 24
            entry.site shouldMatch Regex("https://[a-z.]+/")
        }
    }

    @Test
    fun `heads a flight with its airline and leads the route with its flight number`() {
        bookingHeading(flight("VS 11 LHR to BOS")) shouldBe BookingHeading("Virgin Atlantic", "VS", "VS 11")
        bookingHeading(flight("FR1401 London (Stansted) to Stockholm (ARN)")) shouldBe BookingHeading("Ryanair", "FR", "FR 1401")
    }

    @Test
    fun `names the airline flying a codeshare as its provider gives it`() {
        bookingHeading(flight("VS4012 BOS to LHR").copy(provider = "Delta")) shouldBe BookingHeading("Delta Air Lines", "DL", "VS 4012")
        bookingHeading(flight("Delta BOS to LHR").copy(provider = "Delta Air Lines")) shouldBe BookingHeading("Delta Air Lines", "DL")
    }

    @Test
    fun `keeps the title of anything else`() {
        bookingHeading(flight("Flight to Paris").copy(provider = "Expedia")) shouldBe BookingHeading("Flight to Paris")
        bookingHeading(flight("ZZ 12 SYD to MEL")) shouldBe BookingHeading("ZZ 12 SYD to MEL")
        bookingHeading(flight("Eurostar 9014").copy(type = SegmentType.TRAIN)) shouldBe BookingHeading("Eurostar 9014")
    }

    @Test
    fun `takes a provider for an airline only when it names one`() {
        airlineNamed("Aeromexico") shouldBe ("AM" to "Aeroméxico")
        airlineNamed("Virgin").shouldBeNull()
        airlineNamed("AirAsia X") shouldBe ("D7" to "AirAsia X")
        airlineNamed("Transavia France") shouldBe ("TO" to "Transavia France")
        for (code in airlineNames.keys) code shouldMatch Regex("[A-Z0-9]{2}")
    }

    @Test
    fun `lists the same airlines as airlines ts`() {
        airlineNames.size shouldBe 129
    }
}
