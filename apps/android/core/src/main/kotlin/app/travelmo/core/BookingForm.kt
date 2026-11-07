package app.travelmo.core

import java.util.IllformedLocaleException
import java.util.Locale

// The booking form's fields and what they become, as the web's
// apps/web/src/components/SegmentForm.tsx: the form edits these strings, and
// [toDraft] turns them into a booking or says what is wrong.

data class BookingFields(
    val type: SegmentType = SegmentType.FLIGHT,
    val title: String = "",
    val provider: String = "",
    val confirmation: String = "",
    val startDate: String = "",
    val startTime: String = "09:00",
    val startZone: String = "UTC",
    val endDate: String = "",
    val endTime: String = "",
    val endZone: String = "UTC",
    val originName: String = "",
    val originCode: String = "",
    val destinationName: String = "",
    val destinationCode: String = "",
    /** ISO codes, "" for none; not shown for a flight, whose airport says. */
    val originCountry: String = "",
    val destinationCountry: String = "",
    val notes: String = "",
) {
    val transport: Boolean get() = type != SegmentType.LODGING && type != SegmentType.ACTIVITY
}

/** The fields for a new booking on [defaultDate], or for [segment] as stored. */
fun initialFields(segment: Segment?, defaultDate: String, here: String = localTimeZone()): BookingFields {
    val start = segment?.let { splitInstant(it.start) }
    val end = segment?.end?.let { splitInstant(it) }
    val startZone = start?.let { zoneForOffset(it.offset, it.date, it.time, here) } ?: here
    val endPreferred = if (startZone.startsWith(FIXED_OFFSET_PREFIX)) here else startZone
    return BookingFields(
        type = segment?.type ?: SegmentType.FLIGHT,
        title = segment?.title.orEmpty(),
        provider = segment?.provider.orEmpty(),
        confirmation = segment?.confirmation.orEmpty(),
        startDate = start?.date ?: defaultDate,
        startTime = start?.time ?: "09:00",
        startZone = startZone,
        endDate = end?.date.orEmpty(),
        endTime = end?.time.orEmpty(),
        endZone = end?.let { zoneForOffset(it.offset, it.date, it.time, endPreferred) } ?: startZone,
        originName = segment?.origin?.name.orEmpty(),
        originCode = segment?.origin?.code.orEmpty(),
        destinationName = segment?.destination?.name.orEmpty(),
        destinationCode = segment?.destination?.code.orEmpty(),
        originCountry = segment?.origin?.country.orEmpty(),
        destinationCountry = segment?.destination?.country.orEmpty(),
        notes = segment?.notes.orEmpty(),
    )
}

/** What the form decided for one end: the name, code and country; the rest of the stored place is kept while the name holds. */
data class PlaceDraft(val name: String, val code: String?, val country: String?)

/** A booking as the form hands it over; what it does not edit stays as stored. */
data class SegmentDraft(
    val type: SegmentType,
    val title: String,
    val provider: String?,
    val confirmation: String?,
    val start: String,
    val end: String?,
    val origin: PlaceDraft?,
    val destination: PlaceDraft?,
    val notes: String?,
)

class BookingFormException(message: String) : Exception(message)

private fun text(value: String): String? = value.trim().takeIf { it.isNotEmpty() }

/**
 * The country the form hands over for a place: what its picker shows, except
 * for a flight, which shows none (its airport code says) and so keeps the
 * booking's country.
 */
fun formCountry(type: SegmentType, country: String, existing: Place?): String? =
    if (type == SegmentType.FLIGHT) existing?.country else text(country)?.uppercase()

/** A place as the form leaves it: a country chosen without a name still names the place, by the country. */
fun formPlace(type: SegmentType, existing: Place?, name: String, code: String, country: String): PlaceDraft? {
    val chosen = formCountry(type, country, existing)
    val named = text(name) ?: chosen?.let { countryName(it) } ?: return null
    return PlaceDraft(named, text(code)?.uppercase(), chosen)
}

/** The booking the fields describe, or a [BookingFormException] saying what is wrong. */
fun toDraft(f: BookingFields, existing: Segment?): SegmentDraft {
    val title = f.title.trim()
    if (title.isEmpty()) throw BookingFormException("Title is required")
    if (title.length > 200) throw BookingFormException("Title is too long")
    if (f.startDate.isEmpty()) throw BookingFormException("Start date is required")
    val hasEnd = f.endDate.isNotEmpty() || f.endTime.isNotEmpty()
    val startTime = f.startTime.ifEmpty { "00:00" }
    val endDate = f.endDate.ifEmpty { f.startDate }
    val endTime = f.endTime.ifEmpty { startTime }
    val start = try {
        composeInstant(f.startDate, startTime, resolveOffset(f.startZone, f.startDate, startTime))
    } catch (e: RuntimeException) {
        throw BookingFormException("Start is not a date and time")
    }
    val end = if (!hasEnd) null else try {
        composeInstant(endDate, endTime, resolveOffset(f.endZone.ifEmpty { f.startZone }, endDate, endTime))
    } catch (e: RuntimeException) {
        throw BookingFormException("End is not a date and time")
    }
    if (end != null && compareInstants(end, start) < 0) throw BookingFormException("End must not be before start")
    return SegmentDraft(
        type = f.type,
        title = title,
        provider = text(f.provider),
        confirmation = text(f.confirmation),
        start = start,
        end = end,
        origin = if (f.transport) formPlace(f.type, existing?.origin, f.originName, f.originCode, f.originCountry) else null,
        destination = formPlace(f.type, existing?.destination, f.destinationName, f.destinationCode, f.destinationCountry),
        notes = text(f.notes),
    )
}

/**
 * "GB" as "United Kingdom", in the device's language; a code the platform
 * does not know, or cannot even parse, reads as itself. Built rather than
 * `Locale.of`, which Android gained only at API 36 and the app runs from 34.
 */
fun countryName(code: String): String = try {
    Locale.Builder().setRegion(code).build().getDisplayCountry(Locale.getDefault()).ifEmpty { code }
} catch (e: IllformedLocaleException) {
    code
}

/** The countries a picker offers, by name. */
fun countryChoices(): List<Pair<String, String>> = Locale.getISOCountries().map { it to countryName(it) }.sortedBy { it.second }
