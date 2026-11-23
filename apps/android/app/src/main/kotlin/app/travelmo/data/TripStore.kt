package app.travelmo.data

import app.travelmo.core.AccessConfig
import app.travelmo.core.AccessRecord
import app.travelmo.core.AccountAccess
import app.travelmo.core.AddressHolder
import app.travelmo.core.accessDecision
import app.travelmo.core.accessInvite
import app.travelmo.core.accessRecordOf
import app.travelmo.core.accessRequest
import app.travelmo.core.accessSelfApproval
import app.travelmo.core.emailAddressOf
import app.travelmo.core.FlightStatus
import app.travelmo.core.FoundLoyalty
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.flow
import app.travelmo.core.withLearned
import app.travelmo.core.SenderPatterns
import app.travelmo.core.SenderList
import app.travelmo.core.REVIEW_SEARCH_CAP
import app.travelmo.core.REVIEW_RECENT
import app.travelmo.core.ParsedRecord
import app.travelmo.core.withLoyaltyPerson
import app.travelmo.core.HomeCorrection
import app.travelmo.core.MAX_HIDDEN_RIDE_NEEDS
import app.travelmo.core.RideCompany
import app.travelmo.core.rideCompanyOrNull
import app.travelmo.core.queryAddresses
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.localDate
import app.travelmo.core.TravelProfile
import app.travelmo.core.Trip
import app.travelmo.core.MAX_TRUSTED
import app.travelmo.core.normalizeEmail
import app.travelmo.core.normalizeTrusted
import app.travelmo.core.segmentDateRange
import app.travelmo.core.bookedDateRange
import app.travelmo.core.liveBounds
import app.travelmo.core.widenedFor
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import com.mikelward.androidlog.sensitive
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import java.time.Instant

/** What the screens read and write; Firestore in the app, a fake in tests. */
interface TripStore {
    /** The user's own trips and those shared with any of their [addresses] (SPEC "Linked email addresses"), live. */
    fun trips(uid: String, addresses: List<String>): Flow<List<Trip>>

    /** One trip's bookings, live; empty while it loads. */
    fun segments(tripId: String): Flow<List<Segment>>

    /** A flight's live gates and carousel by its key (flightStatusKey); null until the parser has looked. */
    fun flightStatus(key: String): Flow<FlightStatus?>

    /** The user's own travel profile, live, from its first answer on: an answer with no profile is one too. A read that fails is logged and keeps the caller waiting. */
    fun ownProfile(uid: String): Flow<OwnProfile>

    /** The profiles shared with any of the user's [addresses], live. */
    fun sharedProfiles(addresses: List<String>): Flow<List<TravelProfile>>

    /**
     * What the user document says of the user's addresses (those confirmed,
     * the connected Gmail, those waiting for confirmation), live; an empty
     * one when there is no document or it cannot be read.
     */
    fun addressHolder(uid: String): Flow<AddressHolder>

    /** Whether the user asked for reminders by email (`reminders.email` on their user document), live; null while it loads. */
    fun reminderEmail(uid: String): Flow<Boolean?>

    /** Turns reminders by email on or off, as the web's Settings does: a merge of `reminders.email` alone. */
    suspend fun setReminderEmail(uid: String, on: Boolean)

    /**
     * What car and ride suggestions need from the user document, live: the
     * user's own companies (`rideCompanies`, edited on the web), the
     * suggestions they hid (`hiddenRideNeeds`) and their corrections to home
     * (`homes`); null while it loads.
     */
    fun rideSettings(uid: String): Flow<RideSettings?>

    /** Hides one ride suggestion for good, in a transaction over the stored list, as the web does. */
    suspend fun hideRideNeed(uid: String, key: String)

    /** Removes a loyalty number found in the owner's emails, in a transaction over the stored list, as the web does. */
    suspend fun removeFoundLoyalty(uid: String, found: FoundLoyalty)

    /**
     * The Gmail mailboxes the user connected (`gmails` on their user
     * document), oldest first, each with how far the last reading of it got,
     * live; empty when none is connected or the document cannot be read. A
     * source email opens in the one it came from, as on the web.
     */
    fun gmailStatuses(uid: String): Flow<List<GmailStatus>>

    /** The [REVIEW_RECENT] import records read last, newest first, live; null while they load. */
    fun latestParsed(uid: String): Flow<List<ParsedRecord>?>

    /**
     * Every import record, newest first, read once in pages for a search, up
     * to [REVIEW_SEARCH_CAP]: each page emits what has been read so far, the
     * last with `done`. A failed page ends it with what was read.
     */
    fun allParsed(uid: String): Flow<SearchedRecords>

    /** The user's sender rules, live; empty when they have none. */
    fun senderPatterns(uid: String): Flow<SenderPatterns>

    /** Teaches the parser a sender ([withLearned]), on the rules as stored now. */
    suspend fun learnSender(uid: String, domain: String, which: SenderList)

    /** Replaces both lists of sender rules, as the web's Settings saves them. */
    suspend fun setSenderPatterns(uid: String, patterns: SenderPatterns)

    /** Says whose a membership is ([person] null: the owner's), as the web's setLoyaltyPerson. */
    suspend fun setLoyaltyPerson(uid: String, program: String, number: String, person: String?)

    /** Whether this phone (`users/{uid}/devices/{id}`) is registered for reminders as notifications, live; null while it loads. */
    fun pushDevice(uid: String, id: String): Flow<Boolean?>

    /** Registers this phone's token under the user and turns `reminders.push` on, as a browser's subscribe does. */
    suspend fun registerDevice(uid: String, id: String, token: String)

    /** Forgets this phone; `reminders.push` goes off with the last phone when no browser is subscribed either. */
    suspend fun unregisterDevice(uid: String, id: String)

    /** A refreshed token: the new registration in, then the old out, so delivery never lapses. */
    suspend fun replaceDevice(uid: String, oldId: String, newId: String, token: String)

    /**
     * Sets who the user's travel profile is shared with, starting the profile
     * if there is none yet ([exists] false), and invites each address not in
     * [before] in the same batch (SPEC "Access", "Sharing invites").
     */
    suspend fun saveTrusted(uid: String, email: String?, exists: Boolean, emails: List<String>, before: List<String> = emptyList())

    /**
     * Whether `users/{uid}` exists (null when it doesn't) and what it says of
     * the user's addresses, live, as access is decided on it (SPEC "Access").
     * A read that fails answers as no document.
     */
    fun userDocument(uid: String): Flow<Seen<AddressHolder?>>

    /** The verified address's `access/{email}`, live; null when there is none or it can't be read. */
    fun accessRecord(email: String): Flow<Seen<AccessRecord?>>

    /** `config/access`, live; null for everyone but admins, whom alone the rules let read it. */
    fun accessConfig(): Flow<Seen<AccessConfig?>>

    /** Every access record, live, for the Access page (admins alone may list them); null while they load. */
    fun accessRecords(): Flow<List<AccessRecord>?>

    /** Asks for access for the signed-in, verified [email] (accessRequest). */
    suspend fun requestAccess(email: String, uid: String, now: String)

    /** Records an account from before approvals as approved by itself, so admins see it (accessSelfApproval). */
    suspend fun recordSelf(email: String, uid: String, now: String)

    /** An admin's decision on [email]: approve (or invite an address that never asked), decline or revoke (accessDecision). */
    suspend fun decideAccess(email: String, decision: AccountAccess, adminUid: String, now: String)

    /** Writes a booking, new ([existingId] null) or edited, widening the trip's dates to hold it. */
    suspend fun saveSegment(tripId: String, draft: SegmentDraft, existingId: String?)

    suspend fun deleteSegment(tripId: String, segmentId: String)

    /** Takes back a cancellation an email set, widening the trip to hold the booking again. */
    suspend fun restoreSegment(tripId: String, segmentId: String)

    /** The owner's powers over a trip, as the web's edits.ts has them. */
    suspend fun renameTrip(tripId: String, title: String)

    /** Sets the trip's dates to its bookings' span; false when it has none. Owner only. */
    suspend fun fitTripDates(tripId: String): Boolean

    /**
     * Shares the trip with an address, inviting it in the same batch as
     * [inviterUid] (SPEC "Access", "Sharing invites"), or stops. Owner only.
     */
    suspend fun shareTrip(tripId: String, email: String, inviterUid: String)

    suspend fun unshareTrip(tripId: String, email: String)

    /** Marks the trip deleting, removes its bookings, then the trip; safe to call again if interrupted. Owner only. */
    suspend fun deleteTrip(tripId: String)

    /** Moves a booking to another trip the viewer can edit, keeping its id; the target widens to hold it. */
    suspend fun moveSegment(fromTripId: String, segmentId: String, toTripId: String)

    /** Moves every booking of the source into the target and deletes the source; how many moved. Owner of the source only. */
    suspend fun mergeTrips(sourceId: String, targetId: String): Int
}

class TripGoneException(message: String) : Exception(message)

/**
 * A document's answer, and whether the server gave it rather than this
 * phone's cache: a document missing from the cache may only be missing from
 * the cache, so "not approved" waits for the server's word (as the web's
 * useAccess does).
 */
data class Seen<T>(val value: T, val confirmed: Boolean)

/** The user document's fields for car and ride suggestions (SPEC "Car and ride suggestions"). */
data class RideSettings(
    val companies: List<RideCompany> = emptyList(),
    val hidden: List<String> = emptyList(),
    val homes: List<HomeCorrection> = emptyList(),
)

/** The fields as stored; an entry that does not parse is left out, as on the web. */
internal fun rideSettingsOf(data: Map<String, Any?>?): RideSettings {
    val companies = (data?.get("rideCompanies") as? List<*>).orEmpty().mapNotNull { entry ->
        val map = entry as? Map<*, *> ?: return@mapNotNull null
        rideCompanyOrNull(map["name"] as? String, map["url"] as? String, map["near"] as? String)
    }
    val hidden = (data?.get("hiddenRideNeeds") as? List<*>).orEmpty().filterIsInstance<String>()
    val homes = (data?.get("homes") as? List<*>).orEmpty().mapNotNull { entry ->
        val map = entry as? Map<*, *> ?: return@mapNotNull null
        val city = (map["city"] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        // A date that isn't one would throw where home is worked out.
        val from = (map["from"] as? String)?.takeIf { isCalendarDate(it) } ?: return@mapNotNull null
        HomeCorrection(city, (map["country"] as? String)?.takeIf { it.length == 2 }, from)
    }
    return RideSettings(companies, hidden, homes)
}

private fun isCalendarDate(text: String): Boolean = try {
    java.time.LocalDate.parse(text)
    true
} catch (e: java.time.format.DateTimeParseException) {
    // Left out, as the web's schema leaves it out; logged without the value.
    TravelmoLog.warning("A home correction with a malformed date was left out")
    false
}

/** The hidden list with [key] added, keeping the newest when it is full. */
internal fun withHidden(hidden: List<String>, key: String): List<String> = (hidden.filter { it != key } + key).takeLast(MAX_HIDDEN_RIDE_NEEDS)

/** What the profile document answered: the profile, or none yet. Distinct from not having answered at all. */
data class OwnProfile(val profile: TravelProfile?)

/**
 * The same queries the web app makes (SPEC.md "The trip list"), each a
 * snapshot listener, so a change made elsewhere shows up on its own and
 * Firestore's own cache answers them offline.
 */
/** What a search has read so far, and whether it has read them all. */
data class SearchedRecords(val records: List<ParsedRecord>, val done: Boolean)

// Records a search reads at a time.
private const val SEARCH_PAGE = 1000

class FirestoreTrips(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) : TripStore {
    override fun trips(uid: String, addresses: List<String>): Flow<List<Trip>> {
        // One query failing (the rules refusing it, say) must not hold the
        // whole list at "loading": it answers with nothing and is logged.
        val own = db.collection("trips").whereEqualTo("ownerUid", uid).snapshots().orNothing("own trips")
        // Any of the user's addresses, in one query.
        val asked = queryAddresses(addresses)
        val shared = if (asked.isEmpty()) flowOf(null) else db.collection("trips").whereArrayContainsAny("sharedWith", asked).snapshots().orNothing("shared trips")
        return combine(own, shared) { mine, theirs ->
            val byId = LinkedHashMap<String, Trip>()
            for (snapshot in listOfNotNull(mine, theirs)) {
                for (doc in snapshot.documents) {
                    val trip = tripFromDocument(doc.id, doc.data ?: emptyMap())
                    if (trip == null) TravelmoLog.warning("Malformed trip %s", sensitive(doc.reference.path)) else byId[trip.id] = trip
                }
            }
            byId.values.toList()
        }
    }

    override fun segments(tripId: String): Flow<List<Segment>> =
        db.collection("trips").document(tripId).collection("segments").snapshots().orNothing("segments of $tripId").map { snapshot ->
            snapshot?.documents.orEmpty().mapNotNull { doc ->
                segmentFromDocument(doc.id, tripId, doc.data ?: emptyMap()).also {
                    if (it == null) TravelmoLog.warning("Malformed segment %s", sensitive(doc.reference.path))
                }
            }
        }

    override fun flightStatus(key: String): Flow<FlightStatus?> = callbackFlow {
        val registration = db.collection("flightStatus").document(key).addSnapshotListener { snapshot, error ->
            if (error != null) {
                TravelmoLog.error(error, "Reading the status of flight %s failed", sensitive(key))
                trySend(null)
                return@addSnapshotListener
            }
            val status = snapshot?.data?.let(::flightStatusFromDocument)
            if (snapshot?.exists() == true && status == null) TravelmoLog.warning("Malformed flight status %s", sensitive(key))
            trySend(status)
        }
        awaitClose { registration.remove() }
    }

    override fun ownProfile(uid: String): Flow<OwnProfile> = callbackFlow {
        val registration = db.collection("users").document(uid).collection("travelProfile").document("main").addSnapshotListener { snapshot, error ->
            if (error != null) {
                // Nothing is sent: a profile that could not be read is not one
                // that is absent, and sharing must not start a new one over it.
                TravelmoLog.error(error, "Reading the travel profile failed")
                return@addSnapshotListener
            }
            trySend(OwnProfile(snapshot?.data?.let(::profileFromDocument)))
        }
        awaitClose { registration.remove() }
    }

    override fun sharedProfiles(addresses: List<String>): Flow<List<TravelProfile>> {
        val asked = queryAddresses(addresses)
        if (asked.isEmpty()) return flowOf(emptyList())
        return db.collectionGroup("travelProfile").whereArrayContainsAny("trustedEmails", asked).snapshots().orNothing("shared profiles").map { snapshot ->
            snapshot?.documents.orEmpty().mapNotNull { doc -> profileFromDocument(doc.data ?: emptyMap()) }
        }
    }

    override fun addressHolder(uid: String): Flow<AddressHolder> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                // The sign-in alone still finds what was shared with it.
                TravelmoLog.error(error, "Reading the user document for the email addresses failed")
                trySend(AddressHolder())
                return@addSnapshotListener
            }
            trySend(snapshot?.data?.let(::addressHolderFromDocument) ?: AddressHolder())
        }
        awaitClose { registration.remove() }
    }

    override fun reminderEmail(uid: String): Flow<Boolean?> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                TravelmoLog.error(error, "Reading the user document failed")
                trySend(null)
                return@addSnapshotListener
            }
            val reminders = snapshot?.get("reminders") as? Map<*, *>
            trySend(reminders?.get("email") == true)
        }
        awaitClose { registration.remove() }
    }

    override suspend fun setReminderEmail(uid: String, on: Boolean) {
        db.collection("users").document(uid).set(mapOf("reminders" to mapOf("email" to on)), SetOptions.merge()).await()
    }

    override fun rideSettings(uid: String): Flow<RideSettings?> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                TravelmoLog.error(error, "Reading the user document for ride suggestions failed")
                trySend(null)
                return@addSnapshotListener
            }
            trySend(rideSettingsOf(snapshot?.data))
        }
        awaitClose { registration.remove() }
    }

    override suspend fun removeFoundLoyalty(uid: String, found: FoundLoyalty) {
        val ref = db.collection("users").document(uid).collection("travelProfile").document("main")
        db.runTransaction { tx ->
            val stored = (tx.get(ref).get("foundLoyalty") as? List<*>).orEmpty()
            val kept = stored.filterNot { (it as? Map<*, *>)?.let { m -> m["program"] == found.program && m["number"] == found.number } == true }
            tx.update(ref, mapOf("foundLoyalty" to kept, "updatedAt" to Instant.now().toString()))
        }.await()
    }

    override suspend fun setLoyaltyPerson(uid: String, program: String, number: String, person: String?) {
        val ref = db.collection("users").document(uid).collection("travelProfile").document("main")
        db.runTransaction { tx ->
            // From the list as stored now, so a word given meanwhile on another one stays.
            val current = loyaltyPeopleOf(tx.get(ref).get("loyaltyPeople"))
            val next = withLoyaltyPerson(current, program, number, person).map { p ->
                buildMap { put("program", p.program); put("number", p.number); p.person?.let { put("person", it) } }
            }
            tx.update(ref, mapOf("loyaltyPeople" to next, "updatedAt" to Instant.now().toString()))
        }.await()
    }

    override fun gmailStatuses(uid: String): Flow<List<GmailStatus>> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                // Shown as not connected; source links open the phone's default Gmail account.
                TravelmoLog.error(error, "Reading the Gmail connections failed")
                trySend(emptyList())
                return@addSnapshotListener
            }
            trySend(gmailStatusesOf(snapshot?.data))
        }
        awaitClose { registration.remove() }
    }

    override fun latestParsed(uid: String): Flow<List<ParsedRecord>?> = callbackFlow {
        val query = db.collection("users").document(uid).collection("parsedMessages")
            .orderBy("processedAt", Query.Direction.DESCENDING).limit(REVIEW_RECENT.toLong())
        val registration = query.addSnapshotListener { snapshot, error ->
            if (error != null) {
                TravelmoLog.error(error, "Reading the import records failed")
                trySend(emptyList())
                return@addSnapshotListener
            }
            trySend(snapshot?.documents.orEmpty().mapNotNull { parsedRecordOf(it.id, it.data) })
        }
        awaitClose { registration.remove() }
    }

    override fun allParsed(uid: String): Flow<SearchedRecords> = flow {
        val base = db.collection("users").document(uid).collection("parsedMessages").orderBy("processedAt", Query.Direction.DESCENDING)
        val read = mutableListOf<ParsedRecord>()
        var last: DocumentSnapshot? = null
        while (true) {
            val page = try {
                (last?.let { base.startAfter(it) } ?: base).limit(SEARCH_PAGE.toLong()).get().await()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                TravelmoLog.error(e, "Reading import records for a search failed")
                emit(SearchedRecords(read.toList(), done = true))
                return@flow
            }
            read += page.documents.mapNotNull { parsedRecordOf(it.id, it.data) }
            last = page.documents.lastOrNull()
            val done = page.size() < SEARCH_PAGE || read.size >= REVIEW_SEARCH_CAP
            emit(SearchedRecords(read.toList(), done))
            if (done) return@flow
        }
    }

    override fun senderPatterns(uid: String): Flow<SenderPatterns> = callbackFlow {
        val registration = db.document("users/$uid/settings/patterns").addSnapshotListener { snapshot, error ->
            if (error != null) {
                TravelmoLog.error(error, "Reading the sender rules failed")
                trySend(SenderPatterns())
                return@addSnapshotListener
            }
            trySend(senderPatternsOf(snapshot?.data))
        }
        awaitClose { registration.remove() }
    }

    override suspend fun setSenderPatterns(uid: String, patterns: SenderPatterns) {
        // Merged, so any other field of the document stays.
        db.document("users/$uid/settings/patterns").set(mapOf("allow" to patterns.allow, "deny" to patterns.deny), SetOptions.merge()).await()
    }

    override suspend fun learnSender(uid: String, domain: String, which: SenderList) {
        val ref = db.document("users/$uid/settings/patterns")
        db.runTransaction { tx ->
            val next = withLearned(senderPatternsOf(tx.get(ref).data), domain, which)
            // Merged, so any other field of the document stays.
            tx.set(ref, mapOf("allow" to next.allow, "deny" to next.deny), SetOptions.merge())
        }.await()
    }

    override suspend fun hideRideNeed(uid: String, key: String) {
        val ref = db.collection("users").document(uid)
        db.runTransaction { tx ->
            val stored = (tx.get(ref).get("hiddenRideNeeds") as? List<*>).orEmpty().filterIsInstance<String>()
            tx.set(ref, mapOf("hiddenRideNeeds" to withHidden(stored, key)), SetOptions.merge())
        }.await()
    }

    override fun pushDevice(uid: String, id: String): Flow<Boolean?> = callbackFlow {
        val registration = deviceRef(uid, id).addSnapshotListener { snapshot, error ->
            if (error != null) {
                TravelmoLog.error(error, "Reading the device registration failed")
                trySend(null)
                return@addSnapshotListener
            }
            trySend(snapshot?.exists() == true)
        }
        awaitClose { registration.remove() }
    }

    override suspend fun registerDevice(uid: String, id: String, token: String) {
        deviceRef(uid, id).set(mapOf("token" to token, "platform" to "android", "createdAt" to Instant.now().toString())).await()
        db.collection("users").document(uid).set(mapOf("reminders" to mapOf("push" to true)), SetOptions.merge()).await()
    }

    override suspend fun unregisterDevice(uid: String, id: String) {
        deviceRef(uid, id).delete().await()
        // As the web's unsubscribe: the flag goes off only once nothing of
        // the user's is left to send to, on either kind of channel.
        val devices = db.collection("users").document(uid).collection("devices").limit(1).get().await()
        val browsers = db.collection("users").document(uid).collection("pushSubscriptions").limit(1).get().await()
        if (devices.isEmpty && browsers.isEmpty) {
            db.collection("users").document(uid).set(mapOf("reminders" to mapOf("push" to false)), SetOptions.merge()).await()
        }
    }

    override suspend fun replaceDevice(uid: String, oldId: String, newId: String, token: String) {
        registerDevice(uid, newId, token)
        deviceRef(uid, oldId).delete().await()
    }

    private fun deviceRef(uid: String, id: String): DocumentReference = db.collection("users").document(uid).collection("devices").document(id)

    /**
     * As the web's saveTrusted: a merge, so it starts a profile before any
     * import and, on one that exists, touches only the list (the rules
     * refuse anything else).
     */
    override suspend fun saveTrusted(uid: String, email: String?, exists: Boolean, emails: List<String>, before: List<String>) {
        val trusted = normalizeTrusted(emails, email)
        if (trusted.size > MAX_TRUSTED) throw IllegalArgumentException("Share with at most $MAX_TRUSTED people.")
        val now = Instant.now().toString()
        val doc = LinkedHashMap<String, Any>()
        if (!exists) {
            doc["ownerUid"] = uid
            normalizeEmail(email)?.let { doc["ownerEmail"] = it }
        }
        doc["trustedEmails"] = trusted
        doc["updatedAt"] = now
        db.runBatch { batch ->
            batch.set(db.collection("users").document(uid).collection("travelProfile").document("main"), doc, SetOptions.merge())
            // Each address newly trusted is invited in the same write, so it
            // can open the profile without asking for access.
            for (address in trusted) {
                if (address !in before && emailAddressOf(address) == address) batch.set(accessRef(address), accessInvite(address, uid, now), SetOptions.merge())
            }
        }.await()
    }

    override fun userDocument(uid: String): Flow<Seen<AddressHolder?>> =
        db.collection("users").document(uid).seen(
            read = { snapshot -> if (snapshot.exists()) addressHolderFromDocument(snapshot.data.orEmpty()) else null },
            onError = { error ->
                TravelmoLog.error(error, "Reading the user document for access failed")
                null
            },
        )

    override fun accessRecord(email: String): Flow<Seen<AccessRecord?>> =
        accessRef(email).seen(
            read = { snapshot ->
                if (!snapshot.exists()) {
                    null
                } else {
                    accessRecordOf(snapshot.data.orEmpty()).also { if (it == null) TravelmoLog.warning("Skipping a malformed access record") }
                }
            },
            onError = { error ->
                TravelmoLog.error(error, "Reading the access record failed")
                null
            },
        )

    override fun accessConfig(): Flow<Seen<AccessConfig?>> =
        db.collection("config").document("access").seen(
            read = { snapshot -> if (snapshot.exists()) AccessConfig((snapshot.get("admins") as? List<*>).orEmpty().filterIsInstance<String>()) else null },
            onError = { error ->
                // Expected for everyone but admins: the list is theirs alone
                // to read, so a refusal means "not an admin".
                if (error.code == FirebaseFirestoreException.Code.PERMISSION_DENIED) {
                    TravelmoLog.verbose("The admins' list is not readable: not an admin")
                } else {
                    TravelmoLog.error(error, "Reading the admins' list failed")
                }
                null
            },
        )

    override fun accessRecords(): Flow<List<AccessRecord>?> = callbackFlow {
        val registration = db.collection("access").addSnapshotListener { snapshot, error ->
            if (error != null) {
                TravelmoLog.error(error, "Access records subscription failed")
                return@addSnapshotListener
            }
            trySend(
                snapshot?.documents.orEmpty().mapNotNull { doc ->
                    accessRecordOf(doc.data.orEmpty()).also { if (it == null) TravelmoLog.warning("Skipping malformed access record %s", sensitive(doc.id)) }
                },
            )
        }
        awaitClose { registration.remove() }
    }

    override suspend fun requestAccess(email: String, uid: String, now: String) {
        accessRef(email).set(accessRequest(email, uid, now)).await()
    }

    override suspend fun recordSelf(email: String, uid: String, now: String) {
        accessRef(email).set(accessSelfApproval(email, uid, now)).await()
    }

    override suspend fun decideAccess(email: String, decision: AccountAccess, adminUid: String, now: String) {
        accessRef(email).set(mapOf("email" to email) + accessDecision(decision, adminUid, now), SetOptions.merge()).await()
    }

    private fun accessRef(email: String): DocumentReference = db.collection("access").document(email)

    /** A document's every answer with whether the server gave it; [onError] answers a failure, which ends the listener. */
    private fun <T> DocumentReference.seen(read: (DocumentSnapshot) -> T, onError: (FirebaseFirestoreException) -> T): Flow<Seen<T>> = callbackFlow {
        val registration = addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
            if (error != null) {
                trySend(Seen(onError(error), confirmed = true))
                return@addSnapshotListener
            }
            if (snapshot != null) trySend(Seen(read(snapshot), confirmed = !snapshot.metadata.isFromCache))
        }
        awaitClose { registration.remove() }
    }

    /**
     * As the web's saveSegment: one transaction reads the trip and the stored
     * booking, writes the booking with the form's fields over what was
     * stored, and widens the trip's dates to hold it. Bounds never shrink
     * here, since a client transaction cannot read every booking. A cancelled
     * booking stays cancelled and, counting for none of the trip's dates,
     * moves only its revision.
     */
    override suspend fun saveSegment(tripId: String, draft: SegmentDraft, existingId: String?) {
        val now = Instant.now().toString()
        val tripRef = db.collection("trips").document(tripId)
        val segmentRef = if (existingId != null) tripRef.collection("segments").document(existingId) else tripRef.collection("segments").document()
        val range = listOfNotNull(draft.start, draft.end).map { localDate(it) }
        db.runTransaction { t ->
            val tripSnap = t.get(tripRef)
            if (!tripSnap.exists()) throw TripGoneException("Trip no longer exists")
            if (tripSnap.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
            val stored = if (existingId != null) t.get(segmentRef).data else null
            t.set(segmentRef, draftToDocument(draft, stored, segmentRef.id, tripId, now))
            // A cancelled booking widens only the trip's own dates.
            val booked = range.min() to range.max()
            t.update(tripRef, widened(tripSnap, booked, if (stored?.get("cancelledAt") is String) null else booked, now))
            null
        }.await()
    }

    override suspend fun deleteSegment(tripId: String, segmentId: String) {
        val tripRef = db.collection("trips").document(tripId)
        db.runBatch { batch ->
            batch.delete(tripRef.collection("segments").document(segmentId))
            batch.update(tripRef, mapOf("updatedAt" to Instant.now().toString()))
        }.await()
    }

    /**
     * As the web's restoreSegment: the booking counts again, so the trip
     * widens to hold it (Fit dates may have narrowed the trip meanwhile).
     */
    override suspend fun restoreSegment(tripId: String, segmentId: String) {
        val now = Instant.now().toString()
        val tripRef = db.collection("trips").document(tripId)
        val segmentRef = tripRef.collection("segments").document(segmentId)
        db.runTransaction { t ->
            val trip = t.get(tripRef)
            val current = t.get(segmentRef)
            if (!trip.exists()) throw TripGoneException("Trip no longer exists")
            if (!current.exists()) throw TripGoneException("That booking is no longer in this trip")
            if (trip.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
            val data = current.data ?: throw TripGoneException("That booking is no longer in this trip")
            val restored = segmentFromDocument(segmentId, tripId, data)?.copy(cancelledAt = null, cancelledBy = null)
            val range = restored?.let { segmentDateRange(listOf(it)) }
            // The cancellation is remembered as taken back, and when: reading
            // the booking's confirmation again, or any cancellation sent
            // before now, doesn't cancel it again.
            val restoredFrom = (data["cancelledBy"] as? String)?.let { mapOf("restoredFrom" to FieldValue.arrayUnion(it)) }.orEmpty()
            t.update(segmentRef, mapOf("cancelledAt" to FieldValue.delete(), "cancelledBy" to FieldValue.delete(), "cancelledSentAt" to FieldValue.delete(), "restoredAt" to now, "updatedAt" to now) + restoredFrom)
            t.update(tripRef, if (range != null) widened(trip, range, range, now) else mapOf("updatedAt" to now))
            null
        }.await()
    }

    override suspend fun renameTrip(tripId: String, title: String) {
        db.collection("trips").document(tripId).update(mapOf("title" to title.trim(), "updatedAt" to Instant.now().toString())).await()
    }

    /**
     * As the web's fitTripDates: the bookings are read outside the
     * transaction (a client transaction cannot read a collection), so the
     * trip's updatedAt, bumped by every booking write, stands in as a
     * revision; if it moved between the read and the write, the span is
     * stale and the read is repeated.
     */
    override suspend fun fitTripDates(tripId: String): Boolean {
        val tripRef = db.collection("trips").document(tripId)
        repeat(ATTEMPTS) {
            val before = tripRef.get().await()
            if (!before.exists()) throw TripGoneException("Trip no longer exists")
            if (before.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
            val seen = before.getString("updatedAt")
            // Every booking's dates, cancelled ones too, as the trip's own
            // dates must cover; shown with what is still booked (liveBounds).
            val bookings = segmentsOf(tripRef)
            val range = bookedDateRange(bookings) ?: return false
            val live = liveBounds(range, bookings)
            val applied = db.runTransaction { t ->
                val snap = t.get(tripRef)
                if (!snap.exists()) throw TripGoneException("Trip no longer exists")
                if (snap.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
                if (snap.getString("updatedAt") != seen) return@runTransaction false
                t.update(
                    tripRef,
                    mapOf(
                        "start" to range.first,
                        "end" to range.second,
                        "liveStart" to (live?.first ?: FieldValue.delete()),
                        "liveEnd" to (live?.second ?: FieldValue.delete()),
                        "updatedAt" to Instant.now().toString(),
                    ),
                )
                true
            }.await()
            if (applied) return true
        }
        throw IllegalStateException("The trip kept changing; try again")
    }

    /** As the web's shareTrip: sharing also invites the address, in the same batch, so it can open the trip without asking. */
    override suspend fun shareTrip(tripId: String, email: String, inviterUid: String) {
        val address = emailAddressOf(email) ?: throw IllegalArgumentException("Enter an email address")
        val now = Instant.now().toString()
        db.runBatch { batch ->
            batch.update(db.collection("trips").document(tripId), mapOf("sharedWith" to FieldValue.arrayUnion(address), "updatedAt" to now))
            batch.set(accessRef(address), accessInvite(address, inviterUid, now), SetOptions.merge())
        }.await()
    }

    override suspend fun unshareTrip(tripId: String, email: String) {
        db.collection("trips").document(tripId)
            .update(mapOf("sharedWith" to FieldValue.arrayRemove(email), "updatedAt" to Instant.now().toString())).await()
    }

    /**
     * As the web's deleteTrip: Firestore does not cascade, so the trip is
     * first marked deleting, which every booking writer refuses, then its
     * bookings go in batches, and the trip last. Each step is idempotent, so
     * a deletion the app interrupted is finished by calling this again.
     */
    override suspend fun deleteTrip(tripId: String) {
        val tripRef = db.collection("trips").document(tripId)
        val exists = db.runTransaction { t ->
            val snap = t.get(tripRef)
            if (!snap.exists()) return@runTransaction false
            if (snap.getBoolean("deleting") != true) t.update(tripRef, mapOf("deleting" to true, "updatedAt" to Instant.now().toString()))
            true
        }.await()
        if (!exists) return
        val segments = tripRef.collection("segments").get().await().documents
        for (chunk in segments.chunked(BATCH)) {
            db.runBatch { batch -> for (doc in chunk) batch.delete(doc.reference) }.await()
        }
        tripRef.delete().await()
    }

    /**
     * As the web's moveSegment: the booking keeps its id under the new trip,
     * so an import of the same email still finds it, and is read inside the
     * transaction, so an edit made meanwhile is honored. The target widens
     * to hold it, unless it is cancelled and so counts for no dates; the
     * source's dates stay.
     */
    override suspend fun moveSegment(fromTripId: String, segmentId: String, toTripId: String) {
        if (fromTripId == toTripId) return
        val now = Instant.now().toString()
        val fromRef = db.collection("trips").document(fromTripId)
        val toRef = db.collection("trips").document(toTripId)
        val segmentRef = fromRef.collection("segments").document(segmentId)
        db.runTransaction { t ->
            val from = t.get(fromRef)
            val to = t.get(toRef)
            val current = t.get(segmentRef)
            if (!from.exists() || !to.exists()) throw TripGoneException("Trip no longer exists")
            if (!current.exists()) throw TripGoneException("That booking is no longer in this trip")
            if (from.getBoolean("deleting") == true || to.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
            val data = current.data ?: throw TripGoneException("That booking is no longer in this trip")
            val segment = segmentFromDocument(segmentId, fromTripId, data) ?: throw IllegalStateException("Malformed booking")
            val range = bookedDateRange(listOf(segment))
            t.set(toRef.collection("segments").document(segmentId), data + mapOf("tripId" to toTripId, "updatedAt" to now))
            t.delete(segmentRef)
            t.update(toRef, if (range != null) widened(to, range, segmentDateRange(listOf(segment)), now) else mapOf("updatedAt" to now))
            t.update(fromRef, mapOf("updatedAt" to now))
            null
        }.await()
    }

    /**
     * As the web's mergeTrips: the source's bookings are read outside the
     * transaction, its updatedAt standing in as a revision as in
     * fitTripDates; every booking is written under the target and deleted
     * from the source, the target widens, the source goes. Sharing is not
     * merged: the target keeps its own list.
     */
    override suspend fun mergeTrips(sourceId: String, targetId: String): Int {
        if (sourceId == targetId) throw IllegalArgumentException("Pick a different trip")
        val sourceRef = db.collection("trips").document(sourceId)
        val targetRef = db.collection("trips").document(targetId)
        repeat(ATTEMPTS) {
            val before = sourceRef.get().await()
            if (!before.exists()) throw TripGoneException("Trip no longer exists")
            if (before.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
            val seen = before.getString("updatedAt")
            val docs = sourceRef.collection("segments").get().await().documents
            val segments = docs.mapNotNull { doc -> doc.data?.let { segmentFromDocument(doc.id, sourceId, it) } }
            val range = bookedDateRange(segments)
            val live = segmentDateRange(segments)
            val now = Instant.now().toString()
            val applied = db.runTransaction { t ->
                val s = t.get(sourceRef)
                val g = t.get(targetRef)
                if (!s.exists() || !g.exists()) throw TripGoneException("Trip no longer exists")
                if (s.getBoolean("deleting") == true || g.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
                if (s.getString("updatedAt") != seen) return@runTransaction false
                for (doc in docs) {
                    t.set(targetRef.collection("segments").document(doc.id), doc.data.orEmpty() + mapOf("tripId" to targetId, "updatedAt" to now))
                    t.delete(doc.reference)
                }
                t.update(targetRef, if (range != null) widened(g, range, live, now) else mapOf("updatedAt" to now))
                t.delete(sourceRef)
                true
            }.await()
            if (applied) return docs.size
        }
        throw IllegalStateException("The trip kept changing; try again")
    }

    /** The trip's bookings, read once rather than listened to. */
    private suspend fun segmentsOf(tripRef: DocumentReference): List<Segment> =
        tripRef.collection("segments").get().await().documents.mapNotNull { doc -> doc.data?.let { segmentFromDocument(doc.id, tripRef.id, it) } }

    /** The update that widens a trip's dates to hold a span, as a booking write does. */
    /** The trip's dates widened to hold bookings (widenedFor), as a Firestore update. */
    private fun widened(trip: DocumentSnapshot, booked: Pair<String, String>, live: Pair<String, String>?, now: String): Map<String, Any> {
        val stored = tripFromDocument(trip.id, trip.data.orEmpty())
            ?: return mapOf("start" to booked.first, "end" to booked.second, "updatedAt" to now)
        val next = widenedFor(stored, booked, live)
        val liveStart = next.liveStart
        val liveEnd = next.liveEnd
        val shown: Map<String, Any> = when {
            liveStart != null && liveEnd != null -> mapOf("liveStart" to liveStart, "liveEnd" to liveEnd)
            stored.liveStart != null || stored.liveEnd != null -> mapOf("liveStart" to FieldValue.delete(), "liveEnd" to FieldValue.delete())
            else -> emptyMap()
        }
        return mapOf("start" to next.start, "end" to next.end, "updatedAt" to now) + shown
    }

    /** Every answer the listener gets; a failure ends the flow with its error. */
    private fun Query.snapshots(): Flow<QuerySnapshot> = callbackFlow {
        val registration = addSnapshotListener { snapshot, error ->
            if (error != null) {
                close(error)
                return@addSnapshotListener
            }
            if (snapshot != null) trySend(snapshot)
        }
        awaitClose { registration.remove() }
    }

    private fun Flow<QuerySnapshot>.orNothing(what: String): Flow<QuerySnapshot?> =
        map<QuerySnapshot, QuerySnapshot?> { it }.catch { error ->
            TravelmoLog.error(error, "Reading %s failed", safe(what))
            emit(null)
        }

    private companion object {
        /** How often a revision-checked write is retried before giving up. */
        const val ATTEMPTS = 5

        /** Firestore's batch limit, with room to spare. */
        const val BATCH = 400
    }
}
