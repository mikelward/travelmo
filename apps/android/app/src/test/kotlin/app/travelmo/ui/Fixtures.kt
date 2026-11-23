package app.travelmo.ui

import app.travelmo.data.GmailActions
import app.travelmo.data.GmailStatus
import app.travelmo.core.ParsedRecord
import app.travelmo.core.REVIEW_RECENT
import app.travelmo.core.SenderList
import app.travelmo.core.SenderPatterns
import app.travelmo.core.withLearned
import app.travelmo.data.ImportReview
import app.travelmo.data.SearchedRecords
import app.travelmo.data.TripActions
import app.travelmo.data.TripActionFailed
import app.travelmo.core.describeRegroup
import app.travelmo.core.describeDeletedTrips
import app.travelmo.core.AccessConfig
import app.travelmo.core.AccessRecord
import app.travelmo.core.AccountAccess
import app.travelmo.core.AddressHolder
import app.travelmo.core.accessDecision
import app.travelmo.core.accessInvite
import app.travelmo.core.accessRecordOf
import app.travelmo.core.accessRequest
import app.travelmo.core.accessSelfApproval
import app.travelmo.data.Seen
import app.travelmo.core.FlightStatus
import app.travelmo.core.FoundLoyalty
import app.travelmo.core.Place
import app.travelmo.core.ProfileEntry
import app.travelmo.core.ProfileField
import app.travelmo.core.RideCompany
import app.travelmo.core.RideNear
import app.travelmo.core.TravelProfile
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.SegmentType
import app.travelmo.core.SourceKind
import app.travelmo.core.SourceRef
import app.travelmo.core.Trip
import app.travelmo.data.AccountDeletion
import app.travelmo.data.AccountDeletionFailed
import app.travelmo.data.EmailLinkFailed
import app.travelmo.data.EmailLinks
import app.travelmo.data.OwnProfile
import app.travelmo.data.RideSettings
import app.travelmo.data.TripStore
import app.travelmo.notify.PushDevice
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

// The invented trips of design/android's boards, as the screenshot tests
// render them: the owner is "owner", today is 1 November 2026, and the
// Edinburgh trip is someone else's, shared with the owner.

const val OWNER = "owner"
const val OWNER_EMAIL = "owner@example.com"
const val FROZEN_NOW = "2026-11-01T12:00:00Z"

private fun trip(id: String, title: String, start: String, end: String, owner: String = OWNER, deleting: Boolean = false) =
    Trip(id, title, start, end, owner, sharedWith = if (owner == OWNER) emptyList() else listOf(OWNER_EMAIL), deleting = deleting)

val fixtureTrips = listOf(
    trip("edinburgh", "Edinburgh", "2026-10-31", "2026-11-03", owner = "partner"),
    trip("dublin", "Dublin", "2026-11-28", "2026-12-02"),
    trip("liverpool", "Liverpool", "2026-12-12", "2026-12-14"),
    trip("lisbon", "Lisbon", "2026-09-14", "2026-09-19"),
    trip("cornwall", "Cornwall", "2026-08-01", "2026-08-05", deleting = true),
    trip("paris", "Paris", "2026-03-20", "2026-03-22"),
)

// A day out the email gave only a date for: shown with no time, not 00:00.
val fixtureUntimedActivity = Segment(
    "l-gallery", "liverpool", SegmentType.ACTIVITY, "Walker Art Gallery", "2026-12-14T00:00:00+00:00",
    provider = "Example Museums", destination = Place("Walker Art Gallery", city = "Liverpool", country = "GB"),
)

// The owner's own import, which opens in Gmail.
val fixtureTrainEmail = SourceRef(SourceKind.GMAIL, "m-avanti", label = "Your Avanti West Coast tickets", uid = OWNER, at = "2026-10-20T08:00:00Z")

// The stay's booking email, a reminder the partner imported (in their
// mailbox, so no link), and the TripIt trip it was also in.
val fixtureStaySources = listOf(
    SourceRef(SourceKind.GMAIL, "m-cove", label = "Booking confirmed: Cove Liverpool", uid = OWNER, at = "2026-10-21T09:00:00Z"),
    SourceRef(SourceKind.GMAIL, "m-cove-reminder", label = "Your stay is coming up", uid = "partner", at = "2026-11-01T09:00:00Z"),
    SourceRef(SourceKind.TRIPIT, "tripit-liverpool", label = "Liverpool weekend", uid = OWNER, at = "2026-11-01T10:00:00Z"),
)

val fixtureSegments: Map<String, List<Segment>> = mapOf(
    "edinburgh" to listOf(
        Segment("e-stay", "edinburgh", SegmentType.LODGING, "Grassmarket Hotel", "2026-10-31T15:00:00+00:00", "2026-11-03T11:00:00+00:00", provider = "Grassmarket", confirmation = "GM-2210"),
    ),
    "dublin" to listOf(
        Segment(
            "d-flight", "dublin", SegmentType.FLIGHT, "FR 123 MAN to DUB", "2026-11-28T07:10:00+00:00", "2026-11-28T08:15:00+00:00",
            provider = "Example Air", confirmation = "ABC123", origin = Place("Manchester", code = "MAN", country = "GB"), destination = Place("Dublin", code = "DUB", country = "IE"),
        ),
    ),
    "liverpool" to listOf(
        Segment(
            "l-train", "liverpool", SegmentType.TRAIN, "Avanti to Liverpool", "2026-12-12T09:07:00+00:00", "2026-12-12T11:25:00+00:00",
            provider = "Avanti West Coast", confirmation = "ABC123", origin = Place("London Euston", code = "EUS"), destination = Place("Liverpool Lime Street", code = "LIV"),
            sender = "avantiwestcoast.example", sources = listOf(fixtureTrainEmail),
        ),
        Segment(
            "l-stay", "liverpool", SegmentType.LODGING, "Cove Liverpool", "2026-12-12T15:00:00+00:00", "2026-12-13T11:00:00+00:00",
            provider = "Cove", confirmation = "CV-55120", notes = "Late check-in after 22:00: call reception", sender = "cove.example", sources = fixtureStaySources, rating = 4, favorite = true,
            destination = Place("Cove Liverpool", city = "Liverpool", country = "GB"),
        ),
        Segment("l-tour", "liverpool", SegmentType.ACTIVITY, "Anfield stadium tour", "2026-12-13T14:00:00+00:00", "2026-12-13T15:30:00+00:00", provider = "Liverpool FC", confirmation = "LFC-4471"),
    ),
    // A past week in Lisbon, for the reports: two flights and a rated stay that knows its spot.
    "lisbon" to listOf(
        Segment(
            "p-out", "lisbon", SegmentType.FLIGHT, "XX 101 LHR to LIS", "2026-09-14T08:00:00+01:00", "2026-09-14T10:45:00+01:00",
            provider = "Example Air", confirmation = "LIS123", origin = Place("Heathrow", code = "LHR"), destination = Place("Lisbon", code = "LIS"),
        ),
        Segment(
            "p-stay", "lisbon", SegmentType.LODGING, "Lisbon Example Hotel", "2026-09-14T15:00:00+01:00", "2026-09-19T11:00:00+01:00",
            provider = "Example Hotels", confirmation = "LX-4412", rating = 5, favorite = true,
            destination = Place("Lisbon Example Hotel", city = "Lisbon", country = "PT", lat = 38.7223, lon = -9.1393),
        ),
        Segment(
            "p-back", "lisbon", SegmentType.FLIGHT, "XX 102 LIS to LHR", "2026-09-19T12:30:00+01:00", "2026-09-19T15:10:00+01:00",
            provider = "Example Air", confirmation = "LIS123", origin = Place("Lisbon", code = "LIS"), destination = Place("Heathrow", code = "LHR"),
        ),
    ),
)

/**
 * A trip whose stay a cancellation email cancelled, beside a live train:
 * rendered on its own (trip_detail_cancelled), so no other screen changes.
 */
// Its own dates still cover the cancelled stay; it is shown by the train's,
// as the importer leaves it (liveStart, liveEnd).
val fixtureCancelledTrip = trip("york", "York", "2027-01-15", "2027-01-17").copy(liveStart = "2027-01-15", liveEnd = "2027-01-15")
val fixtureCancelledSegments = listOf(
    Segment(
        "y-train", "york", SegmentType.TRAIN, "LNER to York", "2027-01-15T09:00:00+00:00", "2027-01-15T10:52:00+00:00",
        provider = "LNER", confirmation = "LN-7731", origin = Place("London King's Cross", code = "KGX"), destination = Place("York", code = "YRK"),
    ),
    Segment(
        "y-stay", "york", SegmentType.LODGING, "Minster View Hotel", "2027-01-15T15:00:00+00:00", "2027-01-17T11:00:00+00:00",
        provider = "Booking.com", confirmation = "4410.552.019", sender = "booking.example",
        sources = listOf(SourceRef(SourceKind.GMAIL, "m-minster", label = "Booking confirmed: Minster View Hotel", uid = OWNER, at = "2026-10-15T09:00:00Z")),
        destination = Place("Minster View Hotel", city = "York", country = "GB"),
        cancelledAt = "2026-10-28T09:00:00Z", cancelledBy = "m-cancel",
    ),
)

/**
 * A week in Boston from London with nothing booked on the ground, rendered on
 * its own (trip_detail_rides) with a company the owner added near home.
 */
val fixtureBostonTrip = trip("boston", "Boston", "2026-11-24", "2026-11-30")
private val heathrow = Place("London Heathrow", code = "LHR", city = "London", country = "GB")
private val logan = Place("Boston Logan", code = "BOS", city = "Boston", country = "US")
val fixtureBostonSegments = listOf(
    Segment("b-out", "boston", SegmentType.FLIGHT, "VS 11 LHR to BOS", "2026-11-24T17:20:00+00:00", "2026-11-24T20:15:00-05:00", provider = "Virgin Atlantic", confirmation = "E5WSJI", origin = heathrow, destination = logan),
    Segment("b-back", "boston", SegmentType.FLIGHT, "VS 12 BOS to LHR", "2026-11-29T19:00:00-05:00", "2026-11-30T07:00:00+00:00", provider = "Virgin Atlantic", confirmation = "E5WSJI", origin = logan, destination = heathrow),
)
val fixtureRideCompanies = listOf(RideCompany("Example Cars", "https://cars.example.com/book", RideNear.HOME))

private fun entry(title: String, vararg fields: Pair<String, String>) = ProfileEntry(title, fields.map { ProfileField(it.first, it.second) })

/** The owner's profile: a passport that runs out two months after Dublin, two programs, two travelers. */
val fixtureProfile = TravelProfile(
    ownerUid = OWNER,
    ownerEmail = OWNER_EMAIL,
    trustedEmails = listOf("partner@example.com"),
    travelers = listOf(entry("Ann Example", "Home city" to "Exampleton"), entry("Sam Example", "Home city" to "Exampleton")),
    loyalty = listOf(
        entry("Example Air Miles", "Account number" to "EA 1234567", "Balance" to "48200", "Elite status" to "Silver", "Elite next status" to "Gold"),
        entry("Sample Hotels Rewards", "Account number" to "SH-90211", "Points" to "12000", "Tier" to "Member"),
        entry("Example Cars Club", "Account number" to "EC 44 8812"),
    ),
    documents = listOf(entry("Passport: Ann Example", "Number" to "X1234567", "Nationality" to "GB", "Expiration date" to "2027-02-01")),
    // One more program, read from a booking email, which the owner can remove,
    // and a fellow traveler's number from another.
    foundLoyalty = listOf(
        FoundLoyalty("Cove Club", "CC 4455", status = "Member", messageId = "m-cove", label = "Your stay at Cove Liverpool", at = "2026-10-20T09:00:00Z"),
        FoundLoyalty("Example Air Miles", "EA 7654321", holder = "MR SAM EXAMPLE", messageId = "m-dub", label = "Your flight to Dublin", at = "2026-10-21T09:00:00Z", person = "Sam Example"),
    ),
)

/** A partner's profile shared with the owner: a passport that runs out before Dublin ends. */
val fixtureSharedProfile = TravelProfile(
    ownerUid = "partner",
    ownerEmail = "partner@example.com",
    trustedEmails = listOf(OWNER_EMAIL),
    documents = listOf(entry("Passport: Sam Example", "Nationality" to "GB", "Expiration date" to "2026-11-30")),
)

class FakeTripStore(
    private val trips: List<Trip> = fixtureTrips,
    private val segments: Map<String, List<Segment>> = fixtureSegments,
    private val profile: TravelProfile? = fixtureProfile,
    private val shared: List<TravelProfile> = listOf(fixtureSharedProfile),
    private val flightStatuses: Map<String, FlightStatus> = emptyMap(),
    private val addressHolder: AddressHolder = AddressHolder(),
    private val parsed: List<ParsedRecord> = fixtureParsed,
    private val gmailStatuses: List<GmailStatus> = emptyList(),
    /** Each `access/{email}` as stored, by address: the owner approved by default. */
    access: Map<String, Map<String, String>> = mapOf(OWNER_EMAIL to mapOf("email" to OWNER_EMAIL) + accessDecision(AccountAccess.APPROVED, "admin", FROZEN_NOW)),
    /** `config/access` as the owner may read it: null for someone not an admin. */
    accessConfig: AccessConfig? = null,
    /** Whether `users/{uid}` exists: every account from before approvals has one. */
    hasUserDocument: Boolean = true,
) : TripStore {
    override fun gmailStatuses(uid: String): Flow<List<GmailStatus>> = flowOf(gmailStatuses)
    /** The stored access records' fields, by address, as Firestore would merge them. */
    val accessFields = MutableStateFlow(access)
    val config = MutableStateFlow(accessConfig)

    /** The user document, null when there is none. */
    val userDoc = MutableStateFlow(if (hasUserDocument) addressHolder else null)

    /** Whether the server, not the phone's cache, gave each answer. */
    val confirmed = MutableStateFlow(true)
    override fun userDocument(uid: String): Flow<Seen<AddressHolder?>> = combine(userDoc, confirmed) { doc, server -> Seen(doc, server) }
    override fun accessRecord(email: String): Flow<Seen<AccessRecord?>> =
        combine(accessFields, confirmed) { fields, server -> Seen(fields[email]?.let(::accessRecordOf), server) }
    override fun accessConfig(): Flow<Seen<AccessConfig?>> = combine(config, confirmed) { config, server -> Seen(config, server) }
    override fun accessRecords(): Flow<List<AccessRecord>?> = accessFields.map { fields -> fields.values.mapNotNull(::accessRecordOf) }
    private fun write(email: String, fields: Map<String, String>, merge: Boolean) {
        accessFields.update { stored -> stored + (email to (if (merge) stored[email].orEmpty() else emptyMap()) + fields) }
    }

    /** Every access write's address, in order. */
    val accessWrites = mutableListOf<String>()
    override suspend fun requestAccess(email: String, uid: String, now: String) {
        accessWrites += email
        write(email, accessRequest(email, uid, now), merge = false)
    }
    override suspend fun recordSelf(email: String, uid: String, now: String) {
        accessWrites += email
        write(email, accessSelfApproval(email, uid, now), merge = false)
    }
    override suspend fun decideAccess(email: String, decision: AccountAccess, adminUid: String, now: String) {
        accessWrites += email
        write(email, mapOf("email" to email) + accessDecision(decision, adminUid, now), merge = true)
    }
    override fun latestParsed(uid: String): Flow<List<ParsedRecord>?> = flowOf(parsed.take(REVIEW_RECENT))
    override fun allParsed(uid: String): Flow<SearchedRecords> = flowOf(SearchedRecords(parsed, done = true))
    val patterns = MutableStateFlow(SenderPatterns(deny = listOf("news.example")))
    override fun senderPatterns(uid: String): Flow<SenderPatterns> = patterns
    /** When set, a save of the sender rules waits for it, as a slow write would. */
    var senderSave: kotlinx.coroutines.CompletableDeferred<Unit>? = null
    override suspend fun setSenderPatterns(uid: String, patterns: SenderPatterns) {
        senderSave?.await()
        this.patterns.value = patterns
    }
    override suspend fun learnSender(uid: String, domain: String, which: SenderList) {
        patterns.value = withLearned(patterns.value, domain, which)
    }
    override fun addressHolder(uid: String): Flow<AddressHolder> = flowOf(addressHolder)
    override fun ownProfile(uid: String): Flow<OwnProfile> = flowOf(OwnProfile(profile))
    val reminders = mutableListOf<Boolean>()

    override fun reminderEmail(uid: String): Flow<Boolean?> = flowOf(true)

    /** Every loyalty number removed from the profile, in order. */
    val removedFound = mutableListOf<FoundLoyalty>()
    override suspend fun removeFoundLoyalty(uid: String, found: FoundLoyalty) {
        removedFound += found
    }

    /** Every word on whose a membership is: program, number and person, in order. */
    val people = mutableListOf<Triple<String, String, String?>>()
    override suspend fun setLoyaltyPerson(uid: String, program: String, number: String, person: String?) {
        people += Triple(program, number, person)
    }

    /** The user document's ride fields, and every suggestion hidden, in order. */
    val rides = MutableStateFlow(RideSettings())
    val hiddenRides = mutableListOf<String>()
    override fun rideSettings(uid: String): Flow<RideSettings?> = rides
    override suspend fun hideRideNeed(uid: String, key: String) {
        hiddenRides += key
        rides.value = rides.value.copy(hidden = rides.value.hidden + key)
    }
    override suspend fun setReminderEmail(uid: String, on: Boolean) {
        reminders += on
    }
    /** Every registration write, in order: the id and its token, or null for a removal. */
    val devices = mutableListOf<Pair<String, String?>>()
    private val registered = mutableSetOf<String>()
    override fun pushDevice(uid: String, id: String): Flow<Boolean?> = flowOf(id in registered)
    override suspend fun registerDevice(uid: String, id: String, token: String) {
        devices += id to token
        registered += id
    }
    override suspend fun unregisterDevice(uid: String, id: String) {
        devices += id to null
        registered -= id
    }
    override suspend fun replaceDevice(uid: String, oldId: String, newId: String, token: String) {
        registerDevice(uid, newId, token)
        unregisterDevice(uid, oldId)
    }
    override fun sharedProfiles(addresses: List<String>): Flow<List<TravelProfile>> = flowOf(shared)
    val saved = mutableListOf<Triple<String, SegmentDraft, String?>>()
    val deleted = mutableListOf<Pair<String, String>>()
    override fun trips(uid: String, addresses: List<String>): Flow<List<Trip>> = flowOf(trips)
    override fun segments(tripId: String): Flow<List<Segment>> = flowOf(segments[tripId].orEmpty())
    override fun flightStatus(key: String): Flow<FlightStatus?> = flowOf(flightStatuses[key])
    override suspend fun saveSegment(tripId: String, draft: SegmentDraft, existingId: String?) {
        saved += Triple(tripId, draft, existingId)
    }
    override suspend fun deleteSegment(tripId: String, segmentId: String) {
        deleted += tripId to segmentId
    }
    val restored = mutableListOf<Pair<String, String>>()
    override suspend fun restoreSegment(tripId: String, segmentId: String) {
        restored += tripId to segmentId
    }
    val trusted = mutableListOf<Triple<String, Boolean, List<String>>>()
    /** The list each save replaced, whose addresses are not invited again. */
    val trustedBefore = mutableListOf<List<String>>()
    override suspend fun saveTrusted(uid: String, email: String?, exists: Boolean, emails: List<String>, before: List<String>) {
        trusted += Triple(uid, exists, emails)
        trustedBefore += before
    }
    val renamed = mutableListOf<Pair<String, String>>()
    val fitted = mutableListOf<String>()
    val sharedWith = mutableListOf<Pair<String, String>>()
    val unshared = mutableListOf<Pair<String, String>>()
    val deletedTrips = mutableListOf<String>()
    val moved = mutableListOf<Triple<String, String, String>>()
    val merged = mutableListOf<Pair<String, String>>()
    override suspend fun renameTrip(tripId: String, title: String) {
        renamed += tripId to title
    }
    override suspend fun fitTripDates(tripId: String): Boolean {
        fitted += tripId
        return true
    }
    override suspend fun shareTrip(tripId: String, email: String, inviterUid: String) {
        sharedWith += tripId to email
        write(email, accessInvite(email, inviterUid, FROZEN_NOW), merge = true)
    }
    override suspend fun unshareTrip(tripId: String, email: String) {
        unshared += tripId to email
    }
    override suspend fun deleteTrip(tripId: String) {
        deletedTrips += tripId
    }
    override suspend fun moveSegment(fromTripId: String, segmentId: String, toTripId: String) {
        moved += Triple(fromTripId, segmentId, toTripId)
    }
    override suspend fun mergeTrips(sourceId: String, targetId: String): Int {
        merged += sourceId to targetId
        return segments[sourceId].orEmpty().size
    }
}

/** A phone with a messaging token, remembering its registration in memory. */
class FakePushDevice(private val token: String? = "fcm-token-1") : PushDevice {
    val remembered = mutableMapOf<String, String>()
    override val latest = MutableStateFlow<String?>(null)
    override suspend fun token(): String? = token.also { latest.value = it }
    override fun remember(uid: String, id: String?) {
        if (id == null) remembered.remove(uid) else remembered[uid] = id
    }
    override fun remembered(uid: String): String? = remembered[uid]
    override fun tokenKnown(token: String?) {
        latest.value = token
    }
}

/** The parser's linking of email addresses, refusing with [failure] when given. */
class FakeEmailLinks(private val failure: String? = null) : EmailLinks {
    val added = mutableListOf<String>()
    val removed = mutableListOf<String>()
    override val available = true
    override suspend fun add(email: String) {
        failure?.let { throw EmailLinkFailed(it) }
        added += email
    }
    override suspend fun remove(email: String) {
        removed += email
    }
}

/** The parser's account deletion, failing with [failure] when given. */
class FakeAccountDeletion(private val failure: String? = null) : AccountDeletion {
    var calls = 0
    override val available = true
    override suspend fun deleteAccount() {
        calls++
        failure?.let { throw AccountDeletionFailed(it) }
    }
}

/** Regrouping and deleting all trips as the parser would answer, counting calls; a [failure] message throws. */
class FakeTripActions(private val failure: String? = null) : TripActions {
    val calls = mutableListOf<String>()
    override val available = true
    override suspend fun regroup(): String {
        calls += "regroup"
        failure?.let { throw TripActionFailed(it) }
        return describeRegroup(2, 1)
    }
    override suspend fun deleteAll(): String {
        calls += "deleteAll"
        failure?.let { throw TripActionFailed(it) }
        return describeDeletedTrips(3)
    }
}

/**
 * Import review's records, newest read first: an e-ticket read early in a
 * big import (sent in May), a newsletter the rules already skip, an
 * imported booking (not listed) and a TripIt item (no sender to teach).
 */
val fixtureParsed = listOf(
    ParsedRecord("news", "filtered", "2026-11-23T12:00:00Z", from = "News <hello@news.example>", subject = "Our winter sale", reason = "sender news.example denied", sentAt = "2026-11-20T09:00:00Z"),
    ParsedRecord("booked", "imported", "2026-11-23T11:00:00Z", from = "Cove <stay@cove.example>", subject = "Your stay at Cove Liverpool"),
    ParsedRecord("tripit", "failed", "2026-11-23T10:30:00Z", source = "tripit", subject = "Dublin", reason = "Couldn't read it"),
    ParsedRecord("ticket", "not_booking", "2026-11-23T10:00:00Z", from = "Example Air <tickets@air.example>", subject = "Example Air e-Ticket XY12AB", sentAt = "2026-05-23T07:22:58Z"),
)

/** Import anyway as the parser would answer, recording the messages asked for. */
class FakeImportReview : ImportReview {
    val asked = mutableListOf<String>()
    override val available = true
    override suspend fun reimport(messageId: String): String {
        asked += messageId
        return "Imported"
    }
}

/** Gmail's parser routes as they would answer, recording what was asked. */
class FakeGmailActions : GmailActions {
    val calls = mutableListOf<String>()
    override val available = true
    override suspend fun connectUrl(): String {
        calls += "connect"
        return "https://accounts.example/consent"
    }
    override suspend fun start(emailAddress: String, restart: Boolean) {
        calls += "${if (restart) "restart" else "start"} $emailAddress"
    }
    override suspend fun stop(emailAddress: String) {
        calls += "stop $emailAddress"
    }
    override suspend fun disconnect(emailAddress: String) {
        calls += "disconnect $emailAddress"
    }
}
