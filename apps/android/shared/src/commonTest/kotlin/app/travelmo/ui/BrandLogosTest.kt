package app.travelmo.ui

import app.travelmo.core.brands
import kotlin.test.Test
import kotlin.test.assertTrue

// As the web app's brandLogos.test.ts: every bundled logo is for a brand a booking can name.
class BrandLogosTest {
    @Test
    fun `lists only brands a booking can name`() {
        val unknown = brandLogos.keys - brands.map { it.id }.toSet()
        assertTrue(unknown.isEmpty(), "logos for brands not listed: $unknown")
        assertTrue(brandLogos.size == 50, "logos: ${brandLogos.size}")
    }
}
