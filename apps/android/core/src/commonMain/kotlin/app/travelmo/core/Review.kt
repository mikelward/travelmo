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

/** Whether a record's subject, sender or reason contains every word of [keyword], ignoring case. */
fun matchesKeyword(record: ParsedRecord, keyword: String): Boolean {
    val words = keyword.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return true
    val text = listOfNotNull(record.subject, record.from, record.reason).joinToString(" ").lowercase()
    return words.all { it in text }
}

private fun instantOf(record: ParsedRecord): Instant? = runCatching { Instant.parse(record.sentAt ?: record.processedAt) }.getOrNull()

/** Whether a record falls in [range]: by when the email was sent, or when it was read if that is unknown. */
fun inRange(record: ParsedRecord, range: DayRange): Boolean {
    val at = instantOf(record) ?: return range.start == null && range.end == null
    return (range.start == null || at >= range.start) && (range.end == null || at < range.end)
}

/** The records worth reviewing: not imported, not still being read, matching the keyword and the days. */
fun toReview(records: List<ParsedRecord>, keyword: String, range: DayRange = DayRange()): List<ParsedRecord> =
    records.filter { it.outcome != "imported" && it.outcome != "processing" && matchesKeyword(it, keyword) && inRange(it, range) }

/** Records read once for a search, brought up to date by the live latest: newer copies win, new ones join. Newest first. */
fun withLatest(searched: List<ParsedRecord>, latest: List<ParsedRecord>): List<ParsedRecord> {
    val fresh = latest.map { it.messageId }.toSet()
    return (latest + searched.filterNot { it.messageId in fresh }).sortedByDescending { it.processedAt }
}

/** "Sent 23 May 2026", or "Read 23 Nov 2026" when the email's date is unknown, in [zone] (IANA). */
fun reviewDate(record: ParsedRecord, zone: String): String {
    val at = instantOf(record) ?: return ""
    val date = at.toLocalDateTime(TimeZone.of(zone)).date.toString()
    return "${if (record.sentAt != null) "Sent" else "Read"} ${formatDayMonthYear(date)}"
}

/** What a record's outcome says, as the web's list says it. */
fun outcomeLabel(outcome: String): String = when (outcome) {
    "processing" -> "Processing"
    "filtered" -> "Skipped before reading"
    "not_booking" -> "Read, not a booking"
    "imported" -> "Imported"
    "failed" -> "Failed"
    "cancellation" -> "Cancellation"
    else -> outcome
}

/** How many records the review list shows, newest first, until a search reads them all. */
const val REVIEW_RECENT = 100

/** The most records a search reads, as on the web. */
const val REVIEW_SEARCH_CAP = 20_000

/** The parser's path for reading one message again. */
const val REIMPORT_PATH = "/gmail/reimport"
