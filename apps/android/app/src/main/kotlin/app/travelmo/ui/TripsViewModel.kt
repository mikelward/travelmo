package app.travelmo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.travelmo.core.PersonDocuments
import app.travelmo.core.ListWarning
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.TravelProfile
import app.travelmo.core.peopleDocuments
import app.travelmo.core.tripWarnings
import app.travelmo.core.Trip
import app.travelmo.core.TripGroups
import app.travelmo.core.TripWithSegments
import app.travelmo.core.groupTrips
import app.travelmo.core.listWarnings
import app.travelmo.core.deviceId
import app.travelmo.data.OwnProfile
import app.travelmo.data.TripStore
import app.travelmo.log.TravelmoLog
import app.travelmo.notify.NoPushDevice
import app.travelmo.notify.PushDevice
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The trip list as the screen draws it; null groups while the first answer is on its way. */
data class TripListState(
    val groups: TripGroups?,
    val segmentsByTrip: Map<String, List<Segment>>,
    val now: String,
    /** Document warnings once, for the list's top: each document for the earliest trip it bears on. */
    val warnings: List<ListWarning> = emptyList(),
)

/** How a write asked for by a screen is going, as that screen sees it. */
sealed interface Outcome {
    data object Busy : Outcome

    data object Done : Outcome

    data class Failed(val message: String) : Outcome
}

/** How many upcoming trips get a segment listener for their "next up" line, as on the web. */
const val UPCOMING_WITH_DETAILS = 3

/** Reminders as notifications on this phone, as Settings shows them. */
sealed interface PushState {
    /** No token: Firebase dormant or Play services missing. The switch does not show. */
    data object Unavailable : PushState

    /** The phone has a token and is, or is not, registered under this user. */
    data class Ready(val on: Boolean) : PushState
}

@OptIn(ExperimentalCoroutinesApi::class)
class TripsViewModel(
    private val store: TripStore,
    private val uid: String,
    private val email: String?,
    /** The clock, replaceable so a test renders a fixed moment. */
    private val clock: () -> Instant = { Instant.now() },
    /** This phone's messaging token and registration memory; none by default. */
    private val pushDevice: PushDevice = NoPushDevice,
) : ViewModel() {
    /** Today's date on this device, as grouping and the calendar read it. */
    fun today(): String = LocalDate.ofInstant(clock(), ZoneId.systemDefault()).toString()

    /** The current instant, refreshed each minute so "next up" lines move on as events pass. */
    private val now: Flow<String> = flow {
        while (true) {
            emit(clock().toString())
            delay(60_000)
        }
    }

    /** Every trip of the user's, own and shared; null until the first answer. */
    val trips: StateFlow<List<Trip>?> = store.trips(uid, email).map<List<Trip>, List<Trip>?> { it }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val groups: Flow<TripGroups?> = combine(trips, now) { trips, _ -> trips?.let { groupTrips(it, today()) } }

    private val details: Flow<Map<String, List<Segment>>> = groups.flatMapLatest { groups ->
        val wanted = groups?.let { it.current + it.upcoming.take(UPCOMING_WITH_DETAILS) }.orEmpty()
        if (wanted.isEmpty()) {
            flowOf(emptyMap())
        } else {
            combine(wanted.map { trip -> store.segments(trip.id).map { trip.id to it } }) { it.toMap() }
        }
    }

    /** The user's own travel profile; null while loading or when there is none. */
    /** The profile document's answer; null until it has answered once. */
    private val ownProfileAnswer: StateFlow<OwnProfile?> = store.ownProfile(uid).map<OwnProfile, OwnProfile?> { it }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val ownProfile: StateFlow<TravelProfile?> = ownProfileAnswer.map { it?.profile }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Whether the profile document has answered, so sharing knows what list it is replacing. */
    val profileLoaded: StateFlow<Boolean> = ownProfileAnswer.map { it != null }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    /** The profiles shared with the user. */
    val sharedProfiles: StateFlow<List<TravelProfile>> = store.sharedProfiles(email).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Whose documents a trip may need: the user's and those of people who shared their profile. */
    val people: StateFlow<List<PersonDocuments>> = combine(ownProfile, sharedProfiles) { own, shared -> peopleDocuments(own, shared, uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val state: StateFlow<TripListState> = combine(groups, details, now, people) { groups, details, now, people ->
        val today = today()
        val trips = groups?.let { it.current + it.upcoming + it.past }.orEmpty()
        val byTrip = trips.filter { it.id in details }.associate { trip -> trip.id to tripWarnings(people, trip, details[trip.id], today) }
        TripListState(groups, details, now, listWarnings(byTrip, trips))
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TripListState(null, emptyMap(), clock().toString()))


    /**
     * Every trip the viewer sees with its bookings, for the reports: one
     * listener per trip, as the web's reports page keeps; null until the
     * trips and each one's bookings have answered.
     */
    val reportTrips: StateFlow<List<TripWithSegments>?> = trips.flatMapLatest { list ->
        when {
            list == null -> flowOf(null)
            list.isEmpty() -> flowOf(emptyList())
            else -> combine(list.map { trip -> store.segments(trip.id).map { TripWithSegments(trip, it) } }) { it.toList() }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** One trip, or null once the list has answered without it. */
    fun trip(id: String): Flow<Trip?> = trips.map { trips -> trips?.firstOrNull { it.id == id } }

    fun segments(tripId: String): Flow<List<Segment>> = store.segments(tripId)

    private val _outcomes = MutableStateFlow<Map<String, Outcome>>(emptyMap())

    /** Each write asked for by a screen, by the token it chose, until that screen has seen the outcome. */
    val outcomes: StateFlow<Map<String, Outcome>> = _outcomes.asStateFlow()

    /**
     * Runs a write in this scope rather than the screen's: a rotation
     * recreates the screen but not this, so the outcome still reaches it
     * under its token, and a second tap while the write is in flight does
     * nothing rather than write twice. Outcomes are kept per token, so one
     * screen's pending write never swallows another's.
     */
    private fun run(token: String, block: suspend () -> Unit) {
        if (_outcomes.value[token] is Outcome.Busy) return
        _outcomes.update { it + (token to Outcome.Busy) }
        viewModelScope.launch {
            val outcome = try {
                block()
                Outcome.Done
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Outcome.Failed(e.message ?: e.javaClass.simpleName)
            }
            _outcomes.update { it + (token to outcome) }
        }
    }

    /** The screen with `token` has acted on its write's outcome. */
    fun outcomeSeen(token: String) {
        _outcomes.update { it - token }
    }

    fun saveSegment(token: String, tripId: String, draft: SegmentDraft, existingId: String?) = run(token) { store.saveSegment(tripId, draft, existingId) }

    fun deleteSegment(token: String, tripId: String, segmentId: String) = run(token) { store.deleteSegment(tripId, segmentId) }

    fun moveSegment(token: String, fromTripId: String, segmentId: String, toTripId: String) = run(token) { store.moveSegment(fromTripId, segmentId, toTripId) }

    fun renameTrip(token: String, tripId: String, title: String) = run(token) {
        if (title.isBlank()) throw IllegalArgumentException("Give the trip a name")
        store.renameTrip(tripId, title)
    }

    fun fitTripDates(token: String, tripId: String) = run(token) { store.fitTripDates(tripId) }

    fun shareTrip(token: String, tripId: String, email: String) = run(token) { store.shareTrip(tripId, email) }

    fun unshareTrip(token: String, tripId: String, email: String) = run(token) { store.unshareTrip(tripId, email) }

    fun deleteTrip(token: String, tripId: String) = run(token) { store.deleteTrip(tripId) }

    fun mergeTrips(token: String, sourceId: String, targetId: String) = run(token) { store.mergeTrips(sourceId, targetId) }

    /** Whether reminders by email are on; null until the user document answers. */
    val reminderEmail: StateFlow<Boolean?> = store.reminderEmail(uid).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun setReminderEmail(token: String, on: Boolean) = run(token) { store.setReminderEmail(uid, on) }

    /**
     * This phone's messaging token is asked for once per view model, and a
     * registration remembered under an older token is moved to it (a refresh
     * that happened while the app was not running, or whose write failed).
     */
    private val tokenAnswered: StateFlow<Boolean> = flow {
        val token = pushDevice.token()
        if (token != null) {
            try {
                pushDevice.tokenChanged(store, uid, token)
            } catch (e: Exception) {
                TravelmoLog.error(e, "Moving the registration to the current token failed")
            }
        }
        emit(true)
    }.stateIn(viewModelScope, SharingStarted.Lazily, false)

    /**
     * Reminders as notifications on this phone: unavailable without a token,
     * else whether the phone is registered under this user, live from its
     * document, following the token when Messaging rotates it; null until
     * the token and the document have both answered.
     */
    val pushState: StateFlow<PushState?> = combine(tokenAnswered, pushDevice.latest) { answered, token -> answered to token }
        .flatMapLatest { (answered, token) ->
            when {
                !answered -> flowOf(null)
                token == null -> flowOf(PushState.Unavailable)
                else -> store.pushDevice(uid, deviceId(token)).map { on -> on?.let { PushState.Ready(it) } }
            }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Turns reminders as notifications on this phone on or off; the permission is the screen's to ask for first. */
    fun setPushDevice(token: String, on: Boolean) = run(token) {
        val messagingToken = pushDevice.latest.value ?: throw IllegalStateException("This phone has no messaging token")
        val id = deviceId(messagingToken)
        if (on) store.registerDevice(uid, id, messagingToken) else store.unregisterDevice(uid, id)
        pushDevice.remember(uid, if (on) id else null)
    }

    /** Who the user's travel profile is shared with; the profile is started if none has arrived yet. */
    fun saveTrusted(token: String, emails: List<String>) = run(token) {
        val answer = ownProfileAnswer.value ?: throw IllegalStateException("The profile is still loading; try again")
        store.saveTrusted(uid, email, exists = answer.profile != null, emails = emails)
    }
}
