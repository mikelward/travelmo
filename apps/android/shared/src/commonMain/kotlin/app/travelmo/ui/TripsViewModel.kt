package app.travelmo.ui

import app.travelmo.core.JourneyGap
import app.travelmo.core.LookResult
import app.travelmo.core.journeyGapKey
import app.travelmo.core.journeyGaps
import app.travelmo.core.journeyGapHomes
import app.travelmo.core.displayTitles
import app.travelmo.core.journeyGapText
import app.travelmo.core.warmTables
import app.travelmo.core.homeTownKey
import app.travelmo.core.ChosenHomeAirports
import app.travelmo.core.withHomeAirports
import app.travelmo.core.withChosenAirports
import app.travelmo.core.tripMatches
import app.travelmo.core.parseTripQuery
import app.travelmo.core.ListFilters
import app.travelmo.core.hiddenFromList
import app.travelmo.core.watchedTrip
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.shareIn
import app.travelmo.core.tripTravelers
import app.travelmo.core.watching
import app.travelmo.core.tripDraftProblem
import app.travelmo.core.senderCleanup
import app.travelmo.core.SenderCleanup
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.travelmo.core.RefreshShown
import app.travelmo.core.FlightStatus
import app.travelmo.core.ImapServerChoice
import app.travelmo.core.MAX_IMAP_MAILBOXES
import app.travelmo.core.imapRedirect
import app.travelmo.core.imapServerFor
import app.travelmo.core.parseImapServer
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
import app.travelmo.core.nextUpFlightKeys
import app.travelmo.core.ListWarning
import app.travelmo.core.Person
import app.travelmo.core.Segment
import app.travelmo.core.peopleInOrder
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
import app.travelmo.core.AccessConfig
import app.travelmo.core.AccessLists
import app.travelmo.core.AccessRecord
import app.travelmo.core.AccountAccess
import app.travelmo.core.AddressHolder
import app.travelmo.core.accessLists
import app.travelmo.core.accessStatus
import app.travelmo.core.emailAddressOf
import app.travelmo.core.isAdmin
import app.travelmo.core.linkedEmails
import app.travelmo.data.Seen
import app.travelmo.data.InMemoryListFilterStore
import app.travelmo.data.CountingStore
import app.travelmo.data.InMemoryCountingStore
import app.travelmo.data.InMemoryReportSnapshotStore
import app.travelmo.data.ListFilterStore
import app.travelmo.data.ReportSnapshotStore
import app.travelmo.data.decodeReportSnapshot
import app.travelmo.data.encodeReportSnapshot
import app.travelmo.core.LinkCheck
import app.travelmo.core.checkNewLink
import app.travelmo.core.CountryCounting
import app.travelmo.core.TravelReport
import app.travelmo.core.checklistShown
import app.travelmo.core.myAddresses
import app.travelmo.data.AccessCheck
import app.travelmo.data.AccountDeletionUnfinished
import app.travelmo.data.AccountDeletion
import app.travelmo.data.EmailLinkFailed
import app.travelmo.data.EmailLinks
import app.travelmo.data.NoEmailLinks
import app.travelmo.data.FlightRefresh
import app.travelmo.data.NoFlightRefresh
import app.travelmo.data.NoAccessCheck
import app.travelmo.data.NoAccountDeletion
import app.travelmo.core.isReading
import app.travelmo.core.BackfillShown
import app.travelmo.core.GmailMailbox
import app.travelmo.core.MAX_GMAIL_MAILBOXES
import app.travelmo.data.NoGmailActions
import app.travelmo.data.GmailActions
import app.travelmo.data.GoogleCalendarShown
import app.travelmo.data.NoGoogleCalendarActions
import app.travelmo.data.GoogleCalendarActions
import app.travelmo.data.CalendarExportShown
import app.travelmo.data.NoCalendarExportActions
import app.travelmo.data.CalendarExportActions
import app.travelmo.data.CalendarFeedShown
import app.travelmo.data.NoFeedActions
import app.travelmo.data.FeedActions
import app.travelmo.data.Forwarding
import app.travelmo.data.NoForwardActions
import app.travelmo.data.ForwardActions
import app.travelmo.core.HomeCorrection
import app.travelmo.core.RideCompany
import app.travelmo.core.exportLinks
import app.travelmo.core.ExportLinks
import app.travelmo.data.FastmailActions
import app.travelmo.data.NoFastmailActions
import app.travelmo.data.ImapActions
import app.travelmo.data.NoImapActions
import app.travelmo.core.SenderPatterns
import app.travelmo.core.cleanSenderList
import app.travelmo.core.SenderList
import app.travelmo.core.ParsedRecord
import app.travelmo.core.fittingTrip
import kotlinx.coroutines.flow.onEach
import app.travelmo.core.tripFlagsToWrite
import app.travelmo.core.flagsUnknown
import app.travelmo.data.SearchedRecords
import app.travelmo.data.NoImportReview
import app.travelmo.data.ImportReview
import app.travelmo.data.TripActions
import app.travelmo.data.NoTripActions
import app.travelmo.data.OwnProfile
import app.travelmo.data.RideSettings
import app.travelmo.data.MyChecklist
import app.travelmo.core.ChecklistEntry
import app.travelmo.core.Reminder
import app.travelmo.core.isInternational
import app.travelmo.core.shownEnd
import app.travelmo.core.tripChecklist
import app.travelmo.data.TripStore
import app.travelmo.logging.SharedLog
import app.travelmo.logging.safe
import app.travelmo.notify.NoPushDevice
import app.travelmo.notify.PushDevice
import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
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
/** The trips a search found, by id; [bookingsSearched] once their bookings were searched too, not only titles and dates. */
data class TripSearchResult(val ids: Set<String>, val bookingsSearched: Boolean)

data class TripListState(
    val groups: TripGroups?,
    val segmentsByTrip: Map<String, List<Segment>>,
    val now: String,
    /** Document warnings once, for the list's top: each document for the earliest trip it bears on. */
    val warnings: List<ListWarning> = emptyList(),
    /** The live status of the next flight of each trip under way, by flight key ([nextUpFlightKeys]). */
    val flightStatuses: Map<String, FlightStatus> = emptyMap(),
    /** The bookings the user marked "I've checked in" on each trip under way, by trip; a trip still loading has none. */
    val checkedIn: Map<String, Set<String>> = emptyMap(),
    /** Each trip's title as the list shows it ([displayTitles]), by trip. */
    val titles: Map<String, String> = emptyMap(),
    /** The journey each trip whose bookings are read seems to be missing, said ("No flight from Boston back to London found"), by trip. */
    val missing: Map<String, String> = emptyMap(),
)

/** How a write asked for by a screen is going, as that screen sees it. */
sealed interface Outcome {
    data object Busy : Outcome

    data object Done : Outcome

    data class Failed(val message: String) : Outcome
}

/** Where the signed-in account stands (SPEC "Access"), as the web's useAccess tells it. */
sealed interface AccessState {
    /** Not known yet: a "not approved" answer from this phone's cache waits for the server's word. */
    data object Loading : AccessState

    /**
     * [admin]: the account's sign-in or a linked address is in `config/access`
     * ([admins], which admins alone may read); [hasProfile]: `users/{uid}`
     * exists; [record]: the verified address's `access/{email}`.
     */
    data class Known(
        val status: AccountAccess,
        val admin: Boolean,
        val hasProfile: Boolean,
        val record: AccessRecord?,
        val admins: List<String> = emptyList(),
    ) : AccessState
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
    private val clock: () -> Instant = { Clock.System.now() },
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
    /** The parser's regrouping and deleting of all trips; none by default. */
    private val tripActions: TripActions = NoTripActions,
    /** The parser's "Import anyway" for Import review; none by default. */
    private val importReview: ImportReview = NoImportReview,
    /** The parser's Gmail connection and mailbox reading; none by default. */
    private val gmailActions: GmailActions = NoGmailActions,
    /** The parser's Fastmail connection and mailbox reading; none by default. */
    private val fastmailActions: FastmailActions = NoFastmailActions,
    /** The parser's IMAP connections and mailbox readings; none by default. */
    private val imapActions: ImapActions = NoImapActions,
    /** The parser's Google Calendar connection; none by default. */
    private val googleCalendarActions: GoogleCalendarActions = NoGoogleCalendarActions,
    /** The parser's calendar export link; none by default. */
    private val calendarExportActions: CalendarExportActions = NoCalendarExportActions,
    /** The parser's address, for the export link's URL (BuildConfig.PARSER_URL); none by default. */
    private val parserUrl: String = "",
    /** The parser's calendar feeds; none by default. */
    private val feedActions: FeedActions = NoFeedActions,
    /** The parser's forwarding address; none by default. */
    private val forwardActions: ForwardActions = NoForwardActions,
    /** Whether this build's deployment has a forwarding domain (BuildConfig.FORWARD_DOMAIN). */
    private val forwardOffered: Boolean = false,
    /** Whether Google verified [email]: only a verified address has an access record. */
    emailVerified: Boolean = true,
    /** Where the trip list's filters are kept; in memory by default. */
    private val listFilterStore: ListFilterStore = InMemoryListFilterStore(),
    private val countingStore: CountingStore = InMemoryCountingStore(),
    /** Where Reports' last counts and map are kept, to draw at once next time; in memory by default. */
    private val reportSnapshotStore: ReportSnapshotStore = InMemoryReportSnapshotStore(),
    /**
     * Where the trip list's state is worked out: the app passes Dispatchers.Default, so the main thread only draws.
     * Null works it out where the flows run, on the main thread, as tests want for a frame they can wait for.
     */
    private val compute: CoroutineDispatcher? = null,
) : ViewModel() {
    /** The verified sign-in address, normalized, as access is decided on it; null when unverified. */
    val verifiedEmail: String? = emailAddressOf(email)?.takeIf { emailVerified }

    /** The current instant, as pending email links are judged by. */
    fun now(): String = clock().toString()

    /** Today's date on this device, as grouping and the calendar read it. */
    fun today(): String = clock().toLocalDateTime(TimeZone.currentSystemDefault()).date.toString()

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

    // Listened to again only when which trips they are changes: the groups are
    // worked out afresh each minute and on every change to any trip, and
    // re-attaching every listener then rebuilt the cards under the user's finger.
    private val details: Flow<Map<String, List<Segment>>> = groups
        .map { groups -> groups?.let { it.current + it.upcoming.take(UPCOMING_WITH_DETAILS) }.orEmpty().map { it.id } }
        .distinctUntilChanged()
        .flatMapLatest { wanted ->
            if (wanted.isEmpty()) {
                flowOf(emptyMap())
            } else {
                combine(wanted.map { id -> store.segments(id).map { id to it } }) { it.toMap() }
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

    /** The user document as access reads it: null until it answers, a [Seen] of null when there is none. */
    private val userDocument: StateFlow<Seen<AddressHolder?>?> = store.userDocument(uid)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val accessRecord: Flow<Seen<AccessRecord?>?> =
        verifiedEmail?.let { email -> store.accessRecord(email) } ?: flowOf(Seen(null, confirmed = true))

    // Linking an admin's address (or connecting its Gmail) opens the list,
    // which the rules refused before, so it is asked again.
    private val accessConfig: Flow<Seen<AccessConfig?>?> = userDocument.map { linkedEmails(it?.value).joinToString(" ") }
        .distinctUntilChanged().flatMapLatest { store.accessConfig() }

    /**
     * Where the account stands, live, so an approval lets it in without a
     * restart: what approves is taken from the cache at once, so the app
     * opens offline, while "not approved" waits for the server's word.
     */
    val access: StateFlow<AccessState> = combine(userDocument, accessRecord, accessConfig) { profile, record, config ->
        if (profile == null || record == null || config == null) return@combine AccessState.Loading
        val linked = linkedEmails(profile.value)
        val hasProfile = profile.value != null
        val status = accessStatus(verifiedEmail, hasProfile, record.value, config.value, linked)
        if (status != AccountAccess.APPROVED && !(profile.confirmed && record.confirmed && config.confirmed)) return@combine AccessState.Loading
        AccessState.Known(status, isAdmin(verifiedEmail, linked, config.value), hasProfile, record.value, config.value?.admins.orEmpty())
    }.distinctUntilChanged().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AccessState.Loading)

    private val _deletionUnfinished = MutableStateFlow(false)

    /**
     * Whether the parser said this account's deletion stopped part way; the
     * app then offers to finish it in place of everything else (SPEC
     * "Deleting an account").
     */
    val deletionUnfinished: StateFlow<Boolean> = _deletionUnfinished

    /** Works out [block] on [compute], when given, rather than on the main thread. */
    suspend fun <T> computed(block: () -> T): T = compute?.let { withContext(it) { block() } } ?: block()

    init {
        // The tables the list's cards read (each trip's landmark, a missing journey's airports) are parsed on first
        // use, a few hundred milliseconds on a phone: parsed here instead, before the trips answer, rather than on
        // the main thread as the first cards draw.
        compute?.let { viewModelScope.launch(it) { warmTables() } }
        // Once per signed-in view model (SPEC "Access"): the parser lets in
        // an account from before approvals that the rules cannot tell is
        // one, and tells the admins of a request they have not heard of. The
        // rules refuse an account's queries until it is in: the trips and
        // shared profiles load empty and the profile never answers. An
        // account whose trips came back empty may be one, so its queries are
        // asked again once it is in.
        viewModelScope.launch {
            val answer = try {
                accessCheck.check()
            } catch (e: AccountDeletionUnfinished) {
                _deletionUnfinished.value = true
                return@launch
            }
            if (answer == AccountAccess.APPROVED && trips.value.isNullOrEmpty()) accessSettled.update { it + 1 }
        }
        viewModelScope.launch {
            var refused = false
            var recorded = false
            access.collect { state ->
                if (state !is AccessState.Known) return@collect
                if (state.status != AccountAccess.APPROVED) {
                    refused = true
                    return@collect
                }
                // Approved while the app was open: ask again for all that was refused.
                if (refused) {
                    refused = false
                    accessSettled.update { it + 1 }
                }
                // An account from before approvals records itself once, as on
                // the web, so it is listed on the Access page and can be revoked.
                if (!recorded && state.hasProfile && state.record == null && verifiedEmail != null) {
                    recorded = true
                    try {
                        store.recordSelf(verifiedEmail, uid, clock().toString())
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        SharedLog.error(e, "Recording access failed")
                    }
                }
            }
        }
    }

    /** Every access record, sorted for the Access page; null while they load. Admins alone may list them. */
    val accessLists: StateFlow<AccessLists?> = store.accessRecords().map { records -> records?.let(::accessLists) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** An admin's decision: approve, decline or revoke [address]. */
    fun decideAccess(token: String, address: String, decision: AccountAccess) =
        run(token, "decideAccess", failure = "Couldn't save that for $address. Try again.") { store.decideAccess(address, decision, uid, clock().toString()) }

    /** An admin invites an address that never asked: an approval of it. */
    fun inviteAccess(token: String, raw: String) {
        val address = emailAddressOf(raw)
        if (address == null) {
            _outcomes.update { it + (token to Outcome.Failed("Enter an email address")) }
            return
        }
        decideAccess(token, address, AccountAccess.APPROVED)
    }

    /** The live status of each card under way's next flight: a listener per flight, re-chosen each minute. */
    private val listFlightStatuses: Flow<Map<String, FlightStatus>> = combine(groups, details, now) { groups, details, now ->
        groups?.current.orEmpty().flatMap { trip -> details[trip.id]?.let { nextUpFlightKeys(it, now) }.orEmpty() }.distinct().sorted()
    }.distinctUntilChanged().flatMapLatest(::statusesOf)

    /** The user's own "I've checked in" marks on each trip under way: a listener per trip. */
    private val listCheckedIn: Flow<Map<String, Set<String>>> = groups.map { groups -> groups?.current.orEmpty().map { it.id }.sorted() }
        .distinctUntilChanged()
        .flatMapLatest { ids ->
            if (ids.isEmpty()) {
                flowOf(emptyMap())
            } else {
                combine(ids.map { id -> store.checkedIn(uid, id).map { id to it } }) { pairs ->
                    pairs.mapNotNull { (id, marks) -> marks?.let { id to it } }.toMap()
                }
            }
        }

    /** The user's ride companies, hidden suggestions and home corrections; null until the user document answers. */
    val rideSettings: StateFlow<RideSettings?> = accessSettled.flatMapLatest { store.rideSettings(uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** The people the user's bookings name, most often named first (SPEC "Travelers"). */
    val travelers: StateFlow<List<Person>> = accessSettled.flatMapLatest { store.people(uid) }.map(::peopleInOrder)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val state: StateFlow<TripListState> = combine(
        groups, combine(details, rideSettings, ::Pair), now, combine(people, travelers, ::Pair), combine(listFlightStatuses, listCheckedIn, ::Pair),
    ) { groups, (details, settings), now, (people, travelers), (statuses, checkedIn) ->
        computed {
            val today = today()
            val trips = groups?.let { it.current + it.upcoming + it.past }.orEmpty()
            // A trip the user is only watching warns of no one's documents.
            val byTrip = trips.filter { it.id in details && !watchedTrip(it, details[it.id], travelers) }
                .associate { trip -> trip.id to tripWarnings(people, trip, details[trip.id], today) }
            // A journey a trip seems to be missing, for the cards whose bookings are read, as its page says it.
            val missing = trips.mapNotNull { trip -> details[trip.id]?.let { journeyGapsFor(trip, it, settings).firstOrNull() }?.let { trip.id to journeyGapText(it) } }.toMap()
            TripListState(groups, details, now, listWarnings(byTrip, trips), statuses, checkedIn, displayTitles(trips), missing)
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TripListState(null, emptyMap(), clock().toString()))


    /**
     * Every trip the viewer sees with its bookings, for the reports: one
     * listener per trip, as the web's reports page keeps; null until the
     * trips, each one's bookings and the user's people have answered. A trip
     * the user is only watching (watchedTrip) isn't theirs to count: not in
     * the reports, residence days, the download or working out home.
     */
    val reportTrips: StateFlow<List<TripWithSegments>?> = combine(allSegments(), accessSettled.flatMapLatest { store.people(uid) }) { all, people ->
        all?.filterNot { watchedTrip(it.trip, it.segments, people) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _searchText = MutableStateFlow("")

    /** What the trips list's search box holds. */
    val searchText: StateFlow<String> = _searchText

    // Once searched, kept while the view model lives, so clearing the box
    // and searching again waits for nothing more.
    private val searchStarted = MutableStateFlow(false)

    fun searchTrips(text: String) {
        _searchText.value = text
        if (text.isNotBlank()) searchStarted.value = true
    }

    /**
     * The trips a search finds (SPEC "Searching trips"), null while the box
     * is empty. Every trip's bookings are listened to once a search starts;
     * until they answer, trips are matched by title and dates.
     */
    val searchResult: StateFlow<TripSearchResult?> = combine(
        _searchText,
        trips,
        searchStarted.flatMapLatest { started -> if (started) allSegments() else flowOf(null) },
    ) { text, trips, all ->
        val query = parseTripQuery(text)
        if (query.isEmpty || trips == null) return@combine null
        val titles = displayTitles(trips)
        val segments = all?.associate { it.trip.id to it.segments }
        val ids = trips.filter { tripMatches(query, it, titles[it.id] ?: it.title, segments?.get(it.id).orEmpty()) }.map { it.id }.toSet()
        TripSearchResult(ids, bookingsSearched = segments != null)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _listFilters = MutableStateFlow(listFilterStore.read())

    /** What the trip list leaves out, as set on this phone (SPEC "Filtering the trip list"). */
    val listFilters: StateFlow<ListFilters> = _listFilters

    fun setListFilters(filters: ListFilters) {
        _listFilters.value = filters
        try {
            listFilterStore.write(filters)
        } catch (e: Exception) {
            // They still apply while the app runs.
            SharedLog.error(e, "Saving the trip list's filters failed")
        }
    }

    /**
     * Reports' counts and map for every year as last worked out on this phone, for the user signed in now: drawn
     * while the bookings are read (SPEC "Reports"). Null when there are none, or they can't be read.
     */
    val reportSnapshot: StateFlow<TravelReport?> = flow {
        emit(
            computed {
                try {
                    decodeReportSnapshot(reportSnapshotStore.read(), uid)
                } catch (e: Exception) {
                    // Worked out again from the bookings in a moment; the next one saved replaces it.
                    SharedLog.error(e, "Reading Reports' last counts failed")
                    null
                }
            },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Keeps [report], every year's counts and map, for the next visit to Reports. */
    fun saveReportSnapshot(report: TravelReport) {
        viewModelScope.launch {
            try {
                computed { reportSnapshotStore.write(encodeReportSnapshot(uid, report)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // The next visit works them out again before drawing, as before.
                SharedLog.error(e, "Saving Reports' counts for next time failed")
            }
        }
    }

    private val _reportCounting = MutableStateFlow(countingStore.read())

    /** How Reports counts days in each country, as set on this phone (SPEC "Reports"). */
    val reportCounting: StateFlow<CountryCounting> = _reportCounting

    fun setReportCounting(counting: CountryCounting) {
        _reportCounting.value = counting
        try {
            countingStore.write(counting)
        } catch (e: Exception) {
            // It still applies while the app runs.
            SharedLog.error(e, "Saving how Reports counts days failed")
        }
    }

    /**
     * The bookings of trips that don't yet say what the list needs (flagsUnknown: from before the flags were kept,
     * or edited since), for its filters, Watching and pictures: each listened to, counting as it answers, and its
     * flags then recorded so it is read no more.
     */
    private val unknownSegments: Flow<Map<String, List<Segment>>> =
        // The trips that don't yet say, as they turn up so (a later snapshot, an edit that took the flags off).
        trips.filterNotNull().map { all -> all.filter(::flagsUnknown).map { it.id } }.distinctUntilChanged().flatMapLatest(::segmentsAsTheyAnswer)
            .shareIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), replay = 1)

    /** The trips the filters leave out, by each trip's own flags (TripFlags) at once, else by its bookings once read. */
    val hiddenTrips: StateFlow<Set<String>> = combine(trips, _listFilters, unknownSegments.onStart { emit(emptyMap()) }, travelers) { trips, filters, segments, people ->
        if (!filters.any) emptySet()
        else computed { trips.orEmpty().filter { hiddenFromList(it, segments[it.id], filters, people) }.map { it.id }.toSet() }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    /** The trips the user is only watching: none of their travelers is the user (watching). */
    val watchingTrips: StateFlow<Set<String>> = combine(trips, unknownSegments.onStart { emit(emptyMap()) }, travelers) { trips, segments, people ->
        computed { trips.orEmpty().filter { watching(it.travelers ?: segments[it.id]?.let(::tripTravelers), people) }.map { it.id }.toSet() }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    // These trips' bookings by trip, each as it answers, its flags recorded on its trip.
    private fun segmentsAsTheyAnswer(ids: List<String>): Flow<Map<String, List<Segment>>> =
        if (ids.isEmpty()) flowOf(emptyMap())
        else combine(ids.map { id -> sharedSegments(id).map { read -> read?.let { id to it } } }) { read -> read.filterNotNull().toMap() }

    // One listener per trip for the filters, kept a while past its last collector, so the set of trips being read
    // changing (a repair taking one out) doesn't restart the others' listeners, nor their repairs.
    private val filterSegments = mutableMapOf<String, StateFlow<List<Segment>?>>()

    private fun sharedSegments(tripId: String): StateFlow<List<Segment>?> =
        filterSegments.getOrPut(tripId) { segments(tripId).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null) }

    // Trips whose flags are being repaired now: one repair at a time each.
    private val repairing = mutableSetOf<String>()

    // Every trip's bookings, by trip, null until each has answered. Listened to again only when which trips they are
    // changes: a change to a trip itself (its flags recorded, its dates widened) keeps every listener, where restarting
    // them all made the reports wait for every trip's bookings again, and work everything out again, each time.
    private fun allSegments(): Flow<List<TripWithSegments>?> {
        val byTrip: Flow<Map<String, List<Segment>>?> = trips.map { list -> list?.map { it.id }?.sorted() }.distinctUntilChanged().flatMapLatest { ids ->
            when {
                ids == null -> flowOf(null)
                ids.isEmpty() -> flowOf(emptyMap())
                else -> combine(ids.map { id -> segments(id).map { id to it } }) { it.toMap() }
            }
        }
        // A trip just added waits out of the list until its bookings answer.
        return combine(trips, byTrip) { list, segments ->
            if (list == null || segments == null) null else list.mapNotNull { trip -> segments[trip.id]?.let { TripWithSegments(trip, it) } }
        }
    }

    /** One trip, or null once the list has answered without it. */
    fun trip(id: String): Flow<Trip?> = trips.map { trips -> trips?.firstOrNull { it.id == id } }

    /** A trip's bookings, live; each read keeps the trip's list flags true to them (keepTripFlags). */
    fun segments(tripId: String): Flow<List<Segment>> = store.segments(tripId).onEach { keepTripFlags(tripId, it) }

    /**
     * Records the flags the trip list filters by when [segments] disagree with what the trip says: after an edit,
     * and for a trip from before they were kept. Not for a trip being deleted; a refusal is logged, and the list
     * reads the bookings instead.
     */
    private fun keepTripFlags(tripId: String, segments: List<Segment>) {
        val trip = trips.value?.firstOrNull { it.id == tripId } ?: return
        if (trip.deleting || tripFlagsToWrite(trip, segments) == null || !repairing.add(tripId)) return
        viewModelScope.launch {
            try {
                // What the listener gave may be the cache's part, or nothing after a failure: the store writes the
                // flags only from the server's whole answer, and only if no booking changed meanwhile.
                store.repairTripFlags(tripId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                SharedLog.error(e, "Keeping a trip's list flags failed")
            } finally {
                repairing.remove(tripId)
            }
        }
    }

    /**
     * The live status of a trip's flights near departure, by flight key: a
     * listener per flight, only for the few within a day or so, re-chosen
     * each minute as flights come into and go out of range.
     */
    fun flightStatuses(tripId: String): Flow<Map<String, FlightStatus>> =
        combine(store.segments(tripId), now) { segments, now -> shownFlightKeys(segments, now) }
            .distinctUntilChanged()
            .flatMapLatest(::statusesOf)

    /** These flights' live statuses by key, a listener each; a flight the parser has not looked at is left out. */
    private fun statusesOf(keys: List<String>): Flow<Map<String, FlightStatus>> =
        if (keys.isEmpty()) {
            flowOf(emptyMap())
        } else {
            combine(keys.map { key -> store.flightStatus(key).map { key to it } }) { pairs ->
                pairs.mapNotNull { (key, status) -> status?.let { key to it } }.toMap()
            }
        }

    /** What a flight's row says of its delays, gates and carousel now. */
    fun flightLines(segment: Segment, statuses: Map<String, FlightStatus>): List<String> {
        if (!flightStatusShown(segment, clock().toString())) return emptyList()
        return flightStatusKey(segment)?.let { flightStatusLines(statuses[it], segment, clock().toString()) }.orEmpty()
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
    // [failure], when given, is what the screen says in place of the
    // error's own message, which may quote what the write was about.
    private fun run(token: String, operation: String, failure: String? = null, block: suspend () -> Unit) {
        if (_outcomes.value[token] is Outcome.Busy) return
        _outcomes.update { it + (token to Outcome.Busy) }
        viewModelScope.launch {
            val outcome = try {
                block()
                Outcome.Done
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (failure == null) {
                    SharedLog.error(e, "$operation failed")
                } else {
                    // By kind only: the message may name the address the write was for.
                    SharedLog.error(null, "%s failed: %s", safe(operation), safe(e::class.simpleName))
                }
                Outcome.Failed(failure ?: e.message ?: e::class.simpleName.orEmpty())
            }
            _outcomes.update { it + (token to outcome) }
        }
    }

    /** The screen with `token` has acted on its write's outcome. */
    fun outcomeSeen(token: String) {
        _outcomes.update { it - token }
    }

    fun saveSegment(token: String, tripId: String, draft: SegmentDraft, existingId: String?) = run(token, "saveSegment") { store.saveSegment(tripId, draft, existingId) }

    private val _addedTo = MutableStateFlow<Map<String, String>>(emptyMap())

    /**
     * Adds a booking with no trip in view (one an email couldn't be read for): into the user's trip that takes in
     * its first day (fittingTrip), else a trip of its own. [addedTo] then gives the trip, under the same token.
     */
    fun addBooking(token: String, draft: SegmentDraft) = run(token, "addBooking") {
        // Waits for the trips to load: no screen showing them may be following them.
        val fitting = fittingTrip(trips.filterNotNull().first(), uid, draft.start)
        val tripId = if (fitting != null) fitting.id.also { store.saveSegment(it, draft, null) } else store.addSegmentToNewTrip(draft, uid)
        _addedTo.update { it + (token to tripId) }
    }

    /** The trip [addBooking] under [token] put the booking in, once done. */
    fun addedTo(token: String): String? = _addedTo.value[token]

    fun deleteSegment(token: String, tripId: String, segmentId: String) = run(token, "deleteSegment") { store.deleteSegment(tripId, segmentId) }

    fun restoreSegment(token: String, tripId: String, segmentId: String) = run(token, "restoreSegment") { store.restoreSegment(tripId, segmentId) }

    fun setMe(token: String, personId: String) = run(token, "setMe") { store.setMe(uid, travelers.value, personId) }

    fun newTripId(): String = store.newTripId()

    /** Add a trip's write for a new trip [id]: its outcome's token, under [NEW_TRIP_TOKEN]. */
    fun addTrip(id: String, title: String, start: String?, end: String?) = createTrip("$NEW_TRIP_TOKEN$id", id, title, start, end)

    /**
     * Whether Add a trip may close now, forgetting the outcomes of its tries:
     * not while one is being saved, whose outcome would otherwise close a
     * dialog opened after it and open its trip over that.
     */
    fun leaveAddTrip(): Boolean {
        val mine = _outcomes.value.filterKeys { it.startsWith(NEW_TRIP_TOKEN) }
        if (mine.values.any { it is Outcome.Busy }) return false
        mine.keys.forEach(::outcomeSeen)
        return true
    }

    fun createTrip(token: String, id: String, title: String, start: String?, end: String?) = run(token, "createTrip") {
        tripDraftProblem(title, start, end)?.let { throw IllegalArgumentException(it) }
        store.createTrip(id, uid, title.trim(), start!!, end!!)
    }

    fun cancelSegment(token: String, tripId: String, segmentId: String) = run(token, "cancelSegment") { store.cancelSegment(tripId, segmentId) }

    fun cancelTrip(token: String, tripId: String) = run(token, "cancelTrip") { store.cancelTrip(tripId) }

    fun restoreTrip(token: String, tripId: String) = run(token, "restoreTrip") { store.restoreTrip(tripId) }

    fun mergeSegments(token: String, tripId: String, keepId: String, otherId: String) = run(token, "mergeSegments") { store.mergeSegments(tripId, keepId, otherId) }
    fun moveSegment(token: String, fromTripId: String, segmentId: String, toTripId: String) = run(token, "moveSegment") { store.moveSegment(fromTripId, segmentId, toTripId) }
    fun moveSegmentToNewTrip(token: String, fromTripId: String, segmentId: String) = run(token, "moveSegmentToNewTrip") { store.moveSegmentToNewTrip(fromTripId, segmentId, uid) }

    fun renameTrip(token: String, tripId: String, title: String) = run(token, "renameTrip") {
        if (title.isBlank()) throw IllegalArgumentException("Give the trip a name")
        store.renameTrip(tripId, title)
    }

    fun fitTripDates(token: String, tripId: String) = run(token, "fitTripDates") { store.fitTripDates(tripId) }

    fun shareTrip(token: String, tripId: String, email: String) = run(token, "shareTrip") { store.shareTrip(tripId, email, uid) }

    fun unshareTrip(token: String, tripId: String, email: String) = run(token, "unshareTrip") { store.unshareTrip(tripId, email) }

    fun deleteTrip(token: String, tripId: String) = run(token, "deleteTrip") { store.deleteTrip(tripId) }

    fun mergeTrips(token: String, sourceId: String, targetId: String) = run(token, "mergeTrips") { store.mergeTrips(sourceId, targetId) }

    private val _senderCleanup = MutableStateFlow<Pair<String, SenderCleanup>?>(null)

    /** After "Never import this sender": the domain and what it already imported, offered for deletion; null when nothing. */
    val senderCleanup: StateFlow<Pair<String, SenderCleanup>?> = _senderCleanup.asStateFlow()

    /** From a booking's Sources: always import mail from [domain], as Import review teaches it. */
    fun alwaysImportSender(token: String, domain: String) = run(token, "alwaysImportSender") { store.learnSender(uid, domain, SenderList.ALLOW) }

    /**
     * Reads the owner's trips (a rare action, so a read of each is fine) for what [domain] already imported, then
     * never imports its mail again, and [senderCleanup] offers to delete what it found.
     */
    fun neverImportSender(token: String, domain: String) = run(token, "neverImportSender") {
        // Read first: if that fails, nothing is saved and Never stays on offer to try again.
        val own = store.serverOwnTrips(uid).filter { !it.deleting }
        // From the server, not the cache: a trip whose bookings aren't cached would look empty.
        val plan = senderCleanup(own.map { TripWithSegments(it, store.serverSegments(it.id)) }, uid, domain)
        store.learnSender(uid, domain, SenderList.DENY)
        if (plan.trips.isNotEmpty() || plan.segments.isNotEmpty()) _senderCleanup.value = domain to plan
    }

    fun keepSenderBookings() {
        _senderCleanup.value = null
    }

    /**
     * Deletes what [senderCleanup] offered: the trips whole, unless a booking arrived there since they were read
     * (then only the sender's go), then the bookings in trips that keep others.
     */
    fun removeSenderBookings(token: String) = run(token, "removeSenderBookings") {
        val offer = _senderCleanup.value ?: return@run
        val plan = offer.second
        _senderCleanup.value = null
        try {
            val segments = plan.segments.toMutableList()
            for (trip in plan.trips) {
                if (!store.deleteTripIfOnly(trip.id, trip.segments.toSet())) trip.segments.mapTo(segments) { trip.id to it }
            }
            for ((tripId, segmentId) in segments) store.deleteSegment(tripId, segmentId)
        } catch (e: Exception) {
            // Offered again to retry: the sender is denied now, so Never isn't. What was already deleted is
            // skipped or harmless the second time.
            if (e !is CancellationException) _senderCleanup.value = offer
            throw e
        }
    }

    /** The Gmail mailboxes the user connected, for source links; empty when none. */
    val gmailMailboxes: StateFlow<List<GmailMailbox>> = store.gmailStatuses(uid).map { all -> all.map { it.mailbox } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Whether reminders by email are on; null until the user document answers. */
    val reminderEmail: StateFlow<Boolean?> = store.reminderEmail(uid).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun setReminderEmail(token: String, on: Boolean) = run(token, "setReminderEmail") { store.setReminderEmail(uid, on) }

    /**
     * Home over time for the reports' residence and visa days: worked out
     * from the user's own trips, with their corrections over it, as the
     * Profile and the web's reports page work it out; null until both answer.
     */
    val reportHomes: StateFlow<List<HomePeriod>?> = combine(reportTrips, rideSettings) { trips, settings ->
        if (trips == null || settings == null) null else computed { homesOf(trips, settings) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * [reportHomes] worked out now, from what the reports last read, for the trips download: home is worked out
     * only for what asks for it, as it takes a while. Empty until the reports and the user document have answered.
     */
    fun reportHomesNow(): List<HomePeriod> {
        val trips = reportTrips.value ?: return emptyList()
        val settings = rideSettings.value ?: return emptyList()
        return homesOf(trips, settings)
    }

    // Each with its airports: those chosen on Profile, else those its round trips leave from.
    private fun homesOf(trips: List<TripWithSegments>, settings: RideSettings): List<HomePeriod> {
        val segments = trips.filter { it.trip.ownerUid == uid }.flatMap { it.segments }
        return withChosenAirports(withHomeAirports(effectiveHomes(homeTimeline(segments), settings.homes), segments), settings.homeAirports)
    }

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

    /** The user's reminders before every international trip, in slot order; null while they load. */
    val standingReminders: StateFlow<List<Reminder>?> = accessSettled.flatMapLatest { store.standingReminders(uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** What the user ticked off on a trip and the one-offs they added to it; null while it loads. */
    fun myChecklist(tripId: String): Flow<MyChecklist?> = store.myChecklist(uid, tripId)

    /**
     * A trip's "Before you go" for the viewer (SPEC "Before you go"): their
     * standing reminders when the trip goes abroad from home on its first
     * day (the trip's own round trip unless they corrected home, as ride
     * suggestions work it out), and their one-offs. Null while anything
     * loads, once the trip has started ([checklistShown]), and while it is being deleted.
     */
    fun checklistFor(trip: Trip, segments: List<Segment>, standing: List<Reminder>?, mine: MyChecklist?, settings: RideSettings?): List<ChecklistEntry>? {
        if (standing == null || mine == null || settings == null || trip.deleting || !checklistShown(trip, today())) return null
        val international = standing.isNotEmpty() && isInternational(trip, segments, settings.homes)
        return tripChecklist(trip, standing, mine.done, mine.added, international)
    }

    /**
     * Saves a reminder: a standing one with no [tripId], else a one-off on
     * that trip; one with no slot is new, and gets an id of its own.
     */
    fun saveReminder(token: String, tripId: String?, reminder: Reminder) = run(token, "saveReminder") {
        store.saveReminder(uid, tripId, if (reminder.id.isEmpty()) reminder.copy(id = newReminderId()) else reminder)
    }

    fun removeReminder(token: String, tripId: String?, slot: String) = run(token, "removeReminder") { store.removeReminder(uid, tripId, slot) }

    fun setReminderDone(token: String, tripId: String, id: String, done: Boolean) = run(token, "setReminderDone") { store.setReminderDone(uid, tripId, id, done) }

    /** The bookings on a trip the user marked "I've checked in"; null while they load. Theirs alone, shared trip or not. */
    fun checkedIn(tripId: String): Flow<Set<String>?> = store.checkedIn(uid, tripId)

    /** Marks a flight checked in for the user, or not: their check-in line and reminders stop. */
    fun setCheckedIn(token: String, tripId: String, segmentId: String, checkedIn: Boolean) =
        run(token, "setCheckedIn", failure = "Couldn't save your check-in. Try again.") { store.setCheckedIn(uid, tripId, segmentId, checkedIn) }

    /** One connected mailbox as Settings shows it: the address, and how far the last reading of it got. */
    data class MailboxShown(val emailAddress: String, val progress: BackfillShown?, val reading: Boolean)

    /** Gmail as Settings shows it: loading, not connected, or each connected mailbox, oldest first. */
    sealed interface GmailState {
        data object Loading : GmailState
        data object NotConnected : GmailState
        data class Connected(val mailboxes: List<MailboxShown>) : GmailState {
            /** Whether another mailbox may be connected ([MAX_GMAIL_MAILBOXES]). */
            val canConnectMore: Boolean get() = mailboxes.size < MAX_GMAIL_MAILBOXES
        }
    }

    /** Fastmail as Settings shows it: loading, not connected, or the one connected mailbox. */
    sealed interface FastmailState {
        data object Loading : FastmailState
        data object NotConnected : FastmailState
        data class Connected(val mailbox: MailboxShown) : FastmailState
    }

    /** One mailbox connected over IMAP as Settings shows it; [loginFailed]: its server turned the app password down. */
    data class ImapShown(val mailbox: MailboxShown, val loginFailed: Boolean)

    /** Mailboxes connected over IMAP as Settings shows them: loading, or each one, oldest first. */
    sealed interface ImapState {
        data object Loading : ImapState
        data class Loaded(val mailboxes: List<ImapShown>) : ImapState {
            /** Whether another mailbox may be connected ([MAX_IMAP_MAILBOXES]). */
            val canConnectMore: Boolean get() = mailboxes.size < MAX_IMAP_MAILBOXES
        }
    }

    /** The Gmail mailboxes, judged against the clock each minute so a stalled reading shows as stopped. */
    val gmail: StateFlow<GmailState> = combine(accessSettled.flatMapLatest { store.gmailStatuses(uid) }, now) { statuses, at ->
        val millis = Instant.parse(at).toEpochMilliseconds()
        if (statuses.isEmpty()) GmailState.NotConnected
        else GmailState.Connected(statuses.map { MailboxShown(it.emailAddress, it.progress, isReading(it.progress, millis)) })
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), GmailState.Loading)

    /** The Fastmail connection, judged against the clock the same way. */
    val fastmail: StateFlow<FastmailState> = combine(accessSettled.flatMapLatest { store.fastmailStatus(uid) }, now) { status, at ->
        status?.let { FastmailState.Connected(MailboxShown(it.emailAddress, it.progress, isReading(it.progress, Instant.parse(at).toEpochMilliseconds()))) }
            ?: FastmailState.NotConnected
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FastmailState.Loading)

    /** The mailboxes connected over IMAP, judged against the clock the same way. */
    val imap: StateFlow<ImapState> = combine(accessSettled.flatMapLatest { store.imapStatuses(uid) }, now) { statuses, at ->
        val millis = Instant.parse(at).toEpochMilliseconds()
        ImapState.Loaded(statuses.map { ImapShown(MailboxShown(it.emailAddress, it.backfill, isReading(it.backfill, millis)), it.loginFailedAt != null) })
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ImapState.Loading)

    /** Whether this build can connect Gmail and read the mailboxes here. */
    val canUseGmail: Boolean
        get() = gmailActions.available

    /** Whether this build can connect Fastmail and read the mailbox here. */
    val canUseFastmail: Boolean
        get() = fastmailActions.available

    /** Google's consent page for connecting Gmail, once asked for; the screen opens it and clears it. */
    private val _gmailConsentUrl = MutableStateFlow<String?>(null)
    val gmailConsentUrl: StateFlow<String?> = _gmailConsentUrl

    fun connectGmail(token: String) = run(token, "connectGmail") { _gmailConsentUrl.value = gmailActions.connectUrl() }

    fun gmailConsentOpened() {
        _gmailConsentUrl.value = null
    }

    /** Starts or continues reading a Gmail mailbox's past emails; from the start once the last reading finished. */
    fun startReading(token: String, emailAddress: String, restart: Boolean) = run(token, "startReading") { gmailActions.start(emailAddress, restart) }

    fun stopReading(token: String, emailAddress: String) = run(token, "stopReading") { gmailActions.stop(emailAddress) }

    fun disconnectGmail(token: String, emailAddress: String) = run(token, "disconnectGmail") { gmailActions.disconnect(emailAddress) }

    /** Connects Fastmail with a read-only API token the user made there; the parser says why it refuses one. */
    fun connectFastmail(token: String, apiToken: String) = run(token, "connectFastmail") {
        if (apiToken.isBlank()) throw IllegalArgumentException("Paste your Fastmail API token.")
        fastmailActions.connect(apiToken.trim())
    }

    /** Starts or continues reading Fastmail's past emails; from the start once the last reading finished. */
    fun startFastmailReading(token: String, restart: Boolean) = run(token, "startFastmailReading") { fastmailActions.start(restart) }

    fun stopFastmailReading(token: String) = run(token, "stopFastmailReading") { fastmailActions.stop() }

    fun disconnectFastmail(token: String) = run(token, "disconnectFastmail") { fastmailActions.disconnect() }

    /** Whether this build can connect mailboxes over IMAP and read them here. */
    val canUseImap: Boolean
        get() = imapActions.available

    /**
     * Connects a mailbox over IMAP with an app password; [server] only counts for an address whose provider
     * Travelmo does not know. A Gmail or Fastmail address is sent to its own section; the parser says why it
     * refuses anything else.
     */
    fun connectImap(token: String, emailAddress: String, password: String, server: String) = run(token, "connectImap") {
        val address = emailAddress.trim()
        imapRedirect(address)?.let { throw IllegalArgumentException(it) }
        if (!address.contains('@')) throw IllegalArgumentException("Enter your email address.")
        if (password.isBlank()) throw IllegalArgumentException("Enter an app password.")
        val needsServer = imapServerFor(address) == ImapServerChoice.Other
        if (needsServer && parseImapServer(server) == null) throw IllegalArgumentException("Enter your mail server, such as imap.example.com.")
        imapActions.connect(address, password, server.trim().takeIf { needsServer })
    }

    /** Starts or continues reading an IMAP mailbox's past emails; from the start once the last reading finished. */
    fun startImapReading(token: String, emailAddress: String, restart: Boolean) = run(token, "startImapReading") { imapActions.start(emailAddress, restart) }

    fun stopImapReading(token: String, emailAddress: String) = run(token, "stopImapReading") { imapActions.stop(emailAddress) }

    fun disconnectImap(token: String, emailAddress: String) = run(token, "disconnectImap") { imapActions.disconnect(emailAddress) }

    /** Import review's latest records, live; null while they load. */
    val reviewLatest: StateFlow<List<ParsedRecord>?> = accessSettled.flatMapLatest { store.latestParsed(uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val reviewSearching = MutableStateFlow(false)

    /** Every record, read once a search starts (null before), each page as it comes. */
    val reviewAll: StateFlow<SearchedRecords?> = reviewSearching.flatMapLatest { if (it) store.allParsed(uid) else flowOf(null) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Whether Import review is searching, which reads every record. */
    fun setReviewSearching(on: Boolean) {
        reviewSearching.value = on
    }

    /** The user's Google Calendar connection, live; null while it loads. */
    val googleCalendar: StateFlow<GoogleCalendarShown?> = accessSettled.flatMapLatest { store.googleCalendar(uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Whether this build can connect and change Google Calendar here. */
    val canConnectCalendar: Boolean
        get() = googleCalendarActions.available

    private val _calendarSaved = MutableStateFlow<Boolean?>(null)

    /** After a save of the calendar choice: whether newly chosen calendars were read then; null before one. */
    val calendarSaved: StateFlow<Boolean?> = _calendarSaved

    private val _calendarConsentUrl = MutableStateFlow<String?>(null)

    /** Google's consent page for Google Calendar, for the screen to open once. */
    val calendarConsentUrl: StateFlow<String?> = _calendarConsentUrl

    /** Asks the parser for Google's consent page for Google Calendar. */
    fun connectCalendar(token: String) = run(token, "connectCalendar") {
        _calendarSaved.value = null
        _calendarConsentUrl.value = googleCalendarActions.connectUrl()
    }

    fun calendarConsentOpened() {
        _calendarConsentUrl.value = null
    }

    /** Saves which calendars are read. */
    fun selectCalendars(token: String, ids: List<String>) = run(token, "selectCalendars") {
        _calendarSaved.value = null
        _calendarSaved.value = googleCalendarActions.select(ids)
    }

    /** Disconnects Google Calendar. */
    fun disconnectCalendar(token: String) = run(token, "disconnectCalendar") {
        _calendarSaved.value = null
        googleCalendarActions.disconnect()
    }

    /** The user's calendar export link, live; null while it loads. */
    val calendarExport: StateFlow<CalendarExportShown?> = accessSettled.flatMapLatest { store.calendarExport(uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Whether this build can create and change the export link here. */
    val canExport: Boolean
        get() = calendarExportActions.available && parserUrl.isNotBlank()

    /** The export link three ways, from this build's parser. */
    fun exportLinksFor(token: String): ExportLinks = exportLinks(token, parserUrl)

    /** Issues an export link, replacing any old one. */
    fun issueCalendarExport(token: String) = run(token, "issueCalendarExport") { calendarExportActions.issue() }

    /** Turns the export link off. */
    fun stopCalendarExport(token: String) = run(token, "stopCalendarExport") { calendarExportActions.stop() }

    /** The user's calendar feeds, live; null while they load. */
    val feeds: StateFlow<List<CalendarFeedShown>?> = accessSettled.flatMapLatest { store.feeds(uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Whether this build can add and remove feeds here. */
    val canEditFeeds: Boolean
        get() = feedActions.available

    private val _feedAdded = MutableStateFlow<String?>(null)

    /** What the last feed added here read, until the next add. */
    val feedAdded: StateFlow<String?> = _feedAdded

    /** Subscribes to a calendar feed and says what its first read did. */
    fun addFeed(token: String, url: String) = run(token, "addFeed") {
        _feedAdded.value = null
        _feedAdded.value = feedActions.add(url)
    }

    /** Drops a calendar feed; its bookings stay. */
    fun removeFeed(token: String, id: String) = run(token, "removeFeed") { feedActions.remove(id) }

    /** The user's forwarding address, live; null while it loads. */
    val forwarding: StateFlow<Forwarding?> = accessSettled.flatMapLatest { store.forwarding(uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Whether Settings offers forwarding: a parser to issue it, and a domain or an address already issued. */
    fun canForward(forwarding: Forwarding): Boolean = forwardActions.available && (forwardOffered || forwarding.address != null)

    /** Issues a forwarding address, replacing any old one. */
    fun issueForward(token: String) = run(token, "issueForward") { forwardActions.issue() }

    /** Turns the forwarding address off. */
    fun stopForward(token: String) = run(token, "stopForward") { forwardActions.stop() }

    /** The user's sender rules, live. */
    val senderPatterns: StateFlow<SenderPatterns?> = accessSettled.flatMapLatest { store.senderPatterns(uid) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _reviewNotices = MutableStateFlow<Map<String, String>>(emptyMap())

    /** What the last action on each reviewed message did, by message id. */
    val reviewNotices: StateFlow<Map<String, String>> = _reviewNotices

    private val _reviewReports = MutableStateFlow<Map<String, String>>(emptyMap())

    /** Import anyway's report of each message read again (what was read, what the model said), to copy, by message id. */
    val reviewReports: StateFlow<Map<String, String>> = _reviewReports

    /** Forgets what the last action on a reviewed message said, and its report. */
    fun reviewNoticeSeen(messageId: String) {
        _reviewNotices.update { it - messageId }
        _reviewReports.update { it - messageId }
    }

    /** Whether this build can read a message again here. */
    val canReimport: Boolean
        get() = importReview.available

    /** Reads one message again, skipping the pre-filter, and says what came of it. */
    fun reimport(token: String, messageId: String) = run(token, "reimport") {
        val done = importReview.reimport(messageId)
        _reviewNotices.update { it + (messageId to done.said) }
        done.report?.let { report -> _reviewReports.update { it + (messageId to report) } }
    }

    /** Saves the sender rules as typed, one domain a line ([cleanSenderList]). */
    fun saveSenderPatterns(token: String, allow: String, deny: String) = run(token, "saveSenderPatterns") {
        store.setSenderPatterns(uid, SenderPatterns(allow = cleanSenderList(allow.lines()), deny = cleanSenderList(deny.lines())))
    }

    /** Always or never imports a sender's mail from now on. */
    fun learnSender(token: String, messageId: String, domain: String, which: SenderList) = run(token, "learnSender") {
        store.learnSender(uid, domain, which)
        val said = if (which == SenderList.ALLOW) "Always importing $domain" else "Never importing $domain"
        _reviewNotices.update { it + (messageId to said) }
    }

    /** Adds one of the user's own car and ride companies. */
    fun addRideCompany(token: String, company: RideCompany) = run(token, "addRideCompany") { store.addRideCompany(uid, company) }

    /** Removes one of the user's own car and ride companies. */
    fun removeRideCompany(token: String, company: RideCompany) = run(token, "removeRideCompany") { store.removeRideCompany(uid, company) }

    fun hideRideNeed(token: String, need: RideNeed) = run(token, "hideRideNeed") { store.hideRideNeed(uid, rideNeedKey(need)) }

    private val _looks = MutableStateFlow<Map<String, LookResult>>(emptyMap())

    /** What looking for each missing journey found (by [journeyGapKey]): every email so far, and where to keep looking from. */
    val looks: StateFlow<Map<String, LookResult>> = _looks.asStateFlow()

    /** Whether this build can look for a missing journey: it has a parser to ask. */
    val canLook: Boolean
        get() = tripActions.available

    /** The token a look for [gap] runs under, for its outcome. */
    fun lookToken(tripId: String, gap: JourneyGap): String = "look/${journeyGapKey(tripId, gap)}"

    /** Searches the user's Gmail for a missing journey's emails and reads a few, carrying on from the look before. */
    fun lookForJourney(tripId: String, gap: JourneyGap) = run(lookToken(tripId, gap), "lookForJourney") {
        val key = journeyGapKey(tripId, gap)
        val result = tripActions.lookForJourney(gap, _looks.value[key]?.next)
        _looks.update { it + (key to LookResult(it[key]?.emails.orEmpty() + result.emails, result.next)) }
    }

    /** Says a trip goes one way, so it no longer says a journey back is missing. */
    fun markOneWay(token: String, tripId: String) = run(token, "markOneWay") { store.markOneWay(uid, tripId) }

    /**
     * The journeys a trip seems to be missing (journeyGaps), none once it was
     * cancelled or is being deleted, and none at its ends once the viewer
     * said it goes one way. Home is only what they set on Profile, as on the web.
     */
    fun journeyGapsFor(trip: Trip, segments: List<Segment>, settings: RideSettings?): List<JourneyGap> {
        if (settings == null || trip.cancelledAt != null || trip.deleting) return emptyList()
        return journeyGaps(segments, journeyGapHomes(settings.homes, settings.homeAirports), trip.id in settings.oneWayTrips)
    }

    /** Removes a loyalty number found in the user's emails from their profile. */
    fun removeFoundLoyalty(token: String, found: FoundLoyalty) = run(token, "removeFoundLoyalty") {
        try {
            store.removeFoundLoyalty(uid, found)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Logged by kind only: the number is the user's.
            SharedLog.error(e, "Removing a loyalty number found in emails failed")
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
            SharedLog.error(e, "Saving whose a loyalty number is failed")
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
                SharedLog.error(e, "Moving the registration to the current token failed")
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

    /** Whether this build can regroup or delete all trips here; without a parser address, Settings points to the web. */
    val canRunTripActions: Boolean
        get() = tripActions.available

    private val _tripNotice = MutableStateFlow<String?>(null)

    /** What the last trip action did, in a line, until the next one starts. */
    val tripNotice: StateFlow<String?> = _tripNotice

    /** Files every booking again with the grouping imports use now, as Settings on the web does. */
    fun regroupTrips(token: String) = run(token, "regroupTrips") {
        _tripNotice.value = null
        _tripNotice.value = tripActions.regroup()
    }

    /** Refresh from email as Settings shows it: how far the last one got, and whether it is running now. */
    data class RefreshState(val progress: RefreshShown?, val reading: Boolean)

    /** The refresh's progress, judged against the clock each minute so a stalled one shows as stopped. */
    val refresh: StateFlow<RefreshState> = combine(accessSettled.flatMapLatest { store.refreshProgress(uid) }, now) { progress, at ->
        RefreshState(progress, progress?.reading(Instant.parse(at).toEpochMilliseconds()) == true)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RefreshState(null, false))

    /** Starts or continues Refresh from email on the parser; from the first email again once the last one finished. */
    fun startRefresh(token: String, restart: Boolean, retryFailed: Boolean = false) =
        run(token, "startRefresh") { tripActions.refresh(restart, retryFailed) }

    /** The import records of the emails a finished refresh couldn't read, for Settings to name them; empty while none. */
    suspend fun failedEmailRecords(ids: List<String>): Map<String, ParsedRecord> =
        if (ids.isEmpty()) emptyMap() else store.parsedRecords(uid, ids)

    fun stopRefresh(token: String) = run(token, "stopRefresh") { tripActions.stopRefresh() }

    /** Deletes every trip the user owns, with its bookings, so they can import again. */
    fun deleteAllTrips(token: String) = run(token, "deleteAllTrips") {
        _tripNotice.value = null
        _tripNotice.value = tripActions.deleteAll()
    }

    /** How many trips the user owns, for "Delete all trips" to say; null while they load. */
    val ownTripCount: StateFlow<Int?> = trips.map { list -> list?.count { it.ownerUid == uid } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

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

    /** Sets home to [correction] from its date, replacing one on that date, as the web's Profile does. */
    fun addHomeCorrection(token: String, correction: HomeCorrection) = run(token, "addHomeCorrection") {
        val now = rideSettings.value?.homes ?: throw IllegalStateException("Home is still loading; try again")
        store.setHomeCorrections(uid, now.filter { it.from != correction.from } + correction)
    }

    /** Removes the correction from [from]. */
    /** Chooses [codes] as the airports of the home in [city], in place of those worked out, as the web's Profile does. */
    fun setHomeAirports(token: String, city: String, country: String?, codes: List<String>) = run(token, "setHomeAirports") {
        val now = rideSettings.value?.homeAirports ?: throw IllegalStateException("Home is still loading; try again")
        store.setHomeAirports(uid, now.filter { homeTownKey(it.city, it.country) != homeTownKey(city, country) } + ChosenHomeAirports(city, country, codes))
    }

    fun removeHomeCorrection(token: String, from: String) = run(token, "removeHomeCorrection") {
        val now = rideSettings.value?.homes ?: throw IllegalStateException("Home is still loading; try again")
        store.setHomeCorrections(uid, now.filter { it.from != from })
    }

    /** Who the user's travel profile is shared with; the profile is started if none has arrived yet. */
    fun saveTrusted(token: String, emails: List<String>) = run(token, "saveTrusted") {
        val answer = ownProfileAnswer.value ?: throw IllegalStateException("The profile is still loading; try again")
        store.saveTrusted(uid, email, exists = answer.profile != null, emails = emails, before = answer.profile?.trustedEmails.orEmpty())
    }
}

/** A new reminder's id: random, so one that takes a freed slot is not ticked off where the one before it was. */
fun newReminderId(): String = kotlin.uuid.Uuid.random().toHexString().take(20)

/** The prefix of Add a trip's write tokens, followed by the new trip's id. */
const val NEW_TRIP_TOKEN = "list/new-trip/"
