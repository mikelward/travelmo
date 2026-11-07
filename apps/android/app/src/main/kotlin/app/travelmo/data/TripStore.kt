package app.travelmo.data

import android.util.Log
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.localDate
import app.travelmo.core.Trip
import app.travelmo.core.normalizeEmail
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
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

    /** Writes a booking, new ([existingId] null) or edited, widening the trip's dates to hold it. */
    suspend fun saveSegment(tripId: String, draft: SegmentDraft, existingId: String?)

    suspend fun deleteSegment(tripId: String, segmentId: String)
}

class TripGoneException(message: String) : Exception(message)

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
    }
}
