package app.travelmo.data

import android.util.Log
import app.travelmo.core.Segment
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

/** What the screens read; Firestore in the app, a fake in tests. */
interface TripStore {
    /** The user's own trips and those shared with their verified address, live. */
    fun trips(uid: String, email: String?): Flow<List<Trip>>

    /** One trip's bookings, live; empty while it loads. */
    fun segments(tripId: String): Flow<List<Segment>>
}

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
