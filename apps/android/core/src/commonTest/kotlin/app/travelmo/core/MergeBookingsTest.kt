package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/mergeBookings.test.ts, on bookings' documents.
private const val AT = "2026-11-25T10:00:00.000Z"
private val reservation = mapOf(
    "id" to "m1-0", "tripId" to "t", "type" to "car_rental", "title" to "Avis Boston Logan Intl Airport",
    "start" to "2026-11-24T17:30:00-05:00", "end" to "2026-11-29T17:30:00-05:00", "provider" to "Avis", "confirmation" to "20874163US2",
    "origin" to mapOf("name" to "Boston Logan Intl Airport", "code" to "BOS"), "source" to "gmail", "gmailMessageIds" to listOf("m1"),
    "sources" to listOf(mapOf("kind" to "gmail", "id" to "m1", "uid" to "u", "at" to AT)), "createdAt" to AT, "updatedAt" to AT,
)
private val agreement = mapOf(
    "id" to "m2-0", "tripId" to "t", "type" to "car_rental", "title" to "Avis Car Rental East Boston",
    "start" to "2026-11-24T18:15:00-05:00", "confirmation" to "708843612", "notes" to "Rental agreement", "source" to "gmail",
    "gmailMessageIds" to listOf("m2"), "sources" to listOf(mapOf("kind" to "gmail", "id" to "m2", "uid" to "u", "at" to AT)), "rating" to 4,
    "createdAt" to AT, "updatedAt" to AT,
)

class MergeBookingsTest {
    @Test
    fun `keeps the booking chosen filling in only what the other knew with both sources`() {
        val merged = mergedBookingDocument(reservation, agreement, "m2-0", "2026-11-25T12:00:00.000Z")
        merged["id"] shouldBe "m1-0"
        merged["title"] shouldBe "Avis Boston Logan Intl Airport"
        merged["start"] shouldBe "2026-11-24T17:30:00-05:00"
        merged["confirmation"] shouldBe "20874163US2"
        merged["rating"] shouldBe 4
        merged["notes"] shouldBe "Rental agreement\nOther reference: 708843612"
        merged["gmailMessageIds"] shouldBe listOf("m1", "m2")
        merged["mergedFrom"] shouldBe listOf("m2-0")
        merged["editedAt"] shouldBe "2026-11-25T12:00:00.000Z"
        (merged["sources"] as List<*>).map { (it as Map<*, *>)["id"] } shouldBe listOf("m1", "m2")
        merged["mergedBookings"] shouldBe listOf(
            mapOf("type" to "car_rental", "title" to "Avis Car Rental East Boston", "start" to "2026-11-24T18:15:00-05:00", "confirmation" to "708843612"),
        )
    }

    @Test
    fun `remembers every booking merged in across merges and says a note once`() {
        val third = agreement + mapOf("id" to "m3-0", "mergedFrom" to listOf("m4-0"), "notes" to "Other reference: 708843612")
        val merged = mergedBookingDocument(mergedBookingDocument(reservation, agreement, "m2-0", AT), third, "m3-0", AT)
        merged["mergedFrom"] shouldBe listOf("m2-0", "m3-0", "m4-0")
        merged["notes"] shouldBe "Rental agreement\nOther reference: 708843612"
    }

    @Test
    fun `keeps the Restore of either so a cancellation taken back stays taken back`() {
        val merged = mergedBookingDocument(
            reservation + mapOf("restoredFrom" to listOf("c1"), "restoredAt" to "2026-11-20T10:00:00.000Z"),
            agreement + mapOf("restoredFrom" to listOf("c2"), "restoredAt" to "2026-11-22T10:00:00.000Z"),
            "m2-0", AT,
        )
        merged["restoredFrom"] shouldBe listOf("c1", "c2")
        merged["restoredAt"] shouldBe "2026-11-22T10:00:00.000Z"
        val kept = mergedBookingDocument(reservation + ("restoredAt" to "2026-11-22T10:00:00.000Z"), agreement + ("restoredAt" to "2026-11-20T10:00:00.000Z"), "m2-0", AT)
        kept["restoredAt"] shouldBe "2026-11-22T10:00:00.000Z"
        kept.containsKey("restoredFrom") shouldBe false
    }

    @Test
    fun `keeps as many travelers as a booking holds`() {
        val many = { prefix: String, n: Int -> List(n) { "$prefix ${'A' + it}lderson" } }
        val merged = mergedBookingDocument(reservation + ("travelers" to many("Ann", 20)), agreement + ("travelers" to many("Bob", 5)), "m2-0", AT)
        (merged["travelers"] as List<*>).size shouldBe 20
    }

    @Test
    fun `merges boarding passes from both bookings without losing kept fields`() {
        val keep = reservation + ("boardingPasses" to listOf(mapOf("passenger" to "Sam Example", "seat" to "14A")))
        val other = agreement + ("boardingPasses" to listOf(
            mapOf("passenger" to "SAM EXAMPLE", "seat" to "99Z", "gate" to "B34"),
            mapOf("passenger" to "Pat Example", "seat" to "14B"),
        ))
        val merged = mergedBookingDocument(keep, other, "m2-0", AT)
        merged["boardingPasses"] shouldBe listOf(
            mapOf("passenger" to "Sam Example", "seat" to "14A", "gate" to "B34"),
            mapOf("passenger" to "Pat Example", "seat" to "14B"),
        )
    }

    @Test
    fun `keeps distinct non-Latin passenger names separate when merging boarding passes`() {
        val keep = reservation + ("boardingPasses" to listOf(mapOf("passenger" to "张伟", "seat" to "12A")))
        val other = agreement + ("boardingPasses" to listOf(
            mapOf("passenger" to "张伟", "gate" to "A1"),
            mapOf("passenger" to "李娜", "seat" to "12B", "gate" to "A1"),
        ))
        val merged = mergedBookingDocument(keep, other, "m2-0", AT)
        merged["boardingPasses"] shouldBe listOf(
            mapOf("passenger" to "张伟", "seat" to "12A", "gate" to "A1"),
            mapOf("passenger" to "李娜", "seat" to "12B", "gate" to "A1"),
        )
    }

    @Test
    fun `matches airline surname-first and titled passenger names when merging boarding passes`() {
        val keep = reservation + ("boardingPasses" to listOf(mapOf("passenger" to "SMITH/JOHN MR", "seat" to "14A")))
        val other = agreement + ("boardingPasses" to listOf(mapOf("passenger" to "John Smith", "gate" to "C10", "barcode" to "BCBP")))
        val merged = mergedBookingDocument(keep, other, "m2-0", AT)
        merged["boardingPasses"] shouldBe listOf(
            mapOf("passenger" to "SMITH/JOHN MR", "seat" to "14A", "gate" to "C10", "barcode" to "BCBP"),
        )
    }
}
