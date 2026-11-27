package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/brands.test.ts.
private fun booking(type: SegmentType, title: String, provider: String? = null) = Segment("b", "t", type, title, "2026-12-13T15:00:00+00:00", provider = provider)
private fun stay(title: String, provider: String? = null) = booking(SegmentType.LODGING, title, provider)

class BrandsTest {
    @Test
    fun `names the brand the traveler knows falling back to its parent for a logo`() {
        brandLogoIds(stay("Holiday Inn Express Boston North-Woburn by IHG")) shouldBe listOf("holidayinnexpress", "ihg")
        brandLogoIds(stay("Hampton by Hilton London Gatwick")) shouldBe listOf("hampton", "hilton")
        brandLogoIds(stay("London Hilton on Park Lane")) shouldBe listOf("hilton")
        brandLogoIds(stay("The Ritz-Carlton, Berlin")) shouldBe listOf("ritzcarlton", "marriott")
    }

    @Test
    fun `prefers a hotel's brand over the booking site it was booked through`() {
        bookingBrand(stay("Novotel Paris Centre", "Booking.com"))?.id shouldBe "novotel"
        bookingBrand(stay("Hôtel du Marais", "Booking.com"))?.id shouldBe "booking"
        bookingBrand(stay("Cottage by the sea", "Airbnb"))?.id shouldBe "airbnb"
    }

    @Test
    fun `names a brand only for its kind of booking as whole words`() {
        bookingBrand(booking(SegmentType.CAR_RENTAL, "SIXT Göteborg Central Train Station"))?.id shouldBe "sixt"
        bookingBrand(booking(SegmentType.TRAIN, "Eurostar 9014"))?.id shouldBe "eurostar"
        bookingBrand(booking(SegmentType.MEAL, "Dishoom", "OpenTable"))?.id shouldBe "opentable"
        bookingBrand(booking(SegmentType.FLIGHT, "Hilton Head to Atlanta")).shouldBeNull()
        bookingBrand(stay("Cove Liverpool")).shouldBeNull()
        bookingBrand(stay("Hiltonia guest house")).shouldBeNull()
    }

    @Test
    fun `lists each brand once every parent a brand and the same as brands ts`() {
        val ids = brands.map { it.id }
        ids.toSet().size shouldBe ids.size
        for (b in brands) b.parent?.let { (it in ids) shouldBe true }
        brands.size shouldBe 123
    }
}
