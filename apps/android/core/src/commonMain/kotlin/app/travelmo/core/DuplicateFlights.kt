package app.travelmo.core

// Mirrors packages/core/src/duplicateFlights.ts.

/** How far apart the two days of one flight booked twice may be. */
const val DUPLICATE_FLIGHT_DAYS = 7

/** One flight booked on two days near each other, as duplicateFlights.ts's DuplicateFlight. */
data class DuplicateFlight(val first: Segment, val second: Segment)

/** The pair as the trip stores the owner's word that both were taken. */
fun duplicateFlightKey(a: Segment, b: Segment): String = listOf(a.id, b.id).sorted().joinToString("|")

private fun code(place: Place?) = place?.code?.trim()?.uppercase()

/**
 * The flights a trip seems to have booked twice, in order: still booked, the same flight number between the same
 * airports, on different days within [DUPLICATE_FLIGHT_DAYS], and not a pair the owner said both happened ([bothTaken],
 * by [duplicateFlightKey]). Each flight is in one pair at most.
 */
fun duplicateFlights(segments: List<Segment>, bothTaken: List<String> = emptyList()): List<DuplicateFlight> {
    val flights = liveSegments(segments)
        .filter { it.type == SegmentType.FLIGHT && code(it.origin) != null && code(it.destination) != null }
        .sortedBy { instantMillis(it.start) }
    val taken = bothTaken.toSet()
    val paired = mutableSetOf<String>()
    val out = mutableListOf<DuplicateFlight>()
    for (i in flights.indices) {
        for (j in i + 1 until flights.size) {
            val first = flights[i]
            val second = flights[j]
            if (first.id in paired || second.id in paired) continue
            val a = localDate(first.start)
            val b = localDate(second.start)
            if (a == b || daysBetween(a, b) > DUPLICATE_FLIGHT_DAYS) continue
            if (code(first.origin) != code(second.origin) || code(first.destination) != code(second.destination)) continue
            val number = flightDesignator(first)
            if (number == null || number != flightDesignator(second)) continue
            if (duplicateFlightKey(first, second) in taken) continue
            paired += first.id
            paired += second.id
            out += DuplicateFlight(first, second)
        }
    }
    return out
}

/** The flight as the notice names it: "EK 10 LGW to DXB". */
fun duplicateFlightName(flight: Segment): String = listOfNotNull(flightNumber(flight), "${code(flight.origin)} to ${code(flight.destination)}").joinToString(" ")

/** "EK 10 LGW to DXB is booked on 15 Dec and 17 Dec." */
fun duplicateFlightText(pair: DuplicateFlight): String =
    "${duplicateFlightName(pair.first)} is booked on ${dayMonth(localDate(pair.first.start))} and ${dayMonth(localDate(pair.second.start))}."

/** Its buttons: "Mark 15 Dec cancelled". */
fun duplicateFlightCancel(flight: Segment): String = "Mark ${dayMonth(localDate(flight.start))} cancelled"
