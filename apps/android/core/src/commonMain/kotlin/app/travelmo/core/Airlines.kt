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

/** Airlines by IATA code, as a booking's heading names them, as packages/core/src/airlines.ts has them (keep the two the same). */
val airlineNames: Map<String, String> = mapOf(
    "2K" to "Avianca Ecuador",
    "3K" to "Jetstar Asia",
    "3U" to "Sichuan Airlines",
    "4U" to "Germanwings",
    "5J" to "Cebu Pacific",
    "6E" to "IndiGo",
    "7C" to "Jeju Air",
    "8M" to "Myanmar Airways International",
    "9W" to "Jet Airways",
    "A3" to "Aegean Airlines",
    "AA" to "American Airlines",
    "AC" to "Air Canada",
    "AD" to "Azul",
    "AF" to "Air France",
    "AI" to "Air India",
    "AK" to "AirAsia",
    "AM" to "Aeroméxico",
    "AR" to "Aerolíneas Argentinas",
    "AS" to "Alaska Airlines",
    "AT" to "Royal Air Maroc",
    "AV" to "Avianca",
    "AY" to "Finnair",
    "AZ" to "ITA Airways",
    "B6" to "JetBlue",
    "BA" to "British Airways",
    "BI" to "Royal Brunei Airlines",
    "BR" to "EVA Air",
    "BT" to "airBaltic",
    "BW" to "Caribbean Airlines",
    "CA" to "Air China",
    "CI" to "China Airlines",
    "CM" to "Copa Airlines",
    "CX" to "Cathay Pacific",
    "CZ" to "China Southern Airlines",
    "D7" to "AirAsia X",
    "D8" to "Norwegian",
    "DE" to "Condor",
    "DL" to "Delta Air Lines",
    "DY" to "Norwegian",
    "EI" to "Aer Lingus",
    "EK" to "Emirates",
    "EN" to "Air Dolomiti",
    "ET" to "Ethiopian Airlines",
    "EW" to "Eurowings",
    "EY" to "Etihad Airways",
    "F9" to "Frontier Airlines",
    "FI" to "Icelandair",
    "FJ" to "Fiji Airways",
    "FR" to "Ryanair",
    "FZ" to "flydubai",
    "G3" to "GOL",
    "G4" to "Allegiant Air",
    "GA" to "Garuda Indonesia",
    "GF" to "Gulf Air",
    "HA" to "Hawaiian Airlines",
    "HU" to "Hainan Airlines",
    "HV" to "Transavia",
    "IB" to "Iberia",
    "IZ" to "Arkia",
    "JJ" to "LATAM Brasil",
    "JL" to "Japan Airlines",
    "JQ" to "Jetstar",
    "JU" to "Air Serbia",
    "KC" to "Air Astana",
    "KE" to "Korean Air",
    "KL" to "KLM",
    "KM" to "KM Malta Airlines",
    "KQ" to "Kenya Airways",
    "KU" to "Kuwait Airways",
    "LA" to "LATAM Airlines",
    "LG" to "Luxair",
    "LH" to "Lufthansa",
    "LO" to "LOT Polish Airlines",
    "LS" to "Jet2",
    "LX" to "SWISS",
    "LY" to "El Al",
    "MF" to "Xiamen Airlines",
    "MH" to "Malaysia Airlines",
    "MK" to "Air Mauritius",
    "MS" to "EgyptAir",
    "MU" to "China Eastern Airlines",
    "NH" to "ANA",
    "NK" to "Spirit Airlines",
    "NZ" to "Air New Zealand",
    "OA" to "Olympic Air",
    "OK" to "Czech Airlines",
    "OS" to "Austrian Airlines",
    "OU" to "Croatia Airlines",
    "OZ" to "Asiana Airlines",
    "PC" to "Pegasus Airlines",
    "PD" to "Porter Airlines",
    "PG" to "Bangkok Airways",
    "PK" to "Pakistan International Airlines",
    "PR" to "Philippine Airlines",
    "QF" to "Qantas",
    "QR" to "Qatar Airways",
    "RJ" to "Royal Jordanian",
    "RO" to "TAROM",
    "S7" to "S7 Airlines",
    "SA" to "South African Airways",
    "SK" to "SAS",
    "SN" to "Brussels Airlines",
    "SQ" to "Singapore Airlines",
    "SV" to "Saudia",
    "SY" to "Sun Country Airlines",
    "TG" to "Thai Airways",
    "TK" to "Turkish Airlines",
    "TO" to "Transavia France",
    "TP" to "TAP Air Portugal",
    "TR" to "Scoot",
    "TS" to "Air Transat",
    "U2" to "easyJet",
    "UA" to "United Airlines",
    "UK" to "Vistara",
    "UL" to "SriLankan Airlines",
    "UX" to "Air Europa",
    "V7" to "Volotea",
    "VA" to "Virgin Australia",
    "VJ" to "VietJet Air",
    "VN" to "Vietnam Airlines",
    "VS" to "Virgin Atlantic",
    "VY" to "Vueling",
    "W6" to "Wizz Air",
    "WN" to "Southwest Airlines",
    "WS" to "WestJet",
    "WY" to "Oman Air",
    "XQ" to "SunExpress",
    "XY" to "flynas",
    "ZH" to "Shenzhen Airlines",
)

private fun foldName(name: String): String = foldText(name)

/** The listed airline a booking's provider names, if exactly one, as airlines.ts: "Delta" is Delta Air Lines; "Virgin" is none. */
fun airlineNamed(provider: String?): Pair<String, String>? {
    val wanted = provider?.let(::foldName).orEmpty()
    if (wanted.isEmpty()) return null
    // One named in full first: "AirAsia X" is that, not also AirAsia.
    val found = airlineNames.entries.filter { foldName(it.value) == wanted }.ifEmpty {
        airlineNames.entries.filter { (_, name) ->
            val listed = foldName(name)
            listed.startsWith("$wanted ") || wanted.startsWith("$listed ")
        }
    }
    return if (found.map { it.value }.toSet().size == 1) found.first().let { it.key to it.value } else null
}

/** The flight number as a heading writes it ("VS 11"), from the booking's title. */
fun flightNumber(segment: Segment): String? = flightDesignator(segment)?.let { "${it.take(2)} ${it.drop(2)}" }

/** A booking as its row and page head it, as airlines.ts's bookingHeading. */
data class BookingHeading(val headline: String, val airline: String? = null, val flightNumber: String? = null)

fun bookingHeading(segment: Segment): BookingHeading {
    if (segment.type != SegmentType.FLIGHT) return BookingHeading(segment.title)
    val code = airlineCode(segment)
    val airline = airlineNamed(segment.provider) ?: code?.let { c -> airlineNames[c]?.let { c to it } }
        ?: return BookingHeading(segment.title)
    return BookingHeading(airline.second, airline.first, flightNumber(segment))
}

/** The route as a headed row gives it: the flight number first when the heading has one ("VS 11 · LHR London → BOS Boston"). */
fun headedRouteLine(segment: Segment, heading: BookingHeading = bookingHeading(segment)): String? =
    listOfNotNull(heading.flightNumber, routeLine(segment)).takeIf { it.isNotEmpty() }?.joinToString(" · ")
