package app.travelmo.core

import kotlin.time.Instant
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime

// Import review, as packages/core's review.ts narrows and shows it.

/** One import record (users/{uid}/parsedMessages/{id}), as the review list reads it. */
data class ParsedRecord(
    val messageId: String,
    val outcome: String,
    val processedAt: String,
    val source: String? = null,
    val reason: String? = null,
    val from: String? = null,
    val subject: String? = null,
    /** When the email was sent; null for other sources and older records. */
    val sentAt: String? = null,
    /** What a travel program's email gave of the user's loyalty, a line a membership ("Delta: Silver Medallion · 49,606 Miles"). */
    val loyalty: List<String> = emptyList(),
    /** Why such an email gave none ("no member number in it"). */
    val loyaltyMissed: String? = null,
)

/** Bounds for a range of local days in [zone]: from the start of [from] to the start of the day after [to]. */
data class DayRange(val start: Instant? = null, val end: Instant? = null)

/** [from] and [to] are "YYYY-MM-DD", [zone] an IANA zone such as "Europe/London". */
fun dayRange(from: String?, to: String?, zone: String): DayRange {
    val tz = TimeZone.of(zone)
    return DayRange(
        from?.let { LocalDate.parse(it).atStartOfDayIn(tz) },
        to?.let { LocalDate.parse(it).plus(DatePeriod(days = 1)).atStartOfDayIn(tz) },
    )
}

private fun recordSearchText(record: ParsedRecord): String =
    listOfNotNull(record.subject, record.from, record.reason).joinToString(" ")

/** Whether each word of [keyword] starts a word of a record's subject, sender or reason, ignoring case and accents. */
fun matchesKeyword(record: ParsedRecord, keyword: String): Boolean {
    if (keyword.isBlank()) return true
    return hasWordStartsOf(recordSearchText(record), wordsOf(keyword))
}

private fun instantOf(record: ParsedRecord): Instant? = runCatching { Instant.parse(record.sentAt ?: record.processedAt) }.getOrNull()

/** Whether a record falls in [range]: by when the email was sent, or when it was read if that is unknown. */
fun inRange(record: ParsedRecord, range: DayRange): Boolean {
    if (range.start == null && range.end == null) return true
    val at = instantOf(record) ?: return false
    return (range.start == null || at >= range.start) && (range.end == null || at < range.end)
}

/** The records worth reviewing: not imported, not still being read, matching the keyword and the days, and those whose Import anyway report is still to copy ([kept]), whatever came of them. */
fun toReview(records: List<ParsedRecord>, keyword: String, range: DayRange = DayRange(), kept: Set<String> = emptySet()): List<ParsedRecord> {
    val queryWords = if (keyword.isBlank()) emptyList() else wordsOf(keyword)
    val checkRange = range.start != null || range.end != null
    return records.filter { r ->
        if (r.messageId in kept) return@filter true
        if (r.outcome == "imported" || r.outcome == "processing") return@filter false
        if (checkRange && !inRange(r, range)) return@filter false
        queryWords.isEmpty() || hasWordStartsOf(recordSearchText(r), queryWords)
    }
}

/** Records read once for a search, brought up to date by the live latest: newer copies win, new ones join. Newest first. */
fun withLatest(searched: List<ParsedRecord>, latest: List<ParsedRecord>): List<ParsedRecord> {
    val fresh = latest.map { it.messageId }.toSet()
    return (latest + searched.filterNot { it.messageId in fresh }).sortedByDescending { it.processedAt }
}

/** "Sent 23 May 2026 · Read 23 Nov 2026", or only when it was read if the email's date is unknown, in [zone] (IANA). */
fun reviewDate(record: ParsedRecord, zone: String): String {
    val tz = TimeZone.of(zone)
    fun day(at: String): String? = runCatching { Instant.parse(at) }.getOrNull()?.let { formatDayMonthYear(it.toLocalDateTime(tz).date.toString()) }
    val read = day(record.processedAt)?.let { "Read $it" }
    val sent = record.sentAt?.let(::day)?.let { "Sent $it" }
    return listOfNotNull(sent, read).joinToString(" · ")
}

/** What a record's outcome says, as the web's list says it: an email that gave loyalty ([loyalty]) says it kept it. */
fun outcomeLabel(outcome: String, loyalty: List<String> = emptyList()): String = when (outcome) {
    "processing" -> "Processing"
    "filtered" -> "Skipped before reading"
    "not_booking" -> if (loyalty.isNotEmpty()) "Read, loyalty kept" else "Read, not a booking"
    "imported" -> "Imported"
    "failed" -> "Failed"
    "cancellation" -> "Cancellation"
    else -> outcome
}

/**
 * Whether a record was read from a connected mailbox (one without `source`
 * is a Gmail one), so it can be read again and has a sender worth teaching;
 * forwarded emails, TripIt items and calendar events have neither. As
 * apps/web/src/lib/sourceLinks.ts.
 */
fun isFromMailbox(record: ParsedRecord): Boolean = (record.source ?: "gmail").let { it == "gmail" || it == "fastmail" || it == "imap" }

/** Where a record came from, as Import review says it on the web. */
fun recordSourceLabel(source: String?): String = when (source ?: "gmail") {
    "gmail" -> "Gmail"
    "fastmail" -> "Fastmail"
    "imap" -> "Other email"
    "tripit" -> "TripIt"
    "ics" -> "Calendar"
    "forward" -> "Forwarded email"
    else -> source.orEmpty()
}

/**
 * Whether a completed search cache ([cached], newest first) still joins cleanly
 * with the live [latest] window ([windowSize] newest records, newest first) so
 * [withLatest] cannot miss records imported since the search.
 */
fun reviewCacheCoversLatest(cached: List<ParsedRecord>, latest: List<ParsedRecord>?, windowSize: Int): Boolean {
    if (latest == null || latest.size < windowSize) return true
    if (cached.isEmpty()) return false
    val cachedNewest = cached.first().processedAt
    val oldestLatest = latest.last()
    if (oldestLatest.processedAt < cachedNewest) return true
    val cachedAt = cached.associate { it.messageId to it.processedAt }
    return latest.all { cachedAt[it.messageId] == it.processedAt }
}

/** How many records the review list shows, newest first, until a search reads them all. */
const val REVIEW_RECENT = 100

/** The most records a search reads, as on the web. */
const val REVIEW_SEARCH_CAP = 20_000

/** The parser's path for reading one message again, Gmail, Fastmail (`fm-` ids) or IMAP (`imap-` ids). */
const val REIMPORT_PATH = "/gmail/reimport"
