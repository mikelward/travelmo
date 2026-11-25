package app.travelmo.data

import app.travelmo.core.withOneWay
import app.travelmo.core.RefreshShown
import app.travelmo.core.checkedInOf
import app.travelmo.core.withCheckedIn
import app.travelmo.core.AccessConfig
import app.travelmo.core.AccessRecord
import app.travelmo.core.AccountAccess
import app.travelmo.core.AddressHolder
import app.travelmo.core.ImapMailbox
import app.travelmo.core.accessDecision
import app.travelmo.core.accessInvite
import app.travelmo.core.accessRecordOf
import app.travelmo.core.accessSelfApproval
import app.travelmo.core.emailAddressOf
import app.travelmo.core.FlightStatus
import app.travelmo.core.FoundLoyalty
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.flow
import app.travelmo.core.withLearned
import app.travelmo.core.SenderPatterns
import app.travelmo.core.SenderList
import app.travelmo.core.REVIEW_SEARCH_CAP
import app.travelmo.core.REVIEW_RECENT
import app.travelmo.core.ParsedRecord
import app.travelmo.core.withLoyaltyPerson
import app.travelmo.core.ChosenHomeAirports
import app.travelmo.core.HomeCorrection
import app.travelmo.core.MAX_HOME_CORRECTIONS
import app.travelmo.core.MAX_STANDING_REMINDERS
import app.travelmo.core.MAX_TRIP_REMINDERS
import app.travelmo.core.ONE_OFF_SLOT_PREFIX
import app.travelmo.core.Reminder
import app.travelmo.core.STANDING_SLOT_PREFIX
import app.travelmo.core.slotNumber
import app.travelmo.core.withDone
import app.travelmo.core.RideCompany
import app.travelmo.core.queryAddresses
import app.travelmo.core.Person
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
import app.travelmo.core.tripFlagsToWrite
import app.travelmo.core.newTripTitle
import app.travelmo.core.liveBounds
import app.travelmo.core.widenedFor
import app.travelmo.logging.SharedLog
import app.travelmo.logging.safe
import app.travelmo.logging.sensitive
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.Source
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import com.google.firebase.serialization.setData
import com.google.firebase.serialization.updateData
import kotlin.time.Clock


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
                    if (trip == null) SharedLog.warning("Malformed trip %s", sensitive(doc.reference.path)) else byId[trip.id] = trip
                }
            }
            byId.values.toList()
        }
    }

    override fun segments(tripId: String): Flow<List<Segment>> =
        db.collection("trips").document(tripId).collection("segments").snapshots().orNothing("segments of $tripId").map { snapshot ->
            snapshot?.documents.orEmpty().mapNotNull { doc ->
                segmentFromDocument(doc.id, tripId, doc.data ?: emptyMap()).also {
                    if (it == null) SharedLog.warning("Malformed segment %s", sensitive(doc.reference.path))
                }
            }
        }

    override suspend fun serverSegments(tripId: String): List<Segment> =
        db.collection("trips").document(tripId).collection("segments").get(Source.SERVER).await().documents.mapNotNull { doc ->
            segmentFromDocument(doc.id, tripId, doc.data ?: emptyMap()).also {
                if (it == null) SharedLog.warning("Malformed segment %s", sensitive(doc.reference.path))
            }
        }

    override suspend fun serverOwnTrips(uid: String): List<Trip> =
        db.collection("trips").whereEqualTo("ownerUid", uid).get(Source.SERVER).await().documents.mapNotNull { doc ->
            tripFromDocument(doc.id, doc.data ?: emptyMap()).also {
                if (it == null) SharedLog.warning("Malformed trip %s", sensitive(doc.reference.path))
            }
        }

    override fun flightStatus(key: String): Flow<FlightStatus?> = callbackFlow {
        val registration = db.collection("flightStatus").document(key).addSnapshotListener { snapshot, error ->
            if (error != null) {
                SharedLog.error(error, "Reading the status of flight %s failed", sensitive(key))
                trySend(null)
                return@addSnapshotListener
            }
            val status = snapshot?.data?.let(::flightStatusFromDocument)
            if (snapshot?.exists() == true && status == null) SharedLog.warning("Malformed flight status %s", sensitive(key))
            trySend(status)
        }
        awaitClose { registration.remove() }
    }

    override fun ownProfile(uid: String): Flow<OwnProfile> = callbackFlow {
        val registration = db.collection("users").document(uid).collection("travelProfile").document("main").addSnapshotListener { snapshot, error ->
            if (error != null) {
                // Nothing is sent: a profile that could not be read is not one
                // that is absent, and sharing must not start a new one over it.
                SharedLog.error(error, "Reading the travel profile failed")
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

    override fun googleCalendar(uid: String): Flow<GoogleCalendarShown?> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                SharedLog.error(error, "Reading the Google Calendar connection failed")
                trySend(GoogleCalendarShown(null))
                return@addSnapshotListener
            }
            trySend(googleCalendarOf(snapshot?.data))
        }
        awaitClose { registration.remove() }
    }

    override fun calendarExport(uid: String): Flow<CalendarExportShown?> = callbackFlow {
        val registration = db.document("users/$uid/calendarExport/main").addSnapshotListener { snapshot, error ->
            if (error != null) {
                SharedLog.error(error, "Reading the calendar export link failed")
                trySend(CalendarExportShown(null))
                return@addSnapshotListener
            }
            trySend(calendarExportOf(snapshot?.data))
        }
        awaitClose { registration.remove() }
    }

    override fun people(uid: String): Flow<List<Person>> = callbackFlow {
        val registration = db.collection("users").document(uid).collection("people")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    SharedLog.error(error, "Reading the user's people failed")
                    trySend(emptyList())
                    return@addSnapshotListener
                }
                trySend(snapshot?.documents.orEmpty().mapNotNull { personOf(it.id, it.data) })
            }
        awaitClose { registration.remove() }
    }

    /** As the web's setMe: one batch marking [personId] and unmarking any other. */
    override suspend fun setMe(uid: String, people: List<Person>, personId: String) {
        val now = Clock.System.now().toString()
        val ref = db.collection("users").document(uid).collection("people")
        db.runBatch { batch ->
            for (person in people) {
                if (person.id == personId) batch.updateData(ref.document(person.id), mapOf("me" to true, "updatedAt" to now))
                else if (person.me) batch.updateData(ref.document(person.id), mapOf("me" to false, "updatedAt" to now))
            }
        }.await()
    }

    override fun feeds(uid: String): Flow<List<CalendarFeedShown>?> = callbackFlow {
        val registration = db.collection("users").document(uid).collection("feeds").orderBy("addedAt")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    SharedLog.error(error, "Reading the calendar feeds failed")
                    trySend(emptyList())
                    return@addSnapshotListener
                }
                trySend(snapshot?.documents.orEmpty().mapNotNull { calendarFeedOf(it.id, it.data) })
            }
        awaitClose { registration.remove() }
    }

    override fun forwarding(uid: String): Flow<Forwarding?> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                SharedLog.error(error, "Reading the forwarding address failed")
                trySend(Forwarding(null))
                return@addSnapshotListener
            }
            trySend(forwardingOf(snapshot?.data))
        }
        awaitClose { registration.remove() }
    }

    override fun addressHolder(uid: String): Flow<AddressHolder> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                // The sign-in alone still finds what was shared with it.
                SharedLog.error(error, "Reading the user document for the email addresses failed")
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
                SharedLog.error(error, "Reading the user document failed")
                trySend(null)
                return@addSnapshotListener
            }
            val reminders = snapshot?.get("reminders") as? Map<*, *>
            trySend(reminders?.get("email") == true)
        }
        awaitClose { registration.remove() }
    }

    override suspend fun setReminderEmail(uid: String, on: Boolean) {
        db.collection("users").document(uid).setData(mapOf("reminders" to mapOf("email" to on)), SetOptions.merge()).await()
    }

    override fun rideSettings(uid: String): Flow<RideSettings?> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                SharedLog.error(error, "Reading the user document for ride suggestions failed")
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
            tx.updateData(ref, mapOf("foundLoyalty" to kept, "updatedAt" to Clock.System.now().toString()))
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
            tx.updateData(ref, mapOf("loyaltyPeople" to next, "updatedAt" to Clock.System.now().toString()))
        }.await()
    }

    // Shown as not connected; source links open the phone's default Gmail account.
    override fun gmailStatuses(uid: String): Flow<List<GmailStatus>> =
        userDocument(uid, "Reading the Gmail connections failed", emptyList(), ::gmailStatusesOf)

    override fun fastmailStatus(uid: String): Flow<FastmailStatus?> =
        userDocument(uid, "Reading the Fastmail connection failed", null, ::fastmailStatusOf)

    override fun imapStatuses(uid: String): Flow<List<ImapMailbox>> =
        userDocument(uid, "Reading the IMAP connections failed", emptyList(), ::imapStatusesOf)

    override fun refreshProgress(uid: String): Flow<RefreshShown?> =
        userDocument(uid, "Reading the refresh's progress failed", null, ::refreshOf)

    /** What [read] makes of the user document, live; [fallback] once reading it fails, logged as [failure]. */
    private fun <T> userDocument(uid: String, failure: String, fallback: T, read: (Map<String, Any?>?) -> T): Flow<T> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                SharedLog.error(error, failure)
                trySend(fallback)
                return@addSnapshotListener
            }
            trySend(read(snapshot?.data))
        }
        awaitClose { registration.remove() }
    }

    override fun latestParsed(uid: String): Flow<List<ParsedRecord>?> = callbackFlow {
        val query = db.collection("users").document(uid).collection("parsedMessages")
            .orderBy("processedAt", Query.Direction.DESCENDING).limit(REVIEW_RECENT.toLong())
        val registration = query.addSnapshotListener { snapshot, error ->
            if (error != null) {
                SharedLog.error(error, "Reading the import records failed")
                trySend(emptyList())
                return@addSnapshotListener
            }
            trySend(snapshot?.documents.orEmpty().mapNotNull { parsedRecordOf(it.id, it.data) })
        }
        awaitClose { registration.remove() }
    }

    override suspend fun parsedRecords(uid: String, ids: List<String>): Map<String, ParsedRecord> {
        val records = db.collection("users").document(uid).collection("parsedMessages")
        return ids.mapNotNull { id ->
            try {
                parsedRecordOf(id, records.document(id).get().await().data)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Listed by id alone, as if the record were gone.
                SharedLog.error(e, "Reading a failed email's import record failed")
                null
            }
        }.associateBy { it.messageId }
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
                SharedLog.error(e, "Reading import records for a search failed")
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
                SharedLog.error(error, "Reading the sender rules failed")
                trySend(SenderPatterns())
                return@addSnapshotListener
            }
            trySend(senderPatternsOf(snapshot?.data))
        }
        awaitClose { registration.remove() }
    }

    override suspend fun setSenderPatterns(uid: String, patterns: SenderPatterns) {
        // Merged, so any other field of the document stays.
        db.document("users/$uid/settings/patterns").setData(mapOf("allow" to patterns.allow, "deny" to patterns.deny), SetOptions.merge()).await()
    }

    override suspend fun learnSender(uid: String, domain: String, which: SenderList) {
        val ref = db.document("users/$uid/settings/patterns")
        db.runTransaction { tx ->
            val next = withLearned(senderPatternsOf(tx.get(ref).data), domain, which)
            // Merged, so any other field of the document stays.
            tx.setData(ref, mapOf("allow" to next.allow, "deny" to next.deny), SetOptions.merge())
        }.await()
    }

    override suspend fun setHomeCorrections(uid: String, corrections: List<HomeCorrection>) {
        check(corrections.size <= MAX_HOME_CORRECTIONS) { "At most $MAX_HOME_CORRECTIONS." }
        val stored = corrections.map { c -> listOfNotNull("city" to c.city, c.country?.let { "country" to it }, "from" to c.from).toMap() }
        db.collection("users").document(uid).setData(mapOf("homes" to stored), SetOptions.merge()).await()
    }

    override suspend fun setHomeAirports(uid: String, chosen: List<ChosenHomeAirports>) {
        check(chosen.size <= MAX_HOME_CORRECTIONS) { "At most $MAX_HOME_CORRECTIONS homes." }
        val stored = chosen.map { c -> listOfNotNull("city" to c.city, c.country?.let { "country" to it }, "airports" to c.airports).toMap() }
        db.collection("users").document(uid).setData(mapOf("homeAirports" to stored), SetOptions.merge()).await()
    }

    override suspend fun addRideCompany(uid: String, company: RideCompany) = editRideCompanies(uid) { rideCompaniesAdding(it, company) }

    override suspend fun removeRideCompany(uid: String, company: RideCompany) = editRideCompanies(uid) { rideCompaniesRemoving(it, company) }

    // Read and written in one transaction, so a change from another device
    // in the meantime is kept.
    private suspend fun editRideCompanies(uid: String, change: (List<Any?>) -> List<Any?>?) {
        val ref = db.collection("users").document(uid)
        db.runTransaction { tx ->
            val stored = (tx.get(ref).get("rideCompanies") as? List<*>).orEmpty()
            change(stored)?.let { tx.setData(ref, mapOf("rideCompanies" to it), SetOptions.merge()) }
        }.await()
    }

    override suspend fun hideRideNeed(uid: String, key: String) {
        val ref = db.collection("users").document(uid)
        db.runTransaction { tx ->
            val stored = (tx.get(ref).get("hiddenRideNeeds") as? List<*>).orEmpty().filterIsInstance<String>()
            tx.setData(ref, mapOf("hiddenRideNeeds" to withHidden(stored, key)), SetOptions.merge())
        }.await()
    }

    override suspend fun markOneWay(uid: String, tripId: String) {
        val ref = db.collection("users").document(uid)
        db.runTransaction { tx ->
            val stored = (tx.get(ref).get("oneWayTrips") as? List<*>).orEmpty().filterIsInstance<String>()
            tx.setData(ref, mapOf("oneWayTrips" to withOneWay(stored, tripId)), SetOptions.merge())
        }.await()
    }

    override fun standingReminders(uid: String): Flow<List<Reminder>?> =
        db.collection("users").document(uid).collection("tripReminders").snapshots()
            .map<QuerySnapshot, List<Reminder>?> { snap -> remindersOf(snap, dated = false) }
            .catch { error ->
                SharedLog.error(error, "Reading the reminders before trips failed")
                emit(emptyList())
            }

    override fun myChecklist(uid: String, tripId: String): Flow<MyChecklist?> {
        val ref = checklistRef(uid, tripId)
        val done = callbackFlow {
            val registration = ref.addSnapshotListener { snapshot, error ->
                if (error != null) {
                    SharedLog.error(error, "Reading a trip's checklist failed")
                    trySend(emptyList())
                    return@addSnapshotListener
                }
                trySend(doneOf(snapshot?.data))
            }
            awaitClose { registration.remove() }
        }
        val added = ref.collection("added").snapshots()
            .map { snap -> remindersOf(snap, dated = true) }
            .catch { error ->
                SharedLog.error(error, "Reading a trip's own reminders failed")
                emit(emptyList())
            }
        return combine(done, added) { d, a -> MyChecklist(d, a) }
    }

    override suspend fun saveReminder(uid: String, tripId: String?, reminder: Reminder) {
        val slots = if (tripId == null) db.collection("users").document(uid).collection("tripReminders") else checklistRef(uid, tripId).collection("added")
        val (prefix, max) = if (tripId == null) STANDING_SLOT_PREFIX to MAX_STANDING_REMINDERS else ONE_OFF_SLOT_PREFIX to MAX_TRIP_REMINDERS
        val fields = reminderFields(reminder, Clock.System.now().toString())
        db.runTransaction { tx ->
            if (reminder.slot.isNotEmpty()) {
                tx.setData(slots.document(reminder.slot), fields)
                return@runTransaction
            }
            val free = (0 until max).map { slots.document("$prefix$it") }.firstOrNull { !tx.get(it).exists() }
                ?: throw IllegalStateException("At most $max.")
            tx.setData(free, fields)
        }.await()
    }

    override suspend fun removeReminder(uid: String, tripId: String?, slot: String) {
        val slots = if (tripId == null) db.collection("users").document(uid).collection("tripReminders") else checklistRef(uid, tripId).collection("added")
        slots.document(slot).delete().await()
    }

    override suspend fun setReminderDone(uid: String, tripId: String, id: String, done: Boolean) {
        val ref = checklistRef(uid, tripId)
        db.runTransaction { tx ->
            val before = doneOf(tx.get(ref).data)
            tx.setData(ref, mapOf("done" to withDone(before, id, done), "updatedAt" to Clock.System.now().toString()))
        }.await()
    }

    override fun checkedIn(uid: String, tripId: String): Flow<Set<String>?> = callbackFlow {
        val registration = checkedInRef(uid, tripId).addSnapshotListener { snapshot, error ->
            if (error != null) {
                // As none marked: the check-in line and button stay.
                SharedLog.error(error, "Reading the check-in marks failed")
                trySend(emptySet())
                return@addSnapshotListener
            }
            trySend(checkedInOf(snapshot?.data?.get("segmentIds") as? List<*>).toSet())
        }
        awaitClose { registration.remove() }
    }

    override suspend fun setCheckedIn(uid: String, tripId: String, segmentId: String, checkedIn: Boolean) {
        val ref = checkedInRef(uid, tripId)
        db.runTransaction { tx ->
            val before = checkedInOf(tx.get(ref).data?.get("segmentIds") as? List<*>)
            tx.setData(ref, mapOf("segmentIds" to withCheckedIn(before, segmentId, checkedIn), "updatedAt" to Clock.System.now().toString()))
        }.await()
    }

    private fun checkedInRef(uid: String, tripId: String): DocumentReference =
        db.collection("users").document(uid).collection("checkedIn").document(tripId)

    private fun checklistRef(uid: String, tripId: String): DocumentReference =
        db.collection("users").document(uid).collection("tripChecklists").document(tripId)

    private fun remindersOf(snap: QuerySnapshot, dated: Boolean): List<Reminder> =
        snap.documents.sortedBy { slotNumber(it.id) }.mapNotNull { reminderOf(it.id, it.data, dated) }

    override fun pushDevice(uid: String, id: String): Flow<Boolean?> = callbackFlow {
        val registration = deviceRef(uid, id).addSnapshotListener { snapshot, error ->
            if (error != null) {
                SharedLog.error(error, "Reading the device registration failed")
                trySend(null)
                return@addSnapshotListener
            }
            trySend(snapshot?.exists() == true)
        }
        awaitClose { registration.remove() }
    }

    override suspend fun registerDevice(uid: String, id: String, token: String) {
        deviceRef(uid, id).setData(mapOf("token" to token, "platform" to "android", "createdAt" to Clock.System.now().toString())).await()
        db.collection("users").document(uid).setData(mapOf("reminders" to mapOf("push" to true)), SetOptions.merge()).await()
    }

    override suspend fun unregisterDevice(uid: String, id: String) {
        deviceRef(uid, id).delete().await()
        // As the web's unsubscribe: the flag goes off only once nothing of
        // the user's is left to send to, on either kind of channel.
        val devices = db.collection("users").document(uid).collection("devices").limit(1).get().await()
        val browsers = db.collection("users").document(uid).collection("pushSubscriptions").limit(1).get().await()
        if (devices.isEmpty && browsers.isEmpty) {
            db.collection("users").document(uid).setData(mapOf("reminders" to mapOf("push" to false)), SetOptions.merge()).await()
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
        val now = Clock.System.now().toString()
        val doc = LinkedHashMap<String, Any>()
        if (!exists) {
            doc["ownerUid"] = uid
            normalizeEmail(email)?.let { doc["ownerEmail"] = it }
        }
        doc["trustedEmails"] = trusted
        doc["updatedAt"] = now
        db.runBatch { batch ->
            batch.setData(db.collection("users").document(uid).collection("travelProfile").document("main"), doc, SetOptions.merge())
            // Each address newly trusted is invited in the same write, so it
            // can open the profile without asking for access.
            for (address in trusted) {
                if (address !in before && emailAddressOf(address) == address) batch.setData(accessRef(address), accessInvite(address, uid, now), SetOptions.merge())
            }
        }.await()
    }

    override fun userDocument(uid: String): Flow<Seen<AddressHolder?>> =
        db.collection("users").document(uid).seen(
            read = { snapshot -> if (snapshot.exists()) addressHolderFromDocument(snapshot.data.orEmpty()) else null },
            onError = { error ->
                SharedLog.error(error, "Reading the user document for access failed")
                null
            },
        )

    override fun accessRecord(email: String): Flow<Seen<AccessRecord?>> =
        accessRef(email).seen(
            read = { snapshot ->
                if (!snapshot.exists()) {
                    null
                } else {
                    accessRecordOf(snapshot.data.orEmpty()).also { if (it == null) SharedLog.warning("Skipping a malformed access record") }
                }
            },
            onError = { error ->
                SharedLog.error(error, "Reading the access record failed")
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
                    SharedLog.info("The admins' list is not readable: not an admin")
                } else {
                    SharedLog.error(error, "Reading the admins' list failed")
                }
                null
            },
        )

    override fun accessRecords(): Flow<List<AccessRecord>?> = callbackFlow {
        val registration = db.collection("access").addSnapshotListener { snapshot, error ->
            if (error != null) {
                SharedLog.error(error, "Access records subscription failed")
                return@addSnapshotListener
            }
            trySend(
                snapshot?.documents.orEmpty().mapNotNull { doc ->
                    accessRecordOf(doc.data.orEmpty()).also { if (it == null) SharedLog.warning("Skipping malformed access record %s", sensitive(doc.id)) }
                },
            )
        }
        awaitClose { registration.remove() }
    }

    override suspend fun recordSelf(email: String, uid: String, now: String) {
        accessRef(email).setData(accessSelfApproval(email, uid, now)).await()
    }

    override suspend fun decideAccess(email: String, decision: AccountAccess, adminUid: String, now: String) {
        accessRef(email).setData(mapOf("email" to email) + accessDecision(decision, adminUid, now), SetOptions.merge()).await()
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
        val now = Clock.System.now().toString()
        val tripRef = db.collection("trips").document(tripId)
        val segmentRef = if (existingId != null) tripRef.collection("segments").document(existingId) else tripRef.collection("segments").document()
        val range = listOfNotNull(draft.start, draft.end).map { localDate(it) }
        db.runTransaction { t ->
            val tripSnap = t.get(tripRef)
            if (!tripSnap.exists()) throw TripGoneException("Trip no longer exists")
            if (tripSnap.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
            val stored = if (existingId != null) t.get(segmentRef).data else null
            val written = draftToDocument(draft, stored, segmentRef.id, tripId, now).let {
                // A booking added to a cancelled trip is cancelled with it.
                if (stored == null) inTripDocument(it, tripSnap.getString("cancelledAt"), now) else it
            }
            t.setData(segmentRef, written)
            // A cancelled booking widens only the trip's own dates.
            val booked = range.min() to range.max()
            t.updateData(tripRef, widened(tripSnap, booked, if (written["cancelledAt"] is String) null else booked, now) + FLAGS_UNKNOWN)
            null
        }.await()
    }

    override suspend fun deleteSegment(tripId: String, segmentId: String) {
        val tripRef = db.collection("trips").document(tripId)
        db.runBatch { batch ->
            batch.delete(tripRef.collection("segments").document(segmentId))
            batch.updateData(tripRef, mapOf("updatedAt" to Clock.System.now().toString()) + FLAGS_UNKNOWN)
        }.await()
    }

    /**
     * As the web's restoreSegment: the booking counts again, so the trip
     * widens to hold it (Fit dates may have narrowed the trip meanwhile).
     */
    override suspend fun restoreSegment(tripId: String, segmentId: String) {
        val now = Clock.System.now().toString()
        val tripRef = db.collection("trips").document(tripId)
        val segmentRef = tripRef.collection("segments").document(segmentId)
        db.runTransaction { t ->
            val trip = t.get(tripRef)
            val current = t.get(segmentRef)
            if (!trip.exists()) throw TripGoneException("Trip no longer exists")
            if (!current.exists()) throw TripGoneException("That booking is no longer in this trip")
            if (trip.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
            val data = current.data ?: throw TripGoneException("That booking is no longer in this trip")
            if (trip.getString("cancelledAt") != null && data["userCancelled"] == "trip") throw IllegalStateException("Restore the trip first")
            val restored = segmentFromDocument(segmentId, tripId, data)?.copy(cancelledAt = null, cancelledBy = null)
            val range = restored?.let { segmentDateRange(listOf(it)) }
            // The person's own cancellation is simply taken off: no email was
            // overruled, so none sent before now is kept from cancelling it later.
            if (data["userCancelled"] is String) {
                t.updateData(segmentRef, mapOf("cancelledAt" to FieldValue.delete(), "userCancelled" to FieldValue.delete(), "updatedAt" to now))
                t.updateData(tripRef, (if (range != null) widened(trip, range, range, now) else mapOf("updatedAt" to now)) + FLAGS_UNKNOWN)
                return@runTransaction null
            }
            // The cancellation is remembered as taken back, and when: reading
            // the booking's confirmation again, or any cancellation sent
            // before now, doesn't cancel it again.
            val restoredFrom = (data["cancelledBy"] as? String)?.let { mapOf("restoredFrom" to FieldValue.arrayUnion(it)) }.orEmpty()
            t.updateData(segmentRef, mapOf("cancelledAt" to FieldValue.delete(), "cancelledBy" to FieldValue.delete(), "cancelledSentAt" to FieldValue.delete(), "restoredAt" to now, "updatedAt" to now) + restoredFrom)
            t.updateData(tripRef, (if (range != null) widened(trip, range, range, now) else mapOf("updatedAt" to now)) + FLAGS_UNKNOWN)
            null
        }.await()
    }

    override suspend fun renameTrip(tripId: String, title: String) {
        db.collection("trips").document(tripId).updateData(mapOf("title" to title.trim(), "updatedAt" to Clock.System.now().toString())).await()
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
                t.updateData(
                    tripRef,
                    mapOf(
                        "start" to range.first,
                        "end" to range.second,
                        "liveStart" to (live?.first ?: FieldValue.delete()),
                        "liveEnd" to (live?.second ?: FieldValue.delete()),
                        "updatedAt" to Clock.System.now().toString(),
                    ),
                )
                true
            }.await()
            if (applied) return true
        }
        throw IllegalStateException("The trip kept changing; try again")
    }

    /**
     * As the web's rewriteBookings: [change] gives the bookings it changed, as
     * whole documents, and any fields for the trip; when the trip is shown is
     * then settled from every booking (liveBounds), and its own dates only
     * widen. The bookings are read outside the transaction, the trip's
     * updatedAt standing in as their revision, as in [fitTripDates].
     */
    private suspend fun rewriteBookings(
        tripId: String,
        change: (trip: DocumentSnapshot, bookings: List<Pair<String, Map<String, Any?>>>, now: String) -> Pair<List<Pair<String, Map<String, Any?>>>, Map<String, Any>>,
    ) {
        val tripRef = db.collection("trips").document(tripId)
        repeat(ATTEMPTS) {
            val before = tripRef.get().await()
            if (!before.exists()) throw TripGoneException("Trip no longer exists")
            if (before.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
            val seen = before.getString("updatedAt")
            val bookings = tripRef.collection("segments").get().await().documents.mapNotNull { doc -> doc.data?.let { doc.id to it } }
            val now = Clock.System.now().toString()
            val applied = db.runTransaction { t ->
                val snap = t.get(tripRef)
                if (!snap.exists()) throw TripGoneException("Trip no longer exists")
                if (snap.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
                if (snap.getString("updatedAt") != seen) return@runTransaction false
                val trip = tripFromDocument(tripId, snap.data.orEmpty()) ?: throw IllegalStateException("Malformed trip")
                val (changed, tripFields) = change(snap, bookings, now)
                val after = bookings.map { (id, data) -> changed.firstOrNull { it.first == id } ?: (id to data) }
                    .mapNotNull { (id, data) -> segmentFromDocument(id, tripId, data) }
                val booked = bookedDateRange(after)
                val own = if (booked != null) minOf(trip.start, booked.first) to maxOf(trip.end, booked.second) else trip.start to trip.end
                val live = liveBounds(own, after)
                // Written whole, so a field taken off (a restore) is gone.
                for ((id, data) in changed) t.setData(tripRef.collection("segments").document(id), data + mapOf("updatedAt" to now))
                t.updateData(
                    tripRef,
                    mapOf(
                        "start" to own.first,
                        "end" to own.second,
                        "liveStart" to (live?.first ?: FieldValue.delete()),
                        "liveEnd" to (live?.second ?: FieldValue.delete()),
                    ) + FLAGS_UNKNOWN + tripFields + mapOf("updatedAt" to now),
                )
                true
            }.await()
            if (applied) return
        }
        throw IllegalStateException("The trip kept changing; try again")
    }

    override fun newTripId(): String = db.collection("trips").document().id

    /** As the web's createTrip: owned by [uid], shared with nobody, no bookings yet. */
    override suspend fun createTrip(id: String, uid: String, title: String, start: String, end: String) {
        val now = Clock.System.now().toString()
        db.collection("trips").document(id).setData(
            mapOf("id" to id, "title" to title, "start" to start, "end" to end, "ownerUid" to uid, "sharedWith" to emptyList<String>(), "createdAt" to now, "updatedAt" to now),
        ).await()
    }

    /** As the web's cancelSegment: the person's word that a booking didn't happen. */
    override suspend fun cancelSegment(tripId: String, segmentId: String) = rewriteBookings(tripId) { _, bookings, now ->
        val data = bookings.firstOrNull { it.first == segmentId }?.second ?: throw TripGoneException("That booking is no longer in this trip")
        val changed = if (data["cancelledAt"] is String) emptyList() else listOf(segmentId to data + mapOf("cancelledAt" to now, "userCancelled" to "booking"))
        changed to emptyMap()
    }

    /** As the web's cancelTrip: every booking still booked is cancelled with the trip; those already cancelled stay as they were. */
    override suspend fun cancelTrip(tripId: String) = rewriteBookings(tripId) { _, bookings, now ->
        bookings.filter { (_, data) -> data["cancelledAt"] !is String }.map { (id, data) -> id to data + mapOf("cancelledAt" to now, "userCancelled" to "trip") } to
            mapOf("cancelledAt" to now)
    }

    /** As the web's restoreTrip: the bookings cancelled with the trip are booked again; those cancelled on their own stay so. */
    override suspend fun restoreTrip(tripId: String) = rewriteBookings(tripId) { _, bookings, now ->
        bookings.filter { (_, data) -> data["userCancelled"] == "trip" }.map { (id, data) -> id to inTripDocument(data, null, now) } to
            mapOf("cancelledAt" to FieldValue.delete())
    }

    /** As the web's shareTrip: sharing also invites the address, in the same batch, so it can open the trip without asking. */
    override suspend fun shareTrip(tripId: String, email: String, inviterUid: String) {
        val address = emailAddressOf(email) ?: throw IllegalArgumentException("Enter an email address")
        val now = Clock.System.now().toString()
        db.runBatch { batch ->
            batch.updateData(db.collection("trips").document(tripId), mapOf("sharedWith" to FieldValue.arrayUnion(address), "updatedAt" to now))
            batch.setData(accessRef(address), accessInvite(address, inviterUid, now), SetOptions.merge())
        }.await()
    }

    override suspend fun unshareTrip(tripId: String, email: String) {
        db.collection("trips").document(tripId)
            .updateData(mapOf("sharedWith" to FieldValue.arrayRemove(email), "updatedAt" to Clock.System.now().toString())).await()
    }

    // Marked deleting first, which stops every other writer, then read: if anything else arrived, the mark comes off.
    // A failed read takes off a mark this call made, so the trip isn't left locked unchecked.
    override suspend fun deleteTripIfOnly(tripId: String, expected: Set<String>): Boolean {
        val tripRef = db.collection("trips").document(tripId)
        val mark = db.runTransaction { t ->
            val snap = t.get(tripRef)
            when {
                !snap.exists() -> "gone"
                snap.getBoolean("deleting") == true -> "already"
                else -> {
                    t.updateData(tripRef, mapOf("deleting" to true, "updatedAt" to Clock.System.now().toString()))
                    "marked"
                }
            }
        }.await()
        if (mark == "gone") return true
        suspend fun release() {
            tripRef.updateData(mapOf("deleting" to false, "updatedAt" to Clock.System.now().toString())).await()
        }
        val ids = try {
            tripRef.collection("segments").get().await().documents.map { it.id }
        } catch (e: Exception) {
            if (e !is CancellationException) SharedLog.error(e, "Reading a trip's bookings before deleting it failed")
            // Even when cancelled: the mark must not outlive the check.
            if (mark == "marked") withContext(NonCancellable) { release() }
            throw e
        }
        if (ids.any { it !in expected }) {
            release()
            return false
        }
        deleteTrip(tripId)
        return true
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
            if (snap.getBoolean("deleting") != true) t.updateData(tripRef, mapOf("deleting" to true, "updatedAt" to Clock.System.now().toString()))
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
        val now = Clock.System.now().toString()
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
            // Cancelled with a cancelled trip it joins, live again leaving one.
            val moved = inTripDocument(data + mapOf("tripId" to toTripId, "updatedAt" to now), to.getString("cancelledAt"), now)
            val segment = segmentFromDocument(segmentId, toTripId, moved) ?: throw IllegalStateException("Malformed booking")
            val range = bookedDateRange(listOf(segment))
            t.setData(toRef.collection("segments").document(segmentId), moved)
            t.delete(segmentRef)
            t.updateData(toRef, (if (range != null) widened(to, range, segmentDateRange(listOf(segment)), now) else mapOf("updatedAt" to now)) + FLAGS_UNKNOWN)
            t.updateData(fromRef, mapOf("updatedAt" to now) + FLAGS_UNKNOWN)
            null
        }.await()
    }

    /**
     * As the web's moveSegmentToNewTrip: the rules check a booking against its trip as it already is, so the
     * trip is made first and the booking then moved; a move that fails takes the empty trip away again.
     */
    override suspend fun repairTripFlags(tripId: String) {
        val ref = db.collection("trips").document(tripId)
        val before = ref.get(Source.SERVER).await()
        val revision = before.getString("updatedAt") ?: return
        val trip = tripFromDocument(tripId, before.data ?: return) ?: return
        if (trip.deleting) return
        val flags = tripFlagsToWrite(trip, serverSegments(tripId)) ?: return
        val written = db.runTransaction { t ->
            // A booking changed since the bookings were read: it is read again next time.
            if (t.get(ref).getString("updatedAt") != revision) return@runTransaction false
            t.updateData(ref, mapOf("allCancelled" to flags.allCancelled, "localOnly" to flags.localOnly))
            true
        }.await()
        if (!written) SharedLog.info("A trip's bookings changed while its list flags were read; left for the next read")
    }

    /** As the web's addSegmentToFittingTrip, when no trip fits: the trip first, then the booking in it. */
    override suspend fun addSegmentToNewTrip(draft: SegmentDraft, uid: String): String {
        val range = listOfNotNull(draft.start, draft.end).map { localDate(it) }
        val ref = db.collection("trips").document()
        val now = Clock.System.now().toString()
        ref.setData(
            mapOf(
                "id" to ref.id,
                "title" to newTripTitle(draft),
                "start" to range.min(),
                "end" to range.max(),
                "ownerUid" to uid,
                "sharedWith" to emptyList<String>(),
                "createdAt" to now,
                "updatedAt" to now,
            ),
        ).await()
        try {
            saveSegment(ref.id, draft, null)
        } catch (e: Exception) {
            withContext(NonCancellable) {
                try {
                    SharedLog.error(e, "Adding a booking to a new trip failed; removing the empty trip")
                    ref.delete().await()
                } catch (cleanup: Exception) {
                    SharedLog.error(cleanup, "Removing the empty trip failed; it stays")
                }
            }
            throw e
        }
        return ref.id
    }

    override suspend fun moveSegmentToNewTrip(fromTripId: String, segmentId: String, uid: String): String {
        val fromRef = db.collection("trips").document(fromTripId)
        val from = fromRef.get().await()
        if (!from.exists()) throw TripGoneException("Trip no longer exists")
        val current = fromRef.collection("segments").document(segmentId).get().await()
        val data = current.data
        if (!current.exists() || data == null) throw TripGoneException("That booking is no longer in this trip")
        val source = tripFromDocument(fromTripId, from.data ?: emptyMap()) ?: throw IllegalStateException("Malformed trip")
        val segment = segmentFromDocument(segmentId, fromTripId, data) ?: throw IllegalStateException("Malformed booking")
        val range = bookedDateRange(listOf(segment)) ?: throw IllegalStateException("That booking has no dates")
        val ref = db.collection("trips").document()
        val now = Clock.System.now().toString()
        // The trip's own write is inside too: cancelled while it waits, it may still land.
        try {
            ref.setData(
                mapOf(
                    "id" to ref.id,
                    "title" to newTripTitle(segment),
                    "start" to range.first,
                    "end" to range.second,
                    "ownerUid" to uid,
                    "sharedWith" to if (source.ownerUid == uid) source.sharedWith else emptyList(),
                    "createdAt" to now,
                    "updatedAt" to now,
                ),
            ).await()
            moveSegment(fromTripId, segmentId, ref.id)
        } catch (e: Exception) {
            // Cancelling the coroutine doesn't cancel a transaction that may already have committed, so the
            // trip goes only once the booking is known not to be in it; cancellation can't interrupt that.
            withContext(NonCancellable) {
                try {
                    if (ref.collection("segments").document(segmentId).get(Source.SERVER).await().exists()) {
                        SharedLog.error(e, "Moving a booking to a new trip reported a failure, but the booking is there; keeping the trip")
                    } else {
                        SharedLog.error(e, "Moving a booking to a new trip failed; removing the empty trip")
                        ref.delete().await()
                    }
                } catch (cleanup: Exception) {
                    // Unknown whether the move landed: the trip stays rather than risk orphaning the booking.
                    SharedLog.error(cleanup, "Checking or removing the new trip failed; it stays")
                }
            }
            throw e
        }
        return ref.id
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
            val now = Clock.System.now().toString()
            val applied = db.runTransaction { t ->
                val s = t.get(sourceRef)
                val g = t.get(targetRef)
                if (!s.exists() || !g.exists()) throw TripGoneException("Trip no longer exists")
                if (s.getBoolean("deleting") == true || g.getBoolean("deleting") == true) throw TripGoneException("This trip is being deleted")
                if (s.getString("updatedAt") != seen) return@runTransaction false
                // As they stand in the target: cancelled with it, or live again.
                val moved = docs.map { doc -> doc to inTripDocument(doc.data.orEmpty() + mapOf("tripId" to targetId, "updatedAt" to now), g.getString("cancelledAt"), now) }
                val live = segmentDateRange(moved.mapNotNull { (doc, data) -> segmentFromDocument(doc.id, targetId, data) })
                for ((doc, data) in moved) {
                    t.setData(targetRef.collection("segments").document(doc.id), data)
                    t.delete(doc.reference)
                }
                t.updateData(targetRef, (if (range != null) widened(g, range, live, now) else mapOf("updatedAt" to now)) + FLAGS_UNKNOWN)
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

    /**
     * Taken off a trip by every write here that changes its bookings: unknown again, the list flags are recomputed
     * from the bookings the next time the app reads them (TripsViewModel.keepTripFlags), rather than stand wrong for
     * a trip whose screen isn't open. As the web's edits.ts.
     */
    private val FLAGS_UNKNOWN: Map<String, Any> = mapOf("allCancelled" to FieldValue.delete(), "localOnly" to FieldValue.delete())

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
            SharedLog.error(error, "Reading %s failed", safe(what))
            emit(null)
        }

    private companion object {
        /** How often a revision-checked write is retried before giving up. */
        const val ATTEMPTS = 5

        /** Firestore's batch limit, with room to spare. */
        const val BATCH = 400
    }
}
