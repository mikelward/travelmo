package app.travelmo.data

import app.travelmo.core.Place
import app.travelmo.core.PlaceDraft
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.SegmentType
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
    )
}

fun placeFromDocument(data: Map<String, Any?>?): Place? {
    val name = data?.text("name") ?: return null
    return Place(name, code = data.text("code"), city = data.text("city"), country = data.text("country"), address = data.text("address"))
}

fun segmentFromDocument(id: String, tripId: String, data: Map<String, Any?>): Segment? {
    val type = SegmentType.fromWire(data.text("type")) ?: return null
    val title = data.text("title") ?: return null
    val start = data.text("start") ?: return null
    val sources = (data["sources"] as? List<*>)?.size ?: 0
    val gmailIds = data.strings("gmailMessageIds").size
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
        sourceCount = if (sources > 0) sources else gmailIds,
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
