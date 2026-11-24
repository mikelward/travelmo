package app.travelmo.notify

import app.travelmo.data.TripStore
import app.travelmo.ui.FakeTripStore
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Test

/** The notification's "I've checked in" saves the mark through the app's store, and says when it could not. */
class CheckedInReceiverTest {
    @Test
    fun `saves the mark for the signed-in user`() = runTest {
        val store = FakeTripStore()
        CheckedInReceiver.save(store, "owner", "t1", "f1") shouldBe true
        store.checkedIn("owner", "t1").first() shouldBe setOf("f1")
    }

    @Test
    fun `says a mark that failed was not saved`() = runTest {
        val failing = object : TripStore by FakeTripStore() {
            override suspend fun setCheckedIn(uid: String, tripId: String, segmentId: String, checkedIn: Boolean) = throw IllegalStateException("offline")
        }
        CheckedInReceiver.save(failing, "owner", "t1", "f1") shouldBe false
    }
}
