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
}
