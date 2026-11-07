package app.travelmo.ui

import app.travelmo.core.SegmentDraft
import app.travelmo.core.SegmentType
import app.travelmo.data.TripStore
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TripsViewModelTest {
    /** A store whose save waits to be let through, or fails, as the test says. */
    private class GatedStore(private val fail: Boolean = false) : TripStore by FakeTripStore() {
        val gate = CompletableDeferred<Unit>()
        var saves = 0
        override suspend fun saveSegment(tripId: String, draft: SegmentDraft, existingId: String?) {
            saves++
            gate.await()
            if (fail) throw IllegalStateException("Trip no longer exists")
        }
    }

    private val draft = SegmentDraft(SegmentType.ACTIVITY, "Walk", null, null, "2026-12-12T10:00:00Z", null, null, null, null)

    @BeforeEach
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterEach
    fun reset() = Dispatchers.resetMain()

    @Test
    fun `a save is busy for its form, then done once, and a second tap meanwhile saves nothing`() = runTest {
        val store = GatedStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.saveSegment("form-1", "liverpool", draft, null)
        viewModel.outcomes.value shouldBe mapOf("form-1" to Outcome.Busy)
        viewModel.saveSegment("form-1", "liverpool", draft, null)
        store.saves shouldBe 1
        store.gate.complete(Unit)
        viewModel.outcomes.value shouldBe mapOf("form-1" to Outcome.Done)
        viewModel.outcomeSeen("form-1")
        viewModel.outcomes.value shouldBe emptyMap()
    }

    @Test
    fun `one form's pending save does not swallow another form's`() = runTest {
        val store = GatedStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.saveSegment("form-1", "liverpool", draft, null)
        viewModel.saveSegment("form-2", "liverpool", draft, "l-stay")
        store.saves shouldBe 2
        viewModel.outcomes.value shouldBe mapOf("form-1" to Outcome.Busy, "form-2" to Outcome.Busy)
        store.gate.complete(Unit)
        viewModel.outcomes.value shouldBe mapOf("form-1" to Outcome.Done, "form-2" to Outcome.Done)
    }

    @Test
    fun `a trip edit runs the same way, and a blank name is refused before the store sees it`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.renameTrip("rename", "liverpool", "  ")
        viewModel.outcomes.value shouldBe mapOf("rename" to Outcome.Failed("Give the trip a name"))
        viewModel.renameTrip("rename", "liverpool", "Merseyside")
        viewModel.outcomes.value shouldBe mapOf("rename" to Outcome.Done)
        store.renamed shouldBe listOf("liverpool" to "Merseyside")
        viewModel.mergeTrips("merge", "dublin", "liverpool")
        viewModel.deleteTrip("delete", "paris")
        store.merged shouldBe listOf("dublin" to "liverpool")
        store.deletedTrips shouldBe listOf("paris")
    }

    @Test
    fun `sharing the profile says whether it exists yet, and waits until that is known`() = runTest {
        val store = FakeTripStore(profile = null)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        // Before the profile document has answered, nothing is written.
        viewModel.saveTrusted("share", listOf("partner@example.com"))
        store.trusted shouldBe emptyList()
        viewModel.outcomes.value shouldBe mapOf("share" to Outcome.Failed("The profile is still loading; try again"))
        val watching = backgroundScope.launch { viewModel.profileLoaded.collect {} }
        runCurrent()
        viewModel.profileLoaded.value shouldBe true
        viewModel.saveTrusted("share", listOf("partner@example.com"))
        store.trusted shouldBe listOf(Triple(OWNER, false, listOf("partner@example.com")))
        viewModel.outcomes.value shouldBe mapOf("share" to Outcome.Done)
        watching.cancel()
    }

    @Test
    fun `the reminders switch writes the choice and reads the stored one`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        viewModel.setReminderEmail("reminders", false)
        store.reminders shouldBe listOf(false)
        viewModel.outcomes.value shouldBe mapOf("reminders" to Outcome.Done)
    }

    @Test
    fun `a failed save says why, to the form that asked`() = runTest {
        val store = GatedStore(fail = true)
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.saveSegment("form-2", "liverpool", draft, "l-stay")
        store.gate.complete(Unit)
        viewModel.outcomes.value shouldBe mapOf("form-2" to Outcome.Failed("Trip no longer exists"))
    }
}
