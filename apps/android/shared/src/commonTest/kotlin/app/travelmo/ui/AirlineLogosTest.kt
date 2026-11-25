package app.travelmo.ui

import app.travelmo.core.airlineNames
import kotlin.test.Test
import kotlin.test.assertTrue

// As the web app's airlineLogos.test.ts: every bundled logo is for an airline a heading can name.
class AirlineLogosTest {
    @Test
    fun `lists only airlines a heading can name`() {
        val unknown = airlineLogos.keys - airlineNames.keys
        assertTrue(unknown.isEmpty(), "logos for airlines not listed: $unknown")
        assertTrue(airlineLogos.size == 91, "logos: ${airlineLogos.size}")
    }
}
