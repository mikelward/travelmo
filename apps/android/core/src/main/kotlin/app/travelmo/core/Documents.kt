package app.travelmo.core

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

// Passports, visas and other travel documents in a travel profile, read for
// their expiry dates so a trip can warn of one that runs out too soon, as
// packages/core/src/documents.ts. Documents are recognized by their labels
// and dates by their usual spellings.

enum class DocumentKind { PASSPORT, VISA, OTHER }

data class TravelDocument(
    val title: String,
    val kind: DocumentKind,
    /** YYYY-MM-DD. */
    val expires: String,
    /** The country that issued it (a passport) or that it admits to (a visa). */
    val country: String? = null,
)

private val months = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

private fun validDate(y: Int, m: Int, d: Int): String? = try {
    LocalDate.of(y, m, d).toString()
} catch (e: java.time.DateTimeException) {
    null
}

private fun month(name: String): Int? = months.indexOf(name.take(3).lowercase()).takeIf { it >= 0 }?.plus(1)

/**
 * "2031-05-06", "2031-05-06T00:00:00Z", "6 May 2031", "May 6, 2031". Dates
 * written only in numbers with slashes are left alone: 06/05/2031 is a
 * different day in the US and in Europe, and a wrong warning is worse than none.
 */
fun parseDocumentDate(value: String): String? {
    val text = value.trim()
    Regex("""^(\d{4})-(\d{2})-(\d{2})(?:$|T)""").find(text)?.let { m ->
        return validDate(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt())
    }
    Regex("""^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$""").find(text)?.let { m ->
        val mo = month(m.groupValues[2]) ?: return null
        return validDate(m.groupValues[3].toInt(), mo, m.groupValues[1].toInt())
    }
    Regex("""^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$""").find(text)?.let { m ->
        val mo = month(m.groupValues[1]) ?: return null
        return validDate(m.groupValues[3].toInt(), mo, m.groupValues[2].toInt())
    }
    return null
}

private fun lastPart(label: String) = label.split(" › ").last().lowercase()
private fun isExpiry(label: String) = Regex("""expir|valid (until|to|through)|valid thru""").containsMatchIn(lastPart(label))
private fun isNationality(label: String) = Regex("""nationality|citizenship""").containsMatchIn(lastPart(label))
// A country of birth says nothing about which country a document is for.
private fun isCountry(label: String) = lastPart(label).contains("country") && !lastPart(label).contains("birth") && !isNationality(label)
private fun isType(label: String) = Regex("""^(document )?type$""").matches(lastPart(label))

// The country a document belongs to: for a passport, the one that issued it
// (its holder's nationality is the same); for a visa, the one it admits to,
// never its holder's nationality. Written as a code or as a name.
private fun countryOf(entry: ProfileEntry, kind: DocumentKind): String? {
    fun code(f: ProfileField) = countryCodeOf(f.value) ?: f.value.trim().uppercase()
    fun pick(test: (String) -> Boolean) = entry.fields.filter { test(it.label) }.map(::code).firstOrNull { Regex("^[A-Z]{2}$").matches(it) }
    return if (kind == DocumentKind.PASSPORT) pick(::isNationality) ?: pick(::isCountry) else pick(::isCountry)
}

private fun kindOf(entry: ProfileEntry): DocumentKind {
    val text = (listOf(entry.title) + entry.fields.filter { isType(it.label) }.map { it.value }).joinToString(" ").lowercase()
    return when {
        text.contains("passport") -> DocumentKind.PASSPORT
        text.contains("visa") -> DocumentKind.VISA
        else -> DocumentKind.OTHER
    }
}

/** Every document entry with an expiry date this can read. */
fun travelDocuments(entries: List<ProfileEntry>): List<TravelDocument> = entries.mapNotNull { entry ->
    val expires = entry.fields.filter { isExpiry(it.label) }.firstNotNullOfOrNull { parseDocumentDate(it.value) } ?: return@mapNotNull null
    val kind = kindOf(entry)
    TravelDocument(entry.title, kind, expires, countryOf(entry, kind))
}

/** Many countries want a passport valid for six months beyond the stay. */
const val PASSPORT_MARGIN_MONTHS = 6L

enum class WarningWhen { BEFORE, SOON }

data class DocumentWarning(val document: TravelDocument, val `when`: WarningWhen, val daysAfterTrip: Long)

fun daysBetween(start: String, end: String): Long = ChronoUnit.DAYS.between(LocalDate.parse(start), LocalDate.parse(end))

/**
 * The documents to warn about for a trip still to come or under way. A
 * passport is checked for the margin; a visa or other document only for
 * lasting the trip. A passport is not needed for a trip known to stay in the
 * country that issued it, nor a visa for a trip known not to go to its country.
 */
fun documentWarnings(documents: List<TravelDocument>, trip: Trip, today: String, places: TripPlaces? = null): List<DocumentWarning> {
    if (trip.end < today) return emptyList()
    val known = places?.takeIf { it.complete && it.countries.isNotEmpty() }?.countries
    return documents.mapNotNull { document ->
        if (document.country != null && known != null) {
            if (document.kind == DocumentKind.PASSPORT && known.all { it == document.country }) return@mapNotNull null
            if (document.kind == DocumentKind.VISA && document.country !in known) return@mapNotNull null
        }
        val daysAfterTrip = daysBetween(trip.end, document.expires)
        when {
            document.expires < trip.end -> DocumentWarning(document, WarningWhen.BEFORE, daysAfterTrip)
            document.kind == DocumentKind.PASSPORT && document.expires < LocalDate.parse(trip.end).plusMonths(PASSPORT_MARGIN_MONTHS).toString() ->
                DocumentWarning(document, WarningWhen.SOON, daysAfterTrip)
            else -> null
        }
    }
}

/** Whose documents they are: the viewer's own, or someone who shared their profile with the viewer. */
data class PersonDocuments(val uid: String, val email: String?, val own: Boolean, val documents: List<TravelDocument>)

fun peopleDocuments(own: TravelProfile?, shared: List<TravelProfile>, uid: String): List<PersonDocuments> {
    val people = mutableListOf<PersonDocuments>()
    if (own != null) people += PersonDocuments(uid, null, true, travelDocuments(own.documents))
    for (p in shared) {
        if (p.ownerUid == uid) continue
        people += PersonDocuments(p.ownerUid, p.ownerEmail, false, travelDocuments(p.documents))
    }
    return people.filter { it.documents.isNotEmpty() }
}

data class PersonWarning(val person: PersonDocuments, val warning: DocumentWarning)

/** Someone else's documents matter for a trip they are on; the viewer is on every trip they can see. */
fun onTrip(person: PersonDocuments, trip: Trip): Boolean =
    person.own || person.uid == trip.ownerUid || (person.email != null && trip.sharedWith.contains(person.email.lowercase()))

fun tripWarnings(people: List<PersonDocuments>, trip: Trip, segments: List<Segment>?, today: String, lookup: (String) -> AirportPlace? = ::airportPlace): List<PersonWarning> {
    val places = segments?.let { tripPlaces(it, lookup) }
    return people.filter { onTrip(it, trip) }.flatMap { person -> documentWarnings(person.documents, trip, today, places).map { PersonWarning(person, it) } }
}

private fun documentName(d: TravelDocument): String = when (d.kind) {
    DocumentKind.PASSPORT -> "passport"
    DocumentKind.VISA -> if (d.country != null) "${countryName(d.country)} visa" else "visa"
    DocumentKind.OTHER -> "“${d.title}”"
}

private fun longDate(date: String): String = LocalDate.parse(date).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.UK))

/**
 * The warning as the app words it: whose document, which, when it runs out,
 * and how that bears on the trip ("this trip" on the trip's own page, the
 * trip by name where several are listed). Never the number.
 */
fun warningText(w: PersonWarning, today: String, tripTitle: String? = null): String {
    val whose = if (w.person.own) "Your" else "${w.person.email ?: "A fellow traveler"}’s"
    val trip = tripTitle ?: "this trip"
    val d = w.warning.document
    val date = longDate(d.expires)
    if (w.warning.`when` == WarningWhen.BEFORE) {
        return if (d.expires < today) "$whose ${documentName(d)} expired on $date." else "$whose ${documentName(d)} expires on $date, before $trip ends."
    }
    val days = w.warning.daysAfterTrip
    val months = Math.floor(days / 30.44).toLong()
    val after = if (days < 31) "$days day${if (days == 1L) "" else "s"}" else "$months month${if (months == 1L) "" else "s"}"
    return "$whose ${documentName(d)} expires on $date, $after after $trip ends; many countries require six months’ validity."
}

data class ListWarning(val trip: Trip, val warning: PersonWarning)

/**
 * The warnings the trip list shows once, at its top, rather than on each
 * card: one line per person and document, for the earliest-ending trip it
 * bears on, which is the most pressing wording.
 */
fun listWarnings(byTrip: Map<String, List<PersonWarning>>, trips: List<Trip>): List<ListWarning> {
    val byKey = LinkedHashMap<String, ListWarning>()
    for (trip in trips.sortedWith(compareBy({ it.end }, { it.start }))) {
        for (warning in byTrip[trip.id].orEmpty()) {
            // Two of a traveler's visas can share a title and an expiry (TripIt's
            // import titles them by kind and holder), so the country tells them apart.
            val d = warning.warning.document
            val key = listOf(warning.person.uid, d.kind.name, d.country.orEmpty(), d.title, d.expires).joinToString("/")
            byKey.putIfAbsent(key, ListWarning(trip, warning))
        }
    }
    return byKey.values.toList()
}
