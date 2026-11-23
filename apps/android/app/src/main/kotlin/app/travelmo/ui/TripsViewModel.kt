package app.travelmo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.travelmo.core.FlightStatus
import app.travelmo.core.FoundLoyalty
import app.travelmo.core.RideNeed
import app.travelmo.core.HomePeriod
import app.travelmo.core.effectiveHomes
import app.travelmo.core.homeTimeline
import app.travelmo.core.rideNeedKey
import app.travelmo.core.rideNeeds
import app.travelmo.core.PersonDocuments
import app.travelmo.core.flightRefreshDue
import app.travelmo.core.flightStatusKey
import app.travelmo.core.flightStatusLines
import app.travelmo.core.flightStatusShown
import app.travelmo.core.shownFlightKeys
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
import app.travelmo.core.AccountAccess
import app.travelmo.core.AddressHolder
import app.travelmo.core.LinkCheck
import app.travelmo.core.checkNewLink
import app.travelmo.core.myAddresses
import app.travelmo.data.AccessCheck
import app.travelmo.data.AccountDeletion
import app.travelmo.data.EmailLinkFailed
import app.travelmo.data.EmailLinks
import app.travelmo.data.NoEmailLinks
import app.travelmo.data.FlightRefresh
import app.travelmo.data.NoFlightRefresh
import app.travelmo.data.NoAccessCheck
import app.travelmo.data.NoAccountDeletion
import app.travelmo.data.OwnProfile
import app.travelmo.data.RideSettings
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
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
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
    /** The parser's account deletion; none by default. */
    private val accountDeletion: AccountDeletion = NoAccountDeletion,
    /** The parser's look at an open trip's flights; none by default. */
    private val flightRefresh: FlightRefresh = NoFlightRefresh,
    /** The parser's access check; none by default. */
    private val accessCheck: AccessCheck = NoAccessCheck,
    /** The parser's linking of email addresses; none by default. */
    private val emailLinks: EmailLinks = NoEmailLinks,
) : ViewModel() {
    /** The current instant, as pending email links are judged by. */
    fun now(): String = clock().toString()

    /** Today's date on this device, as grouping and the calendar read it. */
    fun today(): String = LocalDate.ofInstant(clock(), ZoneId.systemDefault()).toString()

    /** The current instant, refreshed each minute so "next up" lines move on as events pass. */
    private val now: Flow<String> = flow {
        while (true) {
            emit(clock().toString())
            delay(60_000)
        }
    }

    /**
     * Bumped once the access check has let the account in, so every query
     * the rules refused before then (SPEC "Access") is asked again: each
     * listener below restarts on it.
     */
    private val accessSettled = MutableStateFlow(0)

    /** What the user document says of the user's addresses; empty until it answers. */
    val addressHolder: StateFlow<AddressHolder> = store.addressHolder(uid).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AddressHolder())

    /**
     * Every address that is the user's (SPEC "Linked email addresses"): the
     * sign-in at once, those confirmed once the user document answers.
     */
    val addresses: StateFlow<List<String>> = addressHolder.map { myAddresses(email, it) }.distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), myAddresses(email, null))

    /** Every trip of the user's, own and shared with any of their addresses; null until the first answer. */
    val trips: StateFlow<List<Trip>?> = combine(accessSettled, addresses) { _, addresses -> addresses }
        .flatMapLatest { store.trips(uid, it) }.map<List<Trip>, List<Trip>?> { it }
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

    /** The profile document's answer; null until it has answered once. */
    private val ownProfileAnswer: StateFlow<OwnProfile?> = accessSettled.flatMapLatest { store.ownProfile(uid) }.map<OwnProfile, OwnProfile?> { it }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** The user's own travel profile; null while loading or when there is none. */
    val ownProfile: StateFlow<TravelProfile?> = ownProfileAnswer.map { it?.profile }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Whether the profile document has answered, so sharing knows what list it is replacing. */
    val profileLoaded: StateFlow<Boolean> = ownProfileAnswer.map { it != null }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    /** The profiles shared with the user. */
    val sharedProfiles: StateFlow<List<TravelProfile>> = combine(accessSettled, addresses) { _, addresses -> addresses }
        .flatMapLatest { store.sharedProfiles(it) }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Whose documents a trip may need: the user's and those of people who shared their profile. */
    val people: StateFlow<List<PersonDocuments>> = combine(ownProfile, sharedProfiles) { own, shared -> peopleDocuments(own, shared, uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    init {
        // Once per signed-in view model (SPEC "Access"): the parser lets in
        // an account from before approvals that the rules cannot tell is
        // one. The rules refuse its queries until then: the trips and shared
        // profiles load empty and the profile never answers. An account
        // whose trips came back empty may be one, so its queries are asked
        // again once it is in.
        viewModelScope.launch {
            if (accessCheck.check() == AccountAccess.APPROVED && trips.value.isNullOrEmpty()) accessSettled.update { it + 1 }
        }
    }

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

    /**
     * The live status of a trip's flights near departure, by flight key: a
     * listener per flight, only for the few within a day or so, re-chosen
     * each minute as flights come into and go out of range.
     */
    fun flightStatuses(tripId: String): Flow<Map<String, FlightStatus>> =
        combine(store.segments(tripId), now) { segments, now -> shownFlightKeys(segments, now) }
            .distinctUntilChanged()
            .flatMapLatest { keys ->
                if (keys.isEmpty()) {
                    flowOf(emptyMap())
                } else {
                    combine(keys.map { key -> store.flightStatus(key).map { key to it } }) { pairs ->
                        pairs.mapNotNull { (key, status) -> status?.let { key to it } }.toMap()
                    }
                }
            }

    /** What a flight's row says of its gates and carousel now. */
    fun flightLines(segment: Segment, statuses: Map<String, FlightStatus>): List<String> {
        if (!flightStatusShown(segment, clock().toString())) return emptyList()
        return flightStatusKey(segment)?.let { flightStatusLines(statuses[it]) }.orEmpty()
    }

    /**
     * Has the trip's flights looked at when one is due a look (at most once
     * a minute, from six hours before departure); the open trip page calls
     * this every minute while it is in front.
     */
    suspend fun refreshFlights(tripId: String) {
        val now = clock().toString()
        val due = store.segments(tripId).first().any { segment ->
            val key = flightStatusKey(segment)
            key != null && flightStatusShown(segment, now) && flightRefreshDue(segment, store.flightStatus(key).first(), now)
        }
        if (due) flightRefresh.refresh(tripId)
    }

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
    // `operation` is a fixed name for the logs; the token can carry user
    // data (an address being unshared, a loyalty number), so it never goes there.
    private fun run(token: String, operation: String, block: suspend () -> Unit) {
        if (_outcomes.value[token] is Outcome.Busy) return
        _outcomes.update { it + (token to Outcome.Busy) }
        viewModelScope.launch {
            val outcome = try {
                block()
                Outcome.Done
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                TravelmoLog.error(e, "$operation failed")
                Outcome.Failed(e.message ?: e.javaClass.simpleName)
            }
            _outcomes.update { it + (token to outcome) }
        }
    }

    /** The screen with `token` has acted on its write's outcome. */
    fun outcomeSeen(token: String) {
        _outcomes.update { it - token }
    }

    fun saveSegment(token: String, tripId: String, draft: SegmentDraft, existingId: String?) = run(token, "saveSegment") { store.saveSegment(tripId, draft, existingId) }

    fun deleteSegment(token: String, tripId: String, segmentId: String) = run(token, "deleteSegment") { store.deleteSegment(tripId, segmentId) }

    fun restoreSegment(token: String, tripId: String, segmentId: String) = run(token, "restoreSegment") { store.restoreSegment(tripId, segmentId) }

    fun moveSegment(token: String, fromTripId: String, segmentId: String, toTripId: String) = run(token, "moveSegment") { store.moveSegment(fromTripId, segmentId, toTripId) }

    fun renameTrip(token: String, tripId: String, title: String) = run(token, "renameTrip") {
        if (title.isBlank()) throw IllegalArgumentException("Give the trip a name")
        store.renameTrip(tripId, title)
    }

    fun fitTripDates(token: String, tripId: String) = run(token, "fitTripDates") { store.fitTripDates(tripId) }

    fun shareTrip(token: String, tripId: String, email: String) = run(token, "shareTrip") { store.shareTrip(tripId, email) }

    fun unshareTrip(token: String, tripId: String, email: String) = run(token, "unshareTrip") { store.unshareTrip(tripId, email) }

    fun deleteTrip(token: String, tripId: String) = run(token, "deleteTrip") { store.deleteTrip(tripId) }

    fun mergeTrips(token: String, sourceId: String, targetId: String) = run(token, "mergeTrips") { store.mergeTrips(sourceId, targetId) }

    /** The Gmail account the user connected for importing, for source links; null when none. */
    val gmailAccount: StateFlow<String?> = store.gmailAccount(uid).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Whether reminders by email are on; null until the user document answers. */
    val reminderEmail: StateFlow<Boolean?> = store.reminderEmail(uid).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun setReminderEmail(token: String, on: Boolean) = run(token, "setReminderEmail") { store.setReminderEmail(uid, on) }

    /** The user's ride companies, hidden suggestions and home corrections; null until the user document answers. */
    val rideSettings: StateFlow<RideSettings?> = accessSettled.flatMapLatest { store.rideSettings(uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * Home over time for the reports' residence and visa days: worked out
     * from the user's own trips, with their corrections over it, as the
     * Profile and the web's reports page work it out; null until both answer.
     */
    val reportHomes: StateFlow<List<HomePeriod>?> = combine(reportTrips, rideSettings) { trips, settings ->
        if (trips == null || settings == null) null else effectiveHomes(homeTimeline(trips.filter { it.trip.ownerUid == uid }.flatMap { it.segments }), settings.homes)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * A trip's flights with no car or ride booked (SPEC "Car and ride
     * suggestions"): home is the trip's own round trip unless the user
     * corrected it, as on the web.
     */
    fun rideNeedsFor(segments: List<Segment>, settings: RideSettings?): List<RideNeed> {
        if (settings == null) return emptyList()
        val periods = effectiveHomes(homeTimeline(segments), settings.homes)
        return rideNeeds(segments, periods, clock().toString(), hidden = settings.hidden)
    }

    fun hideRideNeed(token: String, need: RideNeed) = run(token, "hideRideNeed") { store.hideRideNeed(uid, rideNeedKey(need)) }

    /** Removes a loyalty number found in the user's emails from their profile. */
    fun removeFoundLoyalty(token: String, found: FoundLoyalty) = run(token, "removeFoundLoyalty") {
        try {
            store.removeFoundLoyalty(uid, found)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Logged by kind only: the number is the user's.
            TravelmoLog.error(e, "Removing a loyalty number found in emails failed")
            throw e
        }
    }

    fun setLoyaltyPerson(token: String, program: String, number: String, person: String?) = run(token, "setLoyaltyPerson") {
        try {
            store.setLoyaltyPerson(uid, program, number, person)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Logged by kind only: the number and the name are the user's.
            TravelmoLog.error(e, "Saving whose a loyalty number is failed")
            throw e
        }
    }

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
    fun setPushDevice(token: String, on: Boolean) = run(token, "setPushDevice") {
        val messagingToken = pushDevice.latest.value ?: throw IllegalStateException("This phone has no messaging token")
        val id = deviceId(messagingToken)
        if (on) store.registerDevice(uid, id, messagingToken) else store.unregisterDevice(uid, id)
        pushDevice.remember(uid, if (on) id else null)
    }

    /** Whether this build can delete the account here; without a parser address, Settings points to the web. */
    val canDeleteAccount: Boolean
        get() = accountDeletion.available

    /**
     * Deletes the account through the parser, then [signOut]. Both run in
     * this scope, so signing out, which takes Settings off the screen, is
     * not cut short with it. A failure leaves the user signed in to retry.
     */
    fun deleteAccount(token: String, signOut: suspend () -> Unit) = run(token, "deleteAccount") {
        accountDeletion.deleteAccount()
        signOut()
    }

    /** Whether this build can change the linked addresses here; without a parser address, Settings only lists them. */
    val canLinkEmails: Boolean
        get() = emailLinks.available

    /** Mails a confirmation link to another address of the user's; a refusal the app can tell is said at once. */
    fun addEmail(token: String, raw: String) = run(token, "addEmail") {
        when (val check = checkNewLink(raw, email, addressHolder.value, clock().toString())) {
            is LinkCheck.Refused -> throw EmailLinkFailed(check.refusal.text)
            is LinkCheck.Ok -> emailLinks.add(check.email)
        }
    }

    /** Unlinks a confirmed address, or withdraws a pending one. */
    fun removeEmail(token: String, address: String) = run(token, "removeEmail") { emailLinks.remove(address) }

    /** Who the user's travel profile is shared with; the profile is started if none has arrived yet. */
    fun saveTrusted(token: String, emails: List<String>) = run(token, "saveTrusted") {
        val answer = ownProfileAnswer.value ?: throw IllegalStateException("The profile is still loading; try again")
        store.saveTrusted(uid, email, exists = answer.profile != null, emails = emails)
    }
}
