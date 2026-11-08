package app.travelmo.ui

import app.travelmo.core.Place
import app.travelmo.core.ProfileEntry
import app.travelmo.core.ProfileField
import app.travelmo.core.TravelProfile
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.SegmentType
import app.travelmo.core.Trip
import app.travelmo.data.OwnProfile
import app.travelmo.data.TripStore
import app.travelmo.notify.PushDevice
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf

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
            sender = "avantiwestcoast.example", sourceCount = 1,
        ),
        Segment(
            "l-stay", "liverpool", SegmentType.LODGING, "Cove Liverpool", "2026-12-12T15:00:00+00:00", "2026-12-13T11:00:00+00:00",
            provider = "Cove", confirmation = "CV-55120", notes = "Late check-in after 22:00: call reception", sender = "cove.example", sourceCount = 2, rating = 4, favorite = true,
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
) : TripStore {
    override fun ownProfile(uid: String): Flow<OwnProfile> = flowOf(OwnProfile(profile))
    val reminders = mutableListOf<Boolean>()
    override fun reminderEmail(uid: String): Flow<Boolean?> = flowOf(true)
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
    override fun sharedProfiles(email: String?): Flow<List<TravelProfile>> = flowOf(shared)
    val saved = mutableListOf<Triple<String, SegmentDraft, String?>>()
    val deleted = mutableListOf<Pair<String, String>>()
    override fun trips(uid: String, email: String?): Flow<List<Trip>> = flowOf(trips)
    override fun segments(tripId: String): Flow<List<Segment>> = flowOf(segments[tripId].orEmpty())
    override suspend fun saveSegment(tripId: String, draft: SegmentDraft, existingId: String?) {
        saved += Triple(tripId, draft, existingId)
    }
    override suspend fun deleteSegment(tripId: String, segmentId: String) {
        deleted += tripId to segmentId
    }
    val trusted = mutableListOf<Triple<String, Boolean, List<String>>>()
    override suspend fun saveTrusted(uid: String, email: String?, exists: Boolean, emails: List<String>) {
        trusted += Triple(uid, exists, emails)
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
    override suspend fun shareTrip(tripId: String, email: String) {
        sharedWith += tripId to email
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
