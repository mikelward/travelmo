package app.travelmo.ui

import app.travelmo.core.SegmentDraft
import app.travelmo.core.SegmentType
import app.travelmo.data.TripStore
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
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
        viewModel.bookingSaves.value shouldBe mapOf("form-1" to BookingSave.Busy)
        viewModel.saveSegment("form-1", "liverpool", draft, null)
        store.saves shouldBe 1
        store.gate.complete(Unit)
        viewModel.bookingSaves.value shouldBe mapOf("form-1" to BookingSave.Done)
        viewModel.bookingSaveSeen("form-1")
        viewModel.bookingSaves.value shouldBe emptyMap()
    }

    @Test
    fun `one form's pending save does not swallow another form's`() = runTest {
        val store = GatedStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.saveSegment("form-1", "liverpool", draft, null)
        viewModel.saveSegment("form-2", "liverpool", draft, "l-stay")
        store.saves shouldBe 2
        viewModel.bookingSaves.value shouldBe mapOf("form-1" to BookingSave.Busy, "form-2" to BookingSave.Busy)
        store.gate.complete(Unit)
        viewModel.bookingSaves.value shouldBe mapOf("form-1" to BookingSave.Done, "form-2" to BookingSave.Done)
    }

    @Test
    fun `a failed save says why, to the form that asked`() = runTest {
        val store = GatedStore(fail = true)
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.saveSegment("form-2", "liverpool", draft, "l-stay")
        store.gate.complete(Unit)
        viewModel.bookingSaves.value shouldBe mapOf("form-2" to BookingSave.Failed("Trip no longer exists"))
    }
}
