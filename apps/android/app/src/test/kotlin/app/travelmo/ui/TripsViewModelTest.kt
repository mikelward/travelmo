package app.travelmo.ui

import app.travelmo.core.SegmentDraft
import app.travelmo.core.deviceId
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
    fun `the notifications switch registers this phone under the user and forgets it again`() = runTest {
        val store = FakeTripStore()
        val device = FakePushDevice()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, pushDevice = device)
        val watching = backgroundScope.launch { viewModel.pushState.collect {} }
        runCurrent()
        viewModel.pushState.value shouldBe PushState.Ready(on = false)
        viewModel.setPushDevice("push", true)
        runCurrent()
        val id = deviceId("fcm-token-1")
        store.devices shouldBe listOf(id to "fcm-token-1")
        device.remembered(OWNER) shouldBe id
        viewModel.outcomes.value shouldBe mapOf("push" to Outcome.Done)
        viewModel.setPushDevice("push", false)
        runCurrent()
        store.devices shouldBe listOf(id to "fcm-token-1", id to null)
        device.remembered(OWNER) shouldBe null
        watching.cancel()
    }

    @Test
    fun `without a messaging token the notifications switch is unavailable`() = runTest {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, pushDevice = FakePushDevice(token = null))
        val watching = backgroundScope.launch { viewModel.pushState.collect {} }
        runCurrent()
        viewModel.pushState.value shouldBe PushState.Unavailable
        viewModel.setPushDevice("push", true)
        runCurrent()
        viewModel.outcomes.value shouldBe mapOf("push" to Outcome.Failed("This phone has no messaging token"))
        watching.cancel()
    }

    @Test
    fun `a refreshed token replaces the registration it had, and none it did not`() = runTest {
        val store = FakeTripStore()
        val device = FakePushDevice()
        device.tokenChanged(store, OWNER, "fcm-token-2")
        store.devices shouldBe emptyList()
        device.remember(OWNER, deviceId("fcm-token-1"))
        device.tokenChanged(store, OWNER, "fcm-token-2")
        store.devices shouldBe listOf(deviceId("fcm-token-2") to "fcm-token-2", deviceId("fcm-token-1") to null)
        device.remembered(OWNER) shouldBe deviceId("fcm-token-2")
    }

    @Test
    fun `the switch follows a token rotated while it is on screen, and a registration left under an old token moves on load`() = runTest {
        val store = FakeTripStore()
        val device = FakePushDevice(token = "fcm-token-2")
        // Registered under an older token, as a refresh in a dead process leaves it.
        store.registerDevice(OWNER, deviceId("fcm-token-1"), "fcm-token-1")
        device.remember(OWNER, deviceId("fcm-token-1"))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, pushDevice = device)
        val watching = backgroundScope.launch { viewModel.pushState.collect {} }
        runCurrent()
        device.remembered(OWNER) shouldBe deviceId("fcm-token-2")
        store.devices.last() shouldBe (deviceId("fcm-token-1") to null)
        viewModel.pushState.value shouldBe PushState.Ready(on = true)
        // Rotated again while Settings is open: the state and the switch use the new token.
        device.tokenChanged(store, OWNER, "fcm-token-3")
        runCurrent()
        viewModel.pushState.value shouldBe PushState.Ready(on = true)
        viewModel.setPushDevice("push", false)
        runCurrent()
        store.devices.last() shouldBe (deviceId("fcm-token-3") to null)
        watching.cancel()
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
