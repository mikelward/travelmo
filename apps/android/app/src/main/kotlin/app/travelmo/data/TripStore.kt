package app.travelmo.data

import android.util.Log
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.localDate
import app.travelmo.core.TravelProfile
import app.travelmo.core.Trip
import app.travelmo.core.MAX_TRUSTED
import app.travelmo.core.normalizeEmail
import app.travelmo.core.normalizeTrusted
import app.travelmo.core.segmentDateRange
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
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
    /** The user's own trips and those shared with their verified address, live. */
    fun trips(uid: String, email: String?): Flow<List<Trip>>

    /** One trip's bookings, live; empty while it loads. */
    fun segments(tripId: String): Flow<List<Segment>>

    /** The user's own travel profile, live, from its first answer on: an answer with no profile is one too. A read that fails is logged and keeps the caller waiting. */
    fun ownProfile(uid: String): Flow<OwnProfile>

    /** The profiles shared with the user's verified address, live. */
    fun sharedProfiles(email: String?): Flow<List<TravelProfile>>

    /** Whether the user asked for reminders by email (`reminders.email` on their user document), live; null while it loads. */
    fun reminderEmail(uid: String): Flow<Boolean?>

    /** Turns reminders by email on or off, as the web's Settings does: a merge of `reminders.email` alone. */
    suspend fun setReminderEmail(uid: String, on: Boolean)

    /** Sets who the user's travel profile is shared with, starting the profile if there is none yet ([exists] false). */
    suspend fun saveTrusted(uid: String, email: String?, exists: Boolean, emails: List<String>)

    /** Writes a booking, new ([existingId] null) or edited, widening the trip's dates to hold it. */
    suspend fun saveSegment(tripId: String, draft: SegmentDraft, existingId: String?)

    suspend fun deleteSegment(tripId: String, segmentId: String)

    /** The owner's powers over a trip, as the web's edits.ts has them. */
    suspend fun renameTrip(tripId: String, title: String)

    /** Sets the trip's dates to its bookings' span; false when it has none. Owner only. */
    suspend fun fitTripDates(tripId: String): Boolean

    /** Shares the trip with an address, or stops. Owner only. */
    suspend fun shareTrip(tripId: String, email: String)

    suspend fun unshareTrip(tripId: String, email: String)

    /** Marks the trip deleting, removes its bookings, then the trip; safe to call again if interrupted. Owner only. */
    suspend fun deleteTrip(tripId: String)

    /** Moves a booking to another trip the viewer can edit, keeping its id; the target widens to hold it. */
    suspend fun moveSegment(fromTripId: String, segmentId: String, toTripId: String)

    /** Moves every booking of the source into the target and deletes the source; how many moved. Owner of the source only. */
    suspend fun mergeTrips(sourceId: String, targetId: String): Int
}

class TripGoneException(message: String) : Exception(message)

/** What the profile document answered: the profile, or none yet. Distinct from not having answered at all. */
data class OwnProfile(val profile: TravelProfile?)

/**
 * The same queries the web app makes (SPEC.md "The trip list"), each a
 * snapshot listener, so a change made elsewhere shows up on its own and
 * Firestore's own cache answers them offline.
 */
class FirestoreTrips(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) : TripStore {
    override fun trips(uid: String, email: String?): Flow<List<Trip>> {
        // One query failing (the rules refusing it, say) must not hold the
        // whole list at "loading": it answers with nothing and is logged.
        val own = db.collection("trips").whereEqualTo("ownerUid", uid).snapshots().orNothing("own trips")
        val address = normalizeEmail(email)
        val shared = if (address == null) flowOf(null) else db.collection("trips").whereArrayContains("sharedWith", address).snapshots().orNothing("shared trips")
        return combine(own, shared) { mine, theirs ->
            val byId = LinkedHashMap<String, Trip>()
            for (snapshot in listOfNotNull(mine, theirs)) {
                for (doc in snapshot.documents) {
                    val trip = tripFromDocument(doc.id, doc.data ?: emptyMap())
                    if (trip == null) Log.w(TAG, "Malformed trip ${doc.reference.path}") else byId[trip.id] = trip
                }
            }
            byId.values.toList()
        }
    }

    override fun segments(tripId: String): Flow<List<Segment>> =
        db.collection("trips").document(tripId).collection("segments").snapshots().orNothing("segments of $tripId").map { snapshot ->
            snapshot?.documents.orEmpty().mapNotNull { doc ->
                segmentFromDocument(doc.id, tripId, doc.data ?: emptyMap()).also {
                    if (it == null) Log.w(TAG, "Malformed segment ${doc.reference.path}")
                }
            }
        }

    override fun ownProfile(uid: String): Flow<OwnProfile> = callbackFlow {
        val registration = db.collection("users").document(uid).collection("travelProfile").document("main").addSnapshotListener { snapshot, error ->
            if (error != null) {
                // Nothing is sent: a profile that could not be read is not one
                // that is absent, and sharing must not start a new one over it.
                Log.e(TAG, "Reading the travel profile failed", error)
                return@addSnapshotListener
            }
            trySend(OwnProfile(snapshot?.data?.let(::profileFromDocument)))
        }
        awaitClose { registration.remove() }
    }

    override fun sharedProfiles(email: String?): Flow<List<TravelProfile>> {
        val address = normalizeEmail(email) ?: return flowOf(emptyList())
        return db.collectionGroup("travelProfile").whereArrayContains("trustedEmails", address).snapshots().orNothing("shared profiles").map { snapshot ->
            snapshot?.documents.orEmpty().mapNotNull { doc -> profileFromDocument(doc.data ?: emptyMap()) }
        }
    }

    override fun reminderEmail(uid: String): Flow<Boolean?> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                Log.e(TAG, "Reading the user document failed", error)
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

    /**
     * As the web's saveTrusted: a merge, so it starts a profile before any
     * import and, on one that exists, touches only the list (the rules
     * refuse anything else).
     */
    override suspend fun saveTrusted(uid: String, email: String?, exists: Boolean, emails: List<String>) {
        val trusted = normalizeTrusted(emails, email)
        if (trusted.size > MAX_TRUSTED) throw IllegalArgumentException("Share with at most $MAX_TRUSTED people.")
        val doc = LinkedHashMap<String, Any>()
        if (!exists) {
            doc["ownerUid"] = uid
            normalizeEmail(email)?.let { doc["ownerEmail"] = it }
        }
        doc["trustedEmails"] = trusted
        doc["updatedAt"] = Instant.now().toString()
        db.collection("users").document(uid).collection("travelProfile").document("main").set(doc, SetOptions.merge()).await()
    }

    /**
     * As the web's saveSegment: one transaction reads the trip and the stored
     * booking, writes the booking with the form's fields over what was
     * stored, and widens the trip's dates to hold it. Bounds never shrink
     * here, since a client transaction cannot read every booking.
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
            val start = tripSnap.getString("start") ?: range.min()
            val end = tripSnap.getString("end") ?: range.max()
            t.update(tripRef, mapOf("start" to minOf(start, range.min()), "end" to maxOf(end, range.max()), "updatedAt" to now))
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
            val range = segmentDateRange(segmentsOf(tripRef)) ?: return false
            val applied = db.runTransaction { t ->
                val snap = t.get(tripRef)
                if (!snap.exists()) throw TripGoneException("Trip no longer exists")
                if (snap.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
                if (snap.getString("updatedAt") != seen) return@runTransaction false
                t.update(tripRef, mapOf("start" to range.first, "end" to range.second, "updatedAt" to Instant.now().toString()))
                true
            }.await()
            if (applied) return true
        }
        throw IllegalStateException("The trip kept changing; try again")
    }

    override suspend fun shareTrip(tripId: String, email: String) {
        val address = normalizeEmail(email)?.takeIf { it.contains("@") } ?: throw IllegalArgumentException("Enter an email address")
        db.collection("trips").document(tripId)
            .update(mapOf("sharedWith" to FieldValue.arrayUnion(address), "updatedAt" to Instant.now().toString())).await()
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
     * to hold it; the source's dates stay.
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
            val range = segmentDateRange(listOf(segment)) ?: throw IllegalStateException("Segment has no dates")
            t.set(toRef.collection("segments").document(segmentId), data + mapOf("tripId" to toTripId, "updatedAt" to now))
            t.delete(segmentRef)
            t.update(toRef, widened(to, range, now))
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
            val range = segmentDateRange(segments)
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
                t.update(targetRef, if (range != null) widened(g, range, now) else mapOf("updatedAt" to now))
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
    private fun widened(trip: DocumentSnapshot, range: Pair<String, String>, now: String): Map<String, Any> = mapOf(
        "start" to minOf(trip.getString("start") ?: range.first, range.first),
        "end" to maxOf(trip.getString("end") ?: range.second, range.second),
        "updatedAt" to now,
    )

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
            Log.e(TAG, "Reading $what failed", error)
            emit(null)
        }

    private companion object {
        const val TAG = "FirestoreTrips"

        /** How often a revision-checked write is retried before giving up. */
        const val ATTEMPTS = 5

        /** Firestore's batch limit, with room to spare. */
        const val BATCH = 400
    }
}
