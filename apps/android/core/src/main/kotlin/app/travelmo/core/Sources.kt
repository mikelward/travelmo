package app.travelmo.core

import java.net.URLEncoder

// Where a booking was read from, as packages/core/src/sources.ts: every
// email, TripIt trip or calendar event, and the link that opens an email in
// the mailbox it came from.

enum class SourceKind(val wire: String) {
    GMAIL("gmail"),
    TRIPIT("tripit"),
    ICS("ics"),
    FORWARD("forward"),
    ;

    companion object {
        fun fromWire(value: String?): SourceKind? = entries.firstOrNull { it.wire == value }
    }
}

data class SourceRef(
    val kind: SourceKind,
    /** The Gmail message id, or the import record's id for the others. */
    val id: String,
    /** What the user recognizes it by: the email's subject, the TripIt trip's name, the event's title. */
    val label: String? = null,
    /** Whose import it was, and so whose mailbox an email is in. */
    val uid: String? = null,
    /** An ISO instant. */
    val at: String,
)

/**
 * A booking's sources, oldest first, one per source item: those recorded in
 * `sources`, plus Gmail messages listed only in `gmailMessageIds` (bookings
 * imported before sources were kept), dated by the booking's creation.
 */
fun segmentSources(sources: List<SourceRef>, gmailMessageIds: List<String>, createdAt: String): List<SourceRef> {
    val seen = HashSet<String>()
    val out = ArrayList<SourceRef>()
    for (ref in sources) {
        if (seen.add("${ref.kind.wire}/${ref.id}")) out.add(ref)
    }
    for (id in gmailMessageIds) {
        if (seen.add("gmail/$id")) out.add(SourceRef(SourceKind.GMAIL, id, at = createdAt))
    }
    return out.sortedBy { it.at }
}

/**
 * Opens the message in the Gmail account it was imported from; without the
 * address, in whichever account the browser has open first.
 */
fun gmailMessageUrl(messageId: String, account: String? = null): String {
    val user = if (account.isNullOrEmpty()) "u/0/" else "u/?authuser=${encodeUriComponent(account)}"
    return "https://mail.google.com/mail/$user#all/${encodeUriComponent(messageId)}"
}

/**
 * An email links only for the user whose mailbox it was read from: the
 * source's `uid`, or for sources recorded before imports were attributed,
 * the trip's owner. As apps/web/src/lib/sourceLinks.ts.
 */
fun emailLinkFor(source: SourceRef, viewerUid: String, ownsTrip: Boolean, account: String? = null): String? {
    if (source.kind != SourceKind.GMAIL) return null
    val mine = if (source.uid != null) source.uid == viewerUid else ownsTrip
    return if (mine) gmailMessageUrl(source.id, account) else null
}

/** JavaScript's encodeURIComponent: URLEncoder's form encoding, less its differences. */
private fun encodeUriComponent(value: String): String =
    URLEncoder.encode(value, Charsets.UTF_8)
        .replace("+", "%20")
        .replace("%21", "!")
        .replace("%27", "'")
        .replace("%28", "(")
        .replace("%29", ")")
        .replace("%7E", "~")
