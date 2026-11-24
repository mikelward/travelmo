package app.travelmo.core

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus

// Where a booking was read from, as packages/core/src/sources.ts: every
// email, TripIt trip or calendar event, and the link that opens an email in
// the mailbox it came from (Gmail only: Fastmail and IMAP mailboxes have no stable address for
// a message).

enum class SourceKind(val wire: String) {
    GMAIL("gmail"),
    TRIPIT("tripit"),
    ICS("ics"),
    FORWARD("forward"),
    FASTMAIL("fastmail"),
    IMAP("imap"),
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
    /** When an email source was sent (its Date), if known. */
    val sentAt: String? = null,
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
 * A Gmail search for an email, for where a link to it can't open it (the
 * Gmail app takes no such link, and Gmail's mobile site drops the message
 * id): its sender's domain, its subject, and the days around when it was
 * sent, wide enough for any time zone the mailbox searches in. As
 * packages/core/src/sources.ts's gmailSearch.
 */
fun gmailSearch(sender: String?, subject: String?, sentAt: String?): String {
    val sent = sentAt?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    fun day(offset: Int) = sent?.plus(DatePeriod(days = offset))?.toString()?.replace("-", "/")
    val words = subject?.replace("\"", " ")?.split(Regex("\\s+"))?.filter { it.isNotEmpty() }?.joinToString(" ")
    return listOfNotNull(
        sender?.takeIf { it.isNotEmpty() }?.let { "from:$it" },
        words?.takeIf { it.isNotEmpty() }?.let { "subject:\"$it\"" },
        day(-1)?.let { "after:$it" },
        day(2)?.let { "before:$it" },
    ).joinToString(" ")
}

/** "Fwd: ", "FW: ", "TR: ", "WG: " and the like, as packages/core/src/forward.ts's. */
private val FORWARD_PREFIX = Regex("^\\s*(?:fwd?|fw|tr|wg)\\s*:", RegexOption.IGNORE_CASE)

/**
 * The search for one of a booking's emails. The booking keeps one sender,
 * the first email's, so it narrows the search only when that is the one
 * email; and only a sent date counts, as `at` is when it was imported. A
 * forward ("Fwd: …") keeps its original's sender and date, not its own, so
 * it is searched by subject alone. As packages/core/src/sources.ts's
 * sourceSearch.
 */
fun sourceSearch(segment: Segment, source: SourceRef): String {
    val label = source.label
    if (label != null && FORWARD_PREFIX.containsMatchIn(label)) return gmailSearch(null, label, null)
    val emails = segment.sources.count { it.kind != SourceKind.TRIPIT && it.kind != SourceKind.ICS }
    return gmailSearch(if (emails == 1) segment.sender else null, source.label, source.sentAt)
}

/**
 * An email links only for the user whose mailbox it was read from: the
 * source's `uid`, or for sources recorded before imports were attributed,
 * the trip's owner; it opens in that one of the viewer's [mailboxes]
 * (gmailSourceLink). Only Gmail ones link. As apps/web/src/lib/sourceLinks.ts.
 */
fun emailLinkFor(source: SourceRef, viewerUid: String, ownsTrip: Boolean, mailboxes: List<GmailMailbox> = emptyList()): String? {
    if (source.kind != SourceKind.GMAIL) return null
    val mine = if (source.uid != null) source.uid == viewerUid else ownsTrip
    return if (mine) gmailSourceLink(source.id, mailboxes) else null
}

/** JavaScript's encodeURIComponent: UTF-8 bytes as %XX, but for letters, digits and -_.!~*'(). */
internal fun encodeUriComponent(value: String): String = buildString {
    for (byte in value.encodeToByteArray()) {
        val c = byte.toInt() and 0xFF
        if (c < 0x80 && (c.toChar().isLetterOrDigit() || c.toChar() in "-_.!~*'()")) append(c.toChar())
        else append('%').append(HEX_UPPER[c shr 4]).append(HEX_UPPER[c and 0xF])
    }
}

private const val HEX_UPPER = "0123456789ABCDEF"
