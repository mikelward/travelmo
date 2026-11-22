package app.travelmo.data

import app.travelmo.core.FlightStatus
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
        SourceRef(kind, id, label = ref.text("label"), uid = ref.text("uid"), at = ref.text("at") ?: text("createdAt") ?: "")
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
 * rating and the favorite mark, places' details) stays. A new booking is
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
    doc["updatedAt"] = now
    return doc
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
    )
}
