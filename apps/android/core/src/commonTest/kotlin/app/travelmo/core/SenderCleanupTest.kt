package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

/** Mirrors senders.test.ts's senderCleanup. */
class SenderCleanupTest {
    private fun seg(id: String, trip: String, sender: String?) =
        Segment(id, trip, SegmentType.ACTIVITY, "Class", "2026-08-15T09:00:00+01:00", null, sender = sender)

    private fun trip(id: String, owner: String, vararg segments: Segment) =
        TripWithSegments(Trip(id, id, "2026-08-15", "2026-08-15", owner), segments.toList())

    @Test
    fun `removes the sender's bookings from the owner's trips and trips with nothing else whole`() {
        val trips = listOf(
            // A class every week, each its own trip.
            trip("w1", "me", seg("a", "w1", "classes.example")),
            trip("w2", "me", seg("b", "w2", "mail.classes.example")),
            // A real trip with one of the class emails in it.
            trip("rome", "me", seg("c", "rome", "air.example"), seg("d", "rome", "classes.example"), seg("e", "rome", null)),
            // Someone else's trip shared with me.
            trip("theirs", "them", seg("f", "theirs", "classes.example")),
            trip("other", "me", seg("g", "other", "otherclasses.example")),
        )
        senderCleanup(trips, "me", "classes.example") shouldBe SenderCleanup(listOf(WholeTrip("w1", listOf("a")), WholeTrip("w2", listOf("b"))), listOf("rome" to "d"))
    }
}
