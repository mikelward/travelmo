package app.travelmo.core

/**
 * Two bookings the user says are one, as one, as packages/core/src/mergeBookings.ts has it (keep the two the same),
 * on bookings' documents as Firestore stores them: [keep] as it is, with what only [other] knew filled in, every
 * source of both, [otherId] remembered in `mergedFrom` so its email read again finds this booking, and the merge
 * recorded as a hand edit.
 */
fun mergedBookingDocument(keep: Map<String, Any?>, other: Map<String, Any?>, otherId: String, now: String): Map<String, Any?> {
    val merged = keep.toMutableMap()
    for (key in listOf("provider", "confirmation", "end", "origin", "destination", "sender", "rating")) {
        if (merged[key] == null && other[key] != null) merged[key] = other[key]
    }
    val keepReference = (keep["confirmation"] as? String)?.takeIf { it.isNotBlank() }
    val otherReference = (other["confirmation"] as? String)?.takeIf { it.isNotBlank() }
    val normalize = { ref: String -> ref.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' } }
    val referenceNote = if (keepReference != null && otherReference != null && normalize(keepReference) != normalize(otherReference)) "Other reference: $otherReference" else null
    // Each note once: one the kept notes already say isn't added again.
    val notes = mutableListOf<String>()
    for (note in listOf((keep["notes"] as? String)?.trim(), (other["notes"] as? String)?.trim(), referenceNote)) {
        if (!note.isNullOrEmpty() && notes.none { it.contains(note) }) notes += note
    }
    if (notes.isNotEmpty()) merged["notes"] = notes.joinToString("\n")
    // Everyone either names, each once, as many as a booking holds.
    val travelers = canonicalTravelers(((keep["travelers"] as? List<*>).orEmpty() + (other["travelers"] as? List<*>).orEmpty()).filterIsInstance<String>())
    if (travelers != null) merged["travelers"] = travelers
    if (keep["favorite"] == true || other["favorite"] == true) merged["favorite"] = true
    val sources = ((keep["sources"] as? List<*>).orEmpty() + (other["sources"] as? List<*>).orEmpty())
        .distinctBy { (it as? Map<*, *>)?.let { s -> s["kind"] to s["id"] } ?: it }
    if (sources.isNotEmpty()) merged["sources"] = sources
    merged["gmailMessageIds"] = ((keep["gmailMessageIds"] as? List<*>).orEmpty() + (other["gmailMessageIds"] as? List<*>).orEmpty()).distinct()
    // A cancellation either was restored from stays taken back: merging two live bookings never undoes a Restore.
    val restoredFrom = ((keep["restoredFrom"] as? List<*>).orEmpty() + (other["restoredFrom"] as? List<*>).orEmpty()).distinct().take(50)
    if (restoredFrom.isNotEmpty()) merged["restoredFrom"] = restoredFrom
    val keepRestoredAt = keep["restoredAt"] as? String
    val otherRestoredAt = other["restoredAt"] as? String
    if (otherRestoredAt != null && (keepRestoredAt == null || compareInstants(otherRestoredAt, keepRestoredAt) > 0)) merged["restoredAt"] = otherRestoredAt
    merged["mergedFrom"] = ((keep["mergedFrom"] as? List<*>).orEmpty() + otherId + (other["mergedFrom"] as? List<*>).orEmpty()).distinct().take(50)
    // What the other said, for its emails read again: as mergeBookings.ts's mergedBooking.
    val said = listOf("type", "title", "start", "end", "provider", "confirmation", "origin", "destination").mapNotNull { key -> other[key]?.let { key to it } }.toMap()
    merged["mergedBookings"] = ((keep["mergedBookings"] as? List<*>).orEmpty() + listOf(said) + (other["mergedBookings"] as? List<*>).orEmpty()).take(50)
    merged["editedAt"] = now
    merged["updatedAt"] = now
    return merged
}
