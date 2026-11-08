package app.travelmo.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.travelmo.core.PlaceDraft
import app.travelmo.core.SegmentDraft
import app.travelmo.core.SegmentType
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.MemoryCacheSettings
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * FirestoreTrips' writes against the Firestore emulator with the real rules
 * loaded, as `apps/web/src/lib/edits.test.ts` has for their web twins. The
 * emulators run on the host (`scripts/connected-tests.sh`, under `firebase
 * emulators:exec --only firestore,auth`), which the Android emulator reaches
 * as 10.0.2.2; the script seeds two users with verified addresses, since the
 * rules read `email_verified` for a sharee. Every test uses trips of its own,
 * so nothing is cleared between them.
 */
@RunWith(AndroidJUnit4::class)
class FirestoreTripsTest {
    private class Person(name: String, val email: String) {
        private val app: FirebaseApp = FirebaseApp.getApps(context).firstOrNull { it.name == name } ?: FirebaseApp.initializeApp(context, OPTIONS, name)
        val db: FirebaseFirestore = FirebaseFirestore.getInstance(app)
        val store = FirestoreTrips(db)
        lateinit var uid: String

        suspend fun signIn() {
            val auth = FirebaseAuth.getInstance(app)
            if (auth.currentUser == null) {
                auth.useEmulator(HOST, 9099)
                db.useEmulator(HOST, 8081)
                db.firestoreSettings = FirebaseFirestoreSettings.Builder().setLocalCacheSettings(MemoryCacheSettings.newBuilder().build()).build()
                auth.signInWithEmailAndPassword(email, PASSWORD).await()
            }
            uid = auth.currentUser!!.uid
        }
    }

    companion object {
        private const val HOST = "10.0.2.2"
        private const val PASSWORD = "travelmo-test"
        private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
        private val OPTIONS = FirebaseOptions.Builder().setProjectId("demo-travelmo").setApplicationId("1:1:android:emulator").setApiKey("fake-api-key").build()
        private val owner = Person("owner", "owner@example.com")
        private val sharee = Person("sharee", "sharee@example.com")

        @BeforeClass
        @JvmStatic
        fun signInBoth() = runBlocking {
            owner.signIn()
            sharee.signIn()
        }
    }

    private val stamp = "2026-11-01T00:00:00Z"

    private fun tripRef(id: String): DocumentReference = owner.db.collection("trips").document(id)

    /** A trip of the owner's, shared with the sharee unless [shared] is false; created through the owner's own client, so the rules see it as they will in the app. */
    private suspend fun seedTrip(title: String = "Liverpool", start: String = "2026-12-12", end: String = "2026-12-14", shared: Boolean = true): String {
        val id = "t-" + UUID.randomUUID().toString().take(8)
        tripRef(id).set(
            mapOf(
                "id" to id, "title" to title, "start" to start, "end" to end, "ownerUid" to owner.uid,
                "sharedWith" to if (shared) listOf(sharee.email) else emptyList<String>(), "createdAt" to stamp, "updatedAt" to stamp,
            ),
        ).await()
        return id
    }

    /** An imported-looking booking, as the parser writes one. */
    private suspend fun seedSegment(tripId: String, id: String = "s1", start: String = "2026-12-12T15:00:00+00:00", end: String? = "2026-12-14T11:00:00+00:00"): Map<String, Any?> {
        val doc = mapOf(
            "id" to id, "tripId" to tripId, "type" to "lodging", "title" to "Cove Liverpool", "start" to start, "end" to end,
            "destination" to mapOf("name" to "Cove Liverpool", "city" to "Liverpool", "country" to "GB"),
            "source" to "gmail", "gmailMessageIds" to listOf("m1"), "sender" to "cove.example", "createdAt" to stamp, "updatedAt" to stamp,
        ).filterValues { it != null }
        tripRef(tripId).collection("segments").document(id).set(doc).await()
        return doc
    }

    private fun flight(day: String) = SegmentDraft(SegmentType.FLIGHT, "Flight on $day", null, null, "${day}T08:00:00+00:00", "${day}T09:00:00+00:00", null, PlaceDraft("Dublin", "DUB", "IE"), null)

    private suspend fun trip(id: String): Map<String, Any?> = tripRef(id).get().await().data ?: emptyMap()
    private suspend fun segments(tripId: String): Map<String, Map<String, Any?>> =
        tripRef(tripId).collection("segments").get().await().documents.associate { it.id to (it.data ?: emptyMap()) }

    /**
     * The ids of a trip's bookings as the emulator holds them, read past
     * the rules: once the trip is gone the rules refuse its owner the
     * subcollection (they read the parent to tell an owner), so what a
     * deletion left behind is checked the way the web tests check it,
     * through an administrative read. The emulator takes any bearer as the
     * project owner.
     */
    private fun adminSegmentIds(tripId: String): Set<String> {
        val url = URL("http://$HOST:8081/v1/projects/demo-travelmo/databases/(default)/documents/trips/$tripId/segments")
        val connection = url.openConnection() as HttpURLConnection
        connection.setRequestProperty("Authorization", "Bearer owner")
        try {
            check(connection.responseCode == 200) { "emulator answered ${connection.responseCode}" }
            val body = JSONObject(connection.inputStream.bufferedReader().readText())
            val documents = body.optJSONArray("documents") ?: return emptySet()
            return (0 until documents.length()).map { documents.getJSONObject(it).getString("name").substringAfterLast('/') }.toSet()
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun refused(block: suspend () -> Unit): Throwable {
        try {
            block()
        } catch (e: Throwable) {
            return e
        }
        fail("expected the write to be refused")
        error("unreachable")
    }

    private fun Throwable.isPermissionDenied(): Boolean =
        generateSequence(this) { it.cause }.any { it is FirebaseFirestoreException && it.code == FirebaseFirestoreException.Code.PERMISSION_DENIED }

    @Test
    fun saveSegment_addsAManualBookingAndWidensTheTrip() = runBlocking {
        val id = seedTrip()
        owner.store.saveSegment(id, flight("2026-12-16"), null)
        val saved = segments(id).values.single()
        assertEquals("manual", saved["source"])
        assertEquals(emptyList<String>(), saved["gmailMessageIds"])
        assertEquals("Flight on 2026-12-16", saved["title"])
        assertEquals(mapOf("name" to "Dublin", "code" to "DUB", "country" to "IE"), saved["destination"])
        assertEquals("2026-12-12", trip(id)["start"])
        assertEquals("2026-12-16", trip(id)["end"])
    }

    @Test
    fun saveSegment_keepsAnEditedBookingsIdentityAndWidensBackwards() = runBlocking {
        val id = seedTrip()
        seedSegment(id)
        owner.store.saveSegment(id, flight("2026-12-10").copy(type = SegmentType.LODGING, title = "Cove, renamed"), "s1")
        val saved = segments(id)
        assertEquals(setOf("s1"), saved.keys)
        // The form's fields over the stored ones; what it does not edit stays.
        assertEquals("Cove, renamed", saved["s1"]!!["title"])
        assertEquals("gmail", saved["s1"]!!["source"])
        assertEquals(listOf("m1"), saved["s1"]!!["gmailMessageIds"])
        assertEquals("cove.example", saved["s1"]!!["sender"])
        assertEquals("2026-12-10", trip(id)["start"])
        assertEquals("2026-12-14", trip(id)["end"])
    }

    @Test
    fun saveSegment_letsAShareeAddAndEditButNotRename() = runBlocking {
        val id = seedTrip()
        sharee.store.saveSegment(id, flight("2026-12-18"), null)
        val added = segments(id).entries.single()
        assertEquals("2026-12-18", trip(id)["end"])
        sharee.store.saveSegment(id, flight("2026-12-19").copy(title = "Later flight"), added.key)
        assertEquals("Later flight", segments(id)[added.key]!!["title"])
        assertEquals("2026-12-19", trip(id)["end"])
        assertTrue(refused { sharee.store.renameTrip(id, "Mine now") }.isPermissionDenied())
        assertEquals("Liverpool", trip(id)["title"])
    }

    @Test
    fun saveSegment_refusesATripBeingDeleted() = runBlocking {
        val id = seedTrip()
        tripRef(id).update(mapOf("deleting" to true)).await()
        val error = refused { owner.store.saveSegment(id, flight("2026-12-16"), null) }
        assertTrue(error.toString(), generateSequence(error) { it.cause }.any { it is TripGoneException })
        assertTrue(segments(id).isEmpty())
    }

    @Test
    fun deleteSegment_removesTheBookingAndLeavesTheBoundsAlone() = runBlocking {
        val id = seedTrip()
        seedSegment(id)
        owner.store.deleteSegment(id, "s1")
        assertTrue(segments(id).isEmpty())
        assertEquals("2026-12-12", trip(id)["start"])
        assertEquals("2026-12-14", trip(id)["end"])
    }

    @Test
    fun fitTripDates_snapsTheTripToItsBookingsOrDoesNothingWithout() = runBlocking {
        val id = seedTrip(start = "2026-12-01", end = "2026-12-31")
        seedSegment(id)
        assertTrue(owner.store.fitTripDates(id))
        assertEquals("2026-12-12", trip(id)["start"])
        assertEquals("2026-12-14", trip(id)["end"])
        val empty = seedTrip(start = "2026-12-01", end = "2026-12-31")
        assertFalse(owner.store.fitTripDates(empty))
        assertEquals("2026-12-01", trip(empty)["start"])
    }

    @Test
    fun fitTripDates_isRefusedForAShareeWhenItWouldNarrowTheTrip() = runBlocking {
        val id = seedTrip(start = "2026-12-01", end = "2026-12-31")
        seedSegment(id)
        assertTrue(refused { sharee.store.fitTripDates(id) }.isPermissionDenied())
        assertEquals("2026-12-01", trip(id)["start"])
    }

    @Test
    fun moveSegment_movesABookingKeepingItsIdAndWidensTheTarget() = runBlocking {
        val from = seedTrip()
        val to = seedTrip(title = "Dublin", start = "2026-12-20", end = "2026-12-22")
        seedSegment(from)
        owner.store.moveSegment(from, "s1", to)
        assertTrue(segments(from).isEmpty())
        val moved = segments(to)["s1"]!!
        assertEquals(to, moved["tripId"])
        assertEquals(listOf("m1"), moved["gmailMessageIds"])
        assertEquals("2026-12-12", trip(to)["start"])
        assertEquals("2026-12-22", trip(to)["end"])
        // The source's dates stay.
        assertEquals("2026-12-12", trip(from)["start"])
    }

    @Test
    fun moveSegment_refusesABookingThatIsGoneAndATargetBeingDeleted() = runBlocking {
        val from = seedTrip()
        val to = seedTrip(title = "Dublin", start = "2026-12-20", end = "2026-12-22")
        val gone = refused { owner.store.moveSegment(from, "missing", to) }
        assertTrue(gone.toString(), generateSequence(gone) { it.cause }.any { it is TripGoneException })
        seedSegment(from)
        tripRef(to).update(mapOf("deleting" to true)).await()
        val deleting = refused { owner.store.moveSegment(from, "s1", to) }
        assertTrue(deleting.toString(), generateSequence(deleting) { it.cause }.any { it is TripGoneException })
        assertEquals(setOf("s1"), segments(from).keys)
        assertTrue(segments(to).isEmpty())
    }

    @Test
    fun moveSegment_letsAShareeOfBothTripsMoveABooking() = runBlocking {
        val from = seedTrip()
        val to = seedTrip(title = "Dublin", start = "2026-12-20", end = "2026-12-22")
        seedSegment(from)
        sharee.store.moveSegment(from, "s1", to)
        assertEquals(setOf("s1"), segments(to).keys)
        assertEquals("2026-12-12", trip(to)["start"])
    }

    @Test
    fun mergeTrips_movesEveryBookingWidensTheTargetAndDeletesTheSource() = runBlocking {
        val source = seedTrip()
        val target = seedTrip(title = "Dublin", start = "2026-12-20", end = "2026-12-22")
        seedSegment(source)
        seedSegment(source, id = "s2", start = "2026-12-13T08:00:00+00:00", end = "2026-12-13T09:00:00+00:00")
        assertEquals(2, owner.store.mergeTrips(source, target))
        assertEquals(setOf("s1", "s2"), segments(target).keys)
        assertEquals(target, segments(target)["s1"]!!["tripId"])
        assertEquals("2026-12-12", trip(target)["start"])
        assertEquals("2026-12-22", trip(target)["end"])
        assertFalse(tripRef(source).get().await().exists())
    }

    @Test
    fun mergeTrips_isRefusedForAShareeAndIntoItself() = runBlocking {
        val source = seedTrip()
        val target = seedTrip(title = "Dublin", start = "2026-12-20", end = "2026-12-22")
        seedSegment(source)
        assertTrue(refused { sharee.store.mergeTrips(source, target) }.isPermissionDenied())
        assertEquals(setOf("s1"), segments(source).keys)
        assertTrue(refused { owner.store.mergeTrips(source, source) } is IllegalArgumentException)
    }

    @Test
    fun deleteTrip_removesTheTripAndAllItsBookings() = runBlocking {
        val id = seedTrip()
        seedSegment(id)
        seedSegment(id, id = "s2")
        owner.store.deleteTrip(id)
        assertFalse(tripRef(id).get().await().exists())
        assertEquals(emptySet<String>(), adminSegmentIds(id))
    }

    @Test
    fun deleteTrip_finishesADeletionTheAppInterrupted() = runBlocking {
        val id = seedTrip()
        seedSegment(id)
        // The app died after the first step: the trip is marked, its
        // bookings still there. Writers refuse it meanwhile.
        tripRef(id).update(mapOf("deleting" to true)).await()
        assertTrue(refused { owner.store.saveSegment(id, flight("2026-12-16"), null) }.toString().contains("deleted"))
        owner.store.deleteTrip(id)
        assertFalse(tripRef(id).get().await().exists())
        assertEquals(emptySet<String>(), adminSegmentIds(id))
        // Calling it for a trip that is gone is a no-op.
        owner.store.deleteTrip(id)
        assertNull(tripRef(id).get().await().data)
    }
}
