package app.travelmo.ui

import kotlin.time.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.toLocalDateTime

// Material's date picker holds a day as the milliseconds of its midnight in
// UTC, whatever the phone's zone; the app holds it as "YYYY-MM-DD".

/** "2026-12-12" as the date picker holds it. */
fun pickerMillis(date: String): Long = LocalDate.parse(date).atStartOfDayIn(TimeZone.UTC).toEpochMilliseconds()

/** The "YYYY-MM-DD" a date picker's selection stands for. */
fun pickerDate(millis: Long): String = Instant.fromEpochMilliseconds(millis).toLocalDateTime(TimeZone.UTC).date.toString()
