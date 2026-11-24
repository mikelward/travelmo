package app.travelmo.data

import app.travelmo.core.AddressHolder
import app.travelmo.core.PendingEmail
import app.travelmo.core.FlightStatus
import app.travelmo.core.FoundLoyalty
import app.travelmo.core.BackfillShown
import app.travelmo.core.RefreshShown
import app.travelmo.core.GmailMailbox
import app.travelmo.core.gmailMailboxes
import app.travelmo.core.ImapMailbox
import app.travelmo.core.imapMailboxes
import app.travelmo.core.ParsedRecord
import app.travelmo.core.SenderPatterns
import app.travelmo.core.LoyaltyPerson
import app.travelmo.core.isMembershipNumber
import app.travelmo.core.Place
import app.travelmo.core.PlaceDraft
import app.travelmo.core.ProfileEntry
import app.travelmo.core.ProfileField
import app.travelmo.core.TravelProfile
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.SegmentType
import app.travelmo.core.SourceKind
import app.travelmo.core.SourceRef
import app.travelmo.core.segmentSources
import app.travelmo.core.Trip

// Firestore documents into the models, by hand and leniently: a document
// missing what a screen needs is dropped (and logged by the caller) rather
// than crashing the list, since the parser and the web app write them and
// this app only reads.

private fun Map<String, Any?>.text(key: String): String? = (this[key] as? String)?.takeIf { it.isNotEmpty() }

private fun Map<String, Any?>.strings(key: String): List<String> =
    (this[key] as? List<*>)?.filterIsInstance<String>() ?: emptyList()

@Suppress("UNCHECKED_CAST")
private fun Map<String, Any?>.map(key: String): Map<String, Any?>? = this[key] as? Map<String, Any?>

@Suppress("UNCHECKED_CAST")
private fun Map<String, Any?>.sourceRefs(): List<SourceRef> =
    (this["sources"] as? List<*>).orEmpty().mapNotNull { raw ->
        val ref = raw as? Map<String, Any?> ?: return@mapNotNull null
        val kind = SourceKind.fromWire(ref.text("kind")) ?: return@mapNotNull null
        val id = ref.text("id") ?: return@mapNotNull null
        // The schema requires `at`; one without it takes the booking's creation rather than being dropped.
        SourceRef(kind, id, label = ref.text("label"), uid = ref.text("uid"), at = ref.text("at") ?: text("createdAt") ?: "", sentAt = ref.text("sentAt"))
    }

fun tripFromDocument(id: String, data: Map<String, Any?>): Trip? {
    val title = data.text("title") ?: return null
    val start = data.text("start") ?: return null
    val end = data.text("end") ?: return null
    val ownerUid = data.text("ownerUid") ?: return null
    return Trip(
        id = id,
        title = title,
        start = start,
        end = end,
        ownerUid = ownerUid,
        sharedWith = data.strings("sharedWith"),
        deleting = data["deleting"] == true,
        liveStart = data.text("liveStart"),
        liveEnd = data.text("liveEnd"),
        cancelledAt = data.text("cancelledAt"),
        allCancelled = data["allCancelled"] as? Boolean,
        localOnly = data["localOnly"] as? Boolean,
    )
}

fun placeFromDocument(data: Map<String, Any?>?): Place? {
    val name = data?.text("name") ?: return null
    return Place(
        name, code = data.text("code"), city = data.text("city"), country = data.text("country"), address = data.text("address"),
        lat = (data["lat"] as? Number)?.toDouble(), lon = (data["lon"] as? Number)?.toDouble(),
    )
}

fun segmentFromDocument(id: String, tripId: String, data: Map<String, Any?>): Segment? {
    val type = SegmentType.fromWire(data.text("type")) ?: return null
    val title = data.text("title") ?: return null
    val start = data.text("start") ?: return null
    return Segment(
        id = id,
        tripId = tripId,
        type = type,
        title = title,
        start = start,
        end = data.text("end"),
        provider = data.text("provider"),
        confirmation = data.text("confirmation"),
        origin = placeFromDocument(data.map("origin")),
        destination = placeFromDocument(data.map("destination")),
        notes = data.text("notes"),
        sender = data.text("sender"),
        rating = (data["rating"] as? Number)?.toInt()?.takeIf { it in 1..5 },
        favorite = data["favorite"] == true,
        // Imports record every source they were read from; older documents
        // only list their Gmail message ids.
        sources = segmentSources(data.sourceRefs(), data.strings("gmailMessageIds"), data.text("createdAt") ?: ""),
        cancelledAt = data.text("cancelledAt"),
        cancelledBy = data.text("cancelledBy"),
        userCancelled = data.text("userCancelled")?.takeIf { it == "booking" || it == "trip" },
    )
}

/** A flight's live gates and carousel (`flightStatus/{key}`), written by the parser. */
fun flightStatusFromDocument(data: Map<String, Any?>): FlightStatus? {
    val ident = data.text("ident") ?: return null
    val date = data.text("date") ?: return null
    val found = data["found"] as? Boolean ?: return null
    val checkedAt = data.text("checkedAt") ?: return null
    return FlightStatus(
        ident = ident,
        date = date,
        origin = data.text("origin"),
        found = found,
        departureGate = data.text("departureGate"),
        departureTerminal = data.text("departureTerminal"),
        arrivalGate = data.text("arrivalGate"),
        arrivalTerminal = data.text("arrivalTerminal"),
        baggageClaim = data.text("baggageClaim"),
        scheduledOut = data.text("scheduledOut"),
        estimatedOut = data.text("estimatedOut"),
        actualOut = data.text("actualOut"),
        scheduledIn = data.text("scheduledIn"),
        estimatedIn = data.text("estimatedIn"),
        actualIn = data.text("actualIn"),
        cancelled = data["cancelled"] == true,
        diverted = data["diverted"] == true,
        divertedTo = data.text("divertedTo"),
        noticedOut = data.text("noticedOut"),
        checkedAt = checkedAt,
    )
}

/**
 * A place as the form leaves it, over the stored one: while the name holds,
 * whatever an import recorded besides (city, address, the spot on the map)
 * survives; a new name drops them, as the web's form does.
 */
fun placeToDocument(draft: PlaceDraft?, stored: Map<String, Any?>?): Map<String, Any?>? {
    if (draft == null) return null
    val kept = if (stored != null && stored["name"] == draft.name) stored else emptyMap()
    val place = LinkedHashMap(kept)
    place["name"] = draft.name
    if (draft.code != null) place["code"] = draft.code else place.remove("code")
    if (draft.country != null) place["country"] = draft.country else place.remove("country")
    return place
}

/**
 * The booking document a save writes: the stored document with the form's
 * fields over it, so what the form does not edit (sources, the sender, the
 * rating and the favorite mark, places' details) stays, and when it was
 * edited is recorded (editedAt). A new booking is
 * manual, with no sources. Absent values are absent, never null: the rules
 * list the keys a booking may have and Firestore keeps a null as a field.
 */
fun draftToDocument(draft: SegmentDraft, stored: Map<String, Any?>?, id: String, tripId: String, now: String): Map<String, Any?> {
    val doc = LinkedHashMap(stored ?: emptyMap())
    doc["id"] = id
    doc["tripId"] = tripId
    doc["type"] = draft.type.wire
    doc["title"] = draft.title
    doc["start"] = draft.start
    for ((key, value) in listOf("provider" to draft.provider, "confirmation" to draft.confirmation, "end" to draft.end, "notes" to draft.notes)) {
        if (value != null) doc[key] = value else doc.remove(key)
    }
    @Suppress("UNCHECKED_CAST")
    for ((key, place) in listOf("origin" to draft.origin, "destination" to draft.destination)) {
        val written = placeToDocument(place, stored?.get(key) as? Map<String, Any?>)
        if (written != null) doc[key] = written else doc.remove(key)
    }
    if (doc["source"] !is String) doc["source"] = "manual"
    if (doc["gmailMessageIds"] !is List<*>) doc["gmailMessageIds"] = emptyList<String>()
    if (doc["createdAt"] !is String) doc["createdAt"] = now
    // A hand edit, which Refresh from email leaves as it is (the rules refuse
    // a change to the details without it).
    doc["editedAt"] = now
    doc["updatedAt"] = now
    return doc
}

/**
 * A booking document as it stands in a trip cancelled at [tripCancelledAt]
 * (null for one that isn't), for a write that puts it there: cancelled with a
 * cancelled trip, or live again leaving one (inTrip in :core).
 */
fun inTripDocument(data: Map<String, Any?>, tripCancelledAt: String?, now: String): Map<String, Any?> = when {
    tripCancelledAt != null && data["cancelledAt"] !is String -> data + mapOf("cancelledAt" to now, "userCancelled" to "trip")
    tripCancelledAt == null && data["userCancelled"] == "trip" -> data - "cancelledAt" - "userCancelled"
    else -> data
}

@Suppress("UNCHECKED_CAST")
private fun Map<String, Any?>.entries(key: String): List<ProfileEntry> =
    (this[key] as? List<*>).orEmpty().mapNotNull { raw ->
        val entry = raw as? Map<String, Any?> ?: return@mapNotNull null
        val title = entry.text("title") ?: return@mapNotNull null
        val fields = (entry["fields"] as? List<*>).orEmpty().mapNotNull { f ->
            val field = f as? Map<String, Any?> ?: return@mapNotNull null
            ProfileField(field["label"] as? String ?: return@mapNotNull null, field["value"] as? String ?: return@mapNotNull null)
        }
        ProfileEntry(title, fields)
    }

/** The addresses `users/{uid}` names (SPEC "Linked email addresses"); anything malformed counts as absent. */
fun addressHolderFromDocument(data: Map<String, Any?>): AddressHolder = AddressHolder(
    emails = data.strings("emails"),
    gmails = gmailStatusesOf(data).map { it.emailAddress },
    pendingEmails = (data["pendingEmails"] as? List<*>).orEmpty().mapNotNull { p ->
        val entry = p as? Map<*, *> ?: return@mapNotNull null
        PendingEmail(entry["email"] as? String ?: return@mapNotNull null, entry["sentAt"] as? String ?: return@mapNotNull null, entry["expiresAt"] as? String ?: return@mapNotNull null)
    },
)

/** users/{uid}/travelProfile/main as the parser writes it. */
fun profileFromDocument(data: Map<String, Any?>): TravelProfile? {
    val ownerUid = data.text("ownerUid") ?: return null
    return TravelProfile(
        ownerUid = ownerUid,
        ownerEmail = data.text("ownerEmail"),
        trustedEmails = data.strings("trustedEmails"),
        travelers = data.entries("travelers"),
        loyalty = data.entries("loyalty"),
        documents = data.entries("documents"),
        foundLoyalty = foundLoyaltyOf(data["foundLoyalty"]),
        importedAt = data.text("importedAt"),
        loyaltyPeople = loyaltyPeopleOf(data["loyaltyPeople"]),
    )
}

/** Loyalty numbers read from booking emails; an entry missing its program, number, email or time, or whose number is a balance, is left out, as on the web. */
fun foundLoyaltyOf(value: Any?): List<FoundLoyalty> = (value as? List<*>).orEmpty().mapNotNull { item ->
    @Suppress("UNCHECKED_CAST")
    val map = item as? Map<String, Any?> ?: return@mapNotNull null
    FoundLoyalty(
        program = map.text("program") ?: return@mapNotNull null,
        number = map.text("number")?.takeIf(::isMembershipNumber) ?: return@mapNotNull null,
        holder = map.text("holder"),
        status = map.text("status"),
        messageId = map.text("messageId") ?: return@mapNotNull null,
        label = map.text("label"),
        at = map.text("at") ?: return@mapNotNull null,
        balance = map.text("balance"),
        balanceAt = map.text("balanceAt"),
        balanceLabel = map.text("balanceLabel"),
        statusAt = map.text("statusAt"),
        person = map.text("person"),
    )
}

/** Whose each membership is, as the owner said; an entry missing its program or number is left out. */
fun loyaltyPeopleOf(value: Any?): List<LoyaltyPerson> = (value as? List<*>).orEmpty().mapNotNull { item ->
    val map = item as? Map<*, *> ?: return@mapNotNull null
    LoyaltyPerson(
        program = (map["program"] as? String)?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null,
        number = (map["number"] as? String)?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null,
        person = (map["person"] as? String)?.trim()?.takeIf { it.isNotEmpty() },
    )
}

/** An import record, as the review list reads it; one missing its outcome or time is left out. */
fun parsedRecordOf(id: String, data: Map<String, Any?>?): ParsedRecord? {
    val map = data ?: return null
    return ParsedRecord(
        messageId = map.text("messageId") ?: id,
        outcome = map.text("outcome") ?: return null,
        processedAt = map.text("processedAt") ?: return null,
        source = map.text("source"),
        reason = map.text("reason"),
        from = map.text("from"),
        subject = map.text("subject"),
        sentAt = map.text("sentAt"),
    )
}

/** The user's sender rules; anything that isn't a list of names reads as none. */
fun senderPatternsOf(data: Map<String, Any?>?): SenderPatterns =
    SenderPatterns(allow = data.orEmpty().strings("allow"), deny = data.orEmpty().strings("deny"))

/**
 * One connected Gmail mailbox on the user document: the address, how far
 * the last reading got, and what its emails' sources are named by
 * ([GmailMailbox]).
 */
data class GmailStatus(
    val emailAddress: String,
    val progress: BackfillShown? = null,
    val connectedAt: String = "",
    val idPrefix: String = "",
) {
    val mailbox: GmailMailbox get() = GmailMailbox(emailAddress, connectedAt, idPrefix)
}

/** The Fastmail connection on the user document: the address, and how far the last reading got. */
data class FastmailStatus(val emailAddress: String, val progress: BackfillShown? = null)

/**
 * The user document's connected mailboxes (`gmails`, and `gmail`, one
 * connected before there could be several), oldest first. A malformed
 * entry reads as none, a malformed progress as no progress.
 */
fun gmailStatusesOf(data: Map<String, Any?>?): List<GmailStatus> {
    val all = (data?.get("gmails") as? Map<*, *>).orEmpty().values.mapNotNull(::gmailStatusOf)
    val legacy = gmailStatusOf(data?.get("gmail"))
    val ordered = gmailMailboxes(all.map { it.mailbox }, legacy?.mailbox)
    // The frozen `gmail` copy first, so a moved mailbox's live `gmails`
    // entry, with its reading progress, replaces it.
    val byAddress = (listOfNotNull(legacy) + all).associateBy { it.mailbox }
    return ordered.mapNotNull { byAddress[it] }
}

private fun gmailStatusOf(entry: Any?): GmailStatus? {
    val gmail = entry as? Map<*, *> ?: return null
    val address = connectedAddressOf(gmail) ?: return null
    return GmailStatus(address, backfillOf(gmail), gmail["connectedAt"] as? String ?: "", gmail["idPrefix"] as? String ?: "")
}

/** The user document's Fastmail connection (`fastmail`); null when none. A malformed progress reads as none. */
fun fastmailStatusOf(data: Map<String, Any?>?): FastmailStatus? {
    val fastmail = data?.get("fastmail") as? Map<*, *> ?: return null
    val address = connectedAddressOf(fastmail) ?: return null
    return FastmailStatus(address, backfillOf(fastmail))
}

/**
 * The user document's mailboxes connected over IMAP (`imaps`), oldest first.
 * A malformed entry reads as none, a malformed progress as no progress.
 */
fun imapStatusesOf(data: Map<String, Any?>?): List<ImapMailbox> = imapMailboxes(
    (data?.get("imaps") as? Map<*, *>).orEmpty().values.mapNotNull { entry ->
        val imap = entry as? Map<*, *> ?: return@mapNotNull null
        val address = connectedAddressOf(imap) ?: return@mapNotNull null
        ImapMailbox(address, imap["connectedAt"] as? String ?: "", backfillOf(imap), imap["loginFailedAt"] as? String)
    },
)

/** A mailbox connection's address; null when blank or missing. */
private fun connectedAddressOf(connection: Map<*, *>): String? = (connection["emailAddress"] as? String)?.takeIf { it.isNotBlank() }

/** How far the last Refresh from email got (`refresh` on the user document); null when none or malformed. */
fun refreshOf(data: Map<String, Any?>?): RefreshShown? {
    val p = data?.get("refresh") as? Map<*, *> ?: return null
    fun count(key: String) = (p[key] as? Number)?.toInt()
    return RefreshShown(
        scanned = count("scanned") ?: return null,
        done = p["done"] as? Boolean ?: return null,
        updatedAt = p["updatedAt"] as? String ?: return null,
        total = count("total"),
        updated = count("updated") ?: 0,
        added = count("added") ?: 0,
        removed = count("removed") ?: 0,
        merged = count("merged") ?: 0,
        kept = count("kept") ?: 0,
        missing = count("missing") ?: 0,
        failed = count("failed") ?: 0,
        running = p["running"] == true,
        leaseUntil = p["leaseUntil"] as? String,
        failedIds = (p["failedIds"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
        retrying = (p["retrying"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
    )
}

/** How far a mailbox connection's last reading got; null when none or malformed. */
private fun backfillOf(connection: Map<*, *>): BackfillShown? {
    val p = connection["backfill"] as? Map<*, *> ?: return null
    fun count(key: String) = (p[key] as? Number)?.toInt()
    return BackfillShown(
        scanned = count("scanned") ?: return null,
        imported = count("imported") ?: return null,
        done = p["done"] as? Boolean ?: return null,
        updatedAt = p["updatedAt"] as? String ?: return null,
        failed = count("failed") ?: 0,
        running = p["running"] == true,
        leaseUntil = p["leaseUntil"] as? String,
        retryAfter = p["retryAfter"] as? String,
        failures = count("failures") ?: 0,
        retrying = (p["retrying"] as? List<*>)?.size ?: 0,
    )
}
