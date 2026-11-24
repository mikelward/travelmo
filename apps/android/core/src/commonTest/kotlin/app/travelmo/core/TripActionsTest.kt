package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Matching packages/core/src/tripActions.test.ts.
class TripActionsTest {
    @Test
    fun `says what regrouping changed or that nothing needed changing`() {
        describeRegroup(3, 0) shouldBe "Done: 3 trips rebuilt."
        describeRegroup(1, 1) shouldBe "Done: 1 trip rebuilt, 1 trip merged away."
        describeRegroup(0, 0) shouldBe "Your trips were already grouped this way."
        describeRegroup(0, 0, 2) shouldBe "Done: 2 bookings placed."
        describeRegroup(1, 0, 1) shouldBe "Done: 1 trip rebuilt, 1 booking placed."
    }

    @Test
    fun `says how many trips went and what to do next`() {
        describeDeletedTrips(12) shouldBe "Deleted 12 trips. Import past bookings to start again."
        describeDeletedTrips(1) shouldBe "Deleted 1 trip. Import past bookings to start again."
        describeDeletedTrips(0) shouldBe "You had no trips to delete."
    }

    @Test
    fun `says why an action failed`() {
        tripActionFailure(null) shouldBe "Couldn't reach Travelmo. Check your connection and try again."
        tripActionFailure(401) shouldBe "Couldn't confirm it's you. Sign out, sign in again and try again."
        tripActionFailure(500) shouldBe "That didn't work (error 500). Try again."
    }
}
