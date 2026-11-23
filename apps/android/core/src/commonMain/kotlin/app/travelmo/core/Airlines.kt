package app.travelmo.core

// When airlines open online check-in, by IATA airline code, and the site a
// traveler checks in on, as packages/core/src/airlines.ts has them (keep the
// two the same). Only airlines whose window is well known and stable are
// listed; a wrong window is worse than the default. The site is the
// airline's home page: deep links to check-in forms move often.

data class AirlineCheckIn(val hours: Int, val site: String)

/** A day before departure: what most airlines do, and the answer for any airline not listed. */
const val DEFAULT_CHECK_IN_HOURS = 24

val airlineCheckIns: Map<String, AirlineCheckIn> = mapOf(
    // A day before departure, the common window.
    "AA" to AirlineCheckIn(24, "https://www.aa.com/"), // American Airlines
    "AC" to AirlineCheckIn(24, "https://www.aircanada.com/"), // Air Canada
    "AS" to AirlineCheckIn(24, "https://www.alaskaair.com/"), // Alaska Airlines
    "B6" to AirlineCheckIn(24, "https://www.jetblue.com/"), // JetBlue
    "BA" to AirlineCheckIn(24, "https://www.britishairways.com/"), // British Airways
    "DL" to AirlineCheckIn(24, "https://www.delta.com/"), // Delta Air Lines
    "QF" to AirlineCheckIn(24, "https://www.qantas.com/"), // Qantas
    "UA" to AirlineCheckIn(24, "https://www.united.com/"), // United Airlines
    "VA" to AirlineCheckIn(24, "https://www.virginaustralia.com/"), // Virgin Australia
    "WN" to AirlineCheckIn(24, "https://www.southwest.com/"), // Southwest Airlines
    // The Lufthansa Group's mainline carriers open an hour later than most.
    "LH" to AirlineCheckIn(23, "https://www.lufthansa.com/"), // Lufthansa
    "LX" to AirlineCheckIn(23, "https://www.swiss.com/"), // SWISS
    // Air France and KLM open 30 hours before.
    "AF" to AirlineCheckIn(30, "https://www.airfrance.com/"), // Air France
    "KL" to AirlineCheckIn(30, "https://www.klm.com/"), // KLM
    "AY" to AirlineCheckIn(36, "https://www.finnair.com/"), // Finnair
    // Two days before.
    "CX" to AirlineCheckIn(48, "https://www.cathaypacific.com/"), // Cathay Pacific
    "EK" to AirlineCheckIn(48, "https://www.emirates.com/"), // Emirates
    "SQ" to AirlineCheckIn(48, "https://www.singaporeair.com/"), // Singapore Airlines
    // 30 days before.
    "U2" to AirlineCheckIn(30 * 24, "https://www.easyjet.com/"), // easyJet
)

/** The airline's IATA code, from the flight number in the booking's title ("QF 1 SYD to LHR" → "QF"). */
fun airlineCode(segment: Segment): String? = flightDesignator(segment)?.take(2)

/** What the table says about the booking's airline, if it is listed. */
fun airlineCheckIn(segment: Segment): AirlineCheckIn? = airlineCode(segment)?.let { airlineCheckIns[it] }

/** How many hours before departure online check-in opens for the booking. */
fun checkInHoursBefore(segment: Segment): Int = airlineCheckIn(segment)?.hours ?: DEFAULT_CHECK_IN_HOURS
