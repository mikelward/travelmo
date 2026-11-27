package app.travelmo.core

/**
 * The brands a booking's logo can name, as the traveler knows them, as packages/core/src/brands.ts has them (keep the
 * two the same): a hotel brand, not its group, pointing to its parent for a logo when it has none of its own; a
 * booking site ([site]) only when nothing else is named. [types] null is any kind of booking.
 */
data class Brand(val id: String, val name: String, val types: Set<SegmentType>?, val site: Boolean, val parent: String?, val aliases: List<String>)

val brands: List<Brand> = listOf(
    Brand("airbnb", "Airbnb", setOf(SegmentType.LODGING, SegmentType.ACTIVITY, SegmentType.OTHER), true, null, listOf("Airbnb")),
    Brand("vrbo", "Vrbo", setOf(SegmentType.LODGING), true, null, listOf("Vrbo", "HomeAway")),
    Brand("booking", "Booking.com", null, true, null, listOf("Booking.com")),
    Brand("expedia", "Expedia", null, true, null, listOf("Expedia")),
    Brand("hotelscom", "Hotels.com", setOf(SegmentType.LODGING), true, null, listOf("Hotels.com")),
    Brand("tripcom", "Trip.com", null, true, null, listOf("Trip.com")),
    Brand("agoda", "Agoda", null, true, null, listOf("Agoda")),
    Brand("hostelworld", "Hostelworld", setOf(SegmentType.LODGING), true, null, listOf("Hostelworld")),
    Brand("tripadvisor", "Tripadvisor", null, true, null, listOf("Tripadvisor", "Trip Advisor")),
    Brand("trivago", "trivago", setOf(SegmentType.LODGING), true, null, listOf("trivago")),
    Brand("hilton", "Hilton", setOf(SegmentType.LODGING), false, null, listOf("Hilton", "Hilton Hotels & Resorts")),
    Brand("hampton", "Hampton by Hilton", setOf(SegmentType.LODGING), false, "hilton", listOf("Hampton Inn", "Hampton by Hilton")),
    Brand("doubletree", "DoubleTree by Hilton", setOf(SegmentType.LODGING), false, "hilton", listOf("DoubleTree")),
    Brand("embassysuites", "Embassy Suites", setOf(SegmentType.LODGING), false, "hilton", listOf("Embassy Suites")),
    Brand("conrad", "Conrad", setOf(SegmentType.LODGING), false, "hilton", listOf("Conrad Hotels", "Conrad")),
    Brand("waldorfastoria", "Waldorf Astoria", setOf(SegmentType.LODGING), false, "hilton", listOf("Waldorf Astoria")),
    Brand("curio", "Curio Collection", setOf(SegmentType.LODGING), false, "hilton", listOf("Curio Collection")),
    Brand("canopy", "Canopy by Hilton", setOf(SegmentType.LODGING), false, "hilton", listOf("Canopy by Hilton")),
    Brand("homewoodsuites", "Homewood Suites", setOf(SegmentType.LODGING), false, "hilton", listOf("Homewood Suites")),
    Brand("home2suites", "Home2 Suites", setOf(SegmentType.LODGING), false, "hilton", listOf("Home2 Suites")),
    Brand("tru", "Tru by Hilton", setOf(SegmentType.LODGING), false, "hilton", listOf("Tru by Hilton")),
    Brand("tapestry", "Tapestry Collection", setOf(SegmentType.LODGING), false, "hilton", listOf("Tapestry Collection")),
    Brand("motto", "Motto by Hilton", setOf(SegmentType.LODGING), false, "hilton", listOf("Motto by Hilton")),
    Brand("spark", "Spark by Hilton", setOf(SegmentType.LODGING), false, "hilton", listOf("Spark by Hilton")),
    Brand("tempo", "Tempo by Hilton", setOf(SegmentType.LODGING), false, "hilton", listOf("Tempo by Hilton")),
    Brand("signia", "Signia by Hilton", setOf(SegmentType.LODGING), false, "hilton", listOf("Signia by Hilton")),
    Brand("lxr", "LXR Hotels", setOf(SegmentType.LODGING), false, "hilton", listOf("LXR Hotels")),
    Brand("marriott", "Marriott", setOf(SegmentType.LODGING), false, null, listOf("Marriott", "JW Marriott")),
    Brand("ritzcarlton", "The Ritz-Carlton", setOf(SegmentType.LODGING), false, "marriott", listOf("Ritz-Carlton", "Ritz Carlton")),
    Brand("courtyard", "Courtyard by Marriott", setOf(SegmentType.LODGING), false, "marriott", listOf("Courtyard")),
    Brand("sheraton", "Sheraton", setOf(SegmentType.LODGING), false, "marriott", listOf("Sheraton")),
    Brand("westin", "Westin", setOf(SegmentType.LODGING), false, "marriott", listOf("Westin")),
    Brand("whotels", "W Hotels", setOf(SegmentType.LODGING), false, "marriott", listOf("W Hotels")),
    Brand("stregis", "St. Regis", setOf(SegmentType.LODGING), false, "marriott", listOf("St. Regis", "St Regis")),
    Brand("renaissance", "Renaissance Hotels", setOf(SegmentType.LODGING), false, "marriott", listOf("Renaissance Hotel", "Renaissance Hotels")),
    Brand("lemeridien", "Le Méridien", setOf(SegmentType.LODGING), false, "marriott", listOf("Le Méridien", "Le Meridien")),
    Brand("aloft", "Aloft", setOf(SegmentType.LODGING), false, "marriott", listOf("Aloft")),
    Brand("moxy", "Moxy", setOf(SegmentType.LODGING), false, "marriott", listOf("Moxy")),
    Brand("fairfield", "Fairfield by Marriott", setOf(SegmentType.LODGING), false, "marriott", listOf("Fairfield Inn", "Fairfield by Marriott")),
    Brand("residenceinn", "Residence Inn", setOf(SegmentType.LODGING), false, "marriott", listOf("Residence Inn")),
    Brand("springhill", "SpringHill Suites", setOf(SegmentType.LODGING), false, "marriott", listOf("SpringHill Suites")),
    Brand("autograph", "Autograph Collection", setOf(SegmentType.LODGING), false, "marriott", listOf("Autograph Collection")),
    Brand("fourpoints", "Four Points", setOf(SegmentType.LODGING), false, "marriott", listOf("Four Points")),
    Brand("achotels", "AC Hotels", setOf(SegmentType.LODGING), false, "marriott", listOf("AC Hotel", "AC Hotels")),
    Brand("towneplace", "TownePlace Suites", setOf(SegmentType.LODGING), false, "marriott", listOf("TownePlace Suites")),
    Brand("gaylord", "Gaylord Hotels", setOf(SegmentType.LODGING), false, "marriott", listOf("Gaylord")),
    Brand("deltahotels", "Delta Hotels", setOf(SegmentType.LODGING), false, "marriott", listOf("Delta Hotels")),
    Brand("luxurycollection", "The Luxury Collection", setOf(SegmentType.LODGING), false, "marriott", listOf("Luxury Collection")),
    Brand("element", "Element", setOf(SegmentType.LODGING), false, "marriott", listOf("Element by Westin", "Element Hotel")),
    Brand("ihg", "IHG", setOf(SegmentType.LODGING), false, null, listOf("IHG", "IHG Hotels & Resorts")),
    Brand("holidayinnexpress", "Holiday Inn Express", setOf(SegmentType.LODGING), false, "ihg", listOf("Holiday Inn Express")),
    Brand("holidayinn", "Holiday Inn", setOf(SegmentType.LODGING), false, "ihg", listOf("Holiday Inn")),
    Brand("crowneplaza", "Crowne Plaza", setOf(SegmentType.LODGING), false, "ihg", listOf("Crowne Plaza")),
    Brand("intercontinental", "InterContinental", setOf(SegmentType.LODGING), false, "ihg", listOf("InterContinental")),
    Brand("kimpton", "Kimpton", setOf(SegmentType.LODGING), false, "ihg", listOf("Kimpton")),
    Brand("hotelindigo", "Hotel Indigo", setOf(SegmentType.LODGING), false, "ihg", listOf("Hotel Indigo")),
    Brand("staybridge", "Staybridge Suites", setOf(SegmentType.LODGING), false, "ihg", listOf("Staybridge Suites")),
    Brand("candlewood", "Candlewood Suites", setOf(SegmentType.LODGING), false, "ihg", listOf("Candlewood Suites")),
    Brand("voco", "voco", setOf(SegmentType.LODGING), false, "ihg", listOf("voco")),
    Brand("even", "EVEN Hotels", setOf(SegmentType.LODGING), false, "ihg", listOf("EVEN Hotels")),
    Brand("avid", "avid hotels", setOf(SegmentType.LODGING), false, "ihg", listOf("avid hotels")),
    Brand("regent", "Regent", setOf(SegmentType.LODGING), false, "ihg", listOf("Regent Hotels")),
    Brand("wyndham", "Wyndham", setOf(SegmentType.LODGING), false, null, listOf("Wyndham")),
    Brand("ramada", "Ramada", setOf(SegmentType.LODGING), false, "wyndham", listOf("Ramada")),
    Brand("daysinn", "Days Inn", setOf(SegmentType.LODGING), false, "wyndham", listOf("Days Inn")),
    Brand("super8", "Super 8", setOf(SegmentType.LODGING), false, "wyndham", listOf("Super 8")),
    Brand("laquinta", "La Quinta", setOf(SegmentType.LODGING), false, "wyndham", listOf("La Quinta")),
    Brand("microtel", "Microtel", setOf(SegmentType.LODGING), false, "wyndham", listOf("Microtel")),
    Brand("wingate", "Wingate", setOf(SegmentType.LODGING), false, "wyndham", listOf("Wingate")),
    Brand("baymont", "Baymont", setOf(SegmentType.LODGING), false, "wyndham", listOf("Baymont")),
    Brand("howardjohnson", "Howard Johnson", setOf(SegmentType.LODGING), false, "wyndham", listOf("Howard Johnson")),
    Brand("hawthorn", "Hawthorn Suites", setOf(SegmentType.LODGING), false, "wyndham", listOf("Hawthorn Suites")),
    Brand("trademark", "Trademark Collection", setOf(SegmentType.LODGING), false, "wyndham", listOf("Trademark Collection")),
    Brand("radisson", "Radisson", setOf(SegmentType.LODGING), false, null, listOf("Radisson", "Radisson Blu", "Radisson RED")),
    Brand("parkinn", "Park Inn by Radisson", setOf(SegmentType.LODGING), false, "radisson", listOf("Park Inn by Radisson", "Park Inn")),
    Brand("parkplaza", "Park Plaza", setOf(SegmentType.LODGING), false, "radisson", listOf("Park Plaza")),
    Brand("countryinn", "Country Inn & Suites", setOf(SegmentType.LODGING), false, "radisson", listOf("Country Inn & Suites", "Country Inn and Suites")),
    Brand("accor", "Accor", setOf(SegmentType.LODGING), false, null, listOf("Accor", "ALL Accor")),
    Brand("novotel", "Novotel", setOf(SegmentType.LODGING), false, "accor", listOf("Novotel")),
    Brand("ibis", "ibis", setOf(SegmentType.LODGING), false, "accor", listOf("ibis")),
    Brand("mercure", "Mercure", setOf(SegmentType.LODGING), false, "accor", listOf("Mercure")),
    Brand("sofitel", "Sofitel", setOf(SegmentType.LODGING), false, "accor", listOf("Sofitel")),
    Brand("pullman", "Pullman", setOf(SegmentType.LODGING), false, "accor", listOf("Pullman")),
    Brand("swissotel", "Swissôtel", setOf(SegmentType.LODGING), false, "accor", listOf("Swissôtel", "Swissotel")),
    Brand("movenpick", "Mövenpick", setOf(SegmentType.LODGING), false, "accor", listOf("Mövenpick", "Movenpick")),
    Brand("fairmont", "Fairmont", setOf(SegmentType.LODGING), false, "accor", listOf("Fairmont")),
    Brand("raffles", "Raffles", setOf(SegmentType.LODGING), false, "accor", listOf("Raffles")),
    Brand("adagio", "Adagio", setOf(SegmentType.LODGING), false, "accor", listOf("Adagio")),
    Brand("mgallery", "MGallery", setOf(SegmentType.LODGING), false, "accor", listOf("MGallery")),
    Brand("25hours", "25hours Hotels", setOf(SegmentType.LODGING), false, "accor", listOf("25hours")),
    Brand("sixt", "SIXT", setOf(SegmentType.CAR_RENTAL), false, null, listOf("Sixt")),
    Brand("enterprise", "Enterprise", setOf(SegmentType.CAR_RENTAL), false, null, listOf("Enterprise", "Enterprise Rent-A-Car")),
    Brand("turo", "Turo", setOf(SegmentType.CAR_RENTAL), false, null, listOf("Turo")),
    Brand("zipcar", "Zipcar", setOf(SegmentType.CAR_RENTAL), false, null, listOf("Zipcar")),
    Brand("uber", "Uber", setOf(SegmentType.CAR_RENTAL, SegmentType.OTHER), false, null, listOf("Uber")),
    Brand("lyft", "Lyft", setOf(SegmentType.CAR_RENTAL, SegmentType.OTHER), false, null, listOf("Lyft")),
    Brand("bolt", "Bolt", setOf(SegmentType.CAR_RENTAL, SegmentType.OTHER), false, null, listOf("Bolt")),
    Brand("grab", "Grab", setOf(SegmentType.CAR_RENTAL, SegmentType.OTHER), false, null, listOf("Grab")),
    Brand("cabify", "Cabify", setOf(SegmentType.CAR_RENTAL, SegmentType.OTHER), false, null, listOf("Cabify")),
    Brand("eurostar", "Eurostar", setOf(SegmentType.TRAIN), false, null, listOf("Eurostar")),
    Brand("trainline", "Trainline", setOf(SegmentType.TRAIN, SegmentType.BUS), true, null, listOf("Trainline")),
    Brand("amtrak", "Amtrak", setOf(SegmentType.TRAIN), false, null, listOf("Amtrak")),
    Brand("deutschebahn", "Deutsche Bahn", setOf(SegmentType.TRAIN, SegmentType.BUS), false, null, listOf("Deutsche Bahn", "DB Fernverkehr", "DB Bahn")),
    Brand("sncf", "SNCF", setOf(SegmentType.TRAIN, SegmentType.BUS), false, null, listOf("SNCF", "TGV INOUI")),
    Brand("ouigo", "OUIGO", setOf(SegmentType.TRAIN), false, null, listOf("Ouigo")),
    Brand("obb", "ÖBB", setOf(SegmentType.TRAIN, SegmentType.BUS), false, null, listOf("ÖBB", "OEBB", "Nightjet")),
    Brand("sbb", "SBB", setOf(SegmentType.TRAIN), false, null, listOf("SBB", "SBB CFF FFS")),
    Brand("renfe", "Renfe", setOf(SegmentType.TRAIN), false, null, listOf("Renfe")),
    Brand("trenitalia", "Trenitalia", setOf(SegmentType.TRAIN), false, null, listOf("Trenitalia")),
    Brand("italo", "Italo", setOf(SegmentType.TRAIN), false, null, listOf("Italo", "Italo Treno")),
    Brand("nationalrail", "National Rail", setOf(SegmentType.TRAIN), false, null, listOf("National Rail")),
    Brand("lner", "LNER", setOf(SegmentType.TRAIN), false, null, listOf("LNER")),
    Brand("avanti", "Avanti West Coast", setOf(SegmentType.TRAIN), false, null, listOf("Avanti West Coast")),
    Brand("flixbus", "FlixBus", setOf(SegmentType.BUS, SegmentType.TRAIN), false, null, listOf("FlixBus", "Flix", "FlixTrain")),
    Brand("opentable", "OpenTable", setOf(SegmentType.ACTIVITY, SegmentType.OTHER), true, null, listOf("OpenTable")),
    Brand("getyourguide", "GetYourGuide", setOf(SegmentType.ACTIVITY, SegmentType.OTHER), true, null, listOf("GetYourGuide")),
    Brand("klook", "Klook", setOf(SegmentType.ACTIVITY, SegmentType.OTHER), true, null, listOf("Klook")),
    Brand("eventbrite", "Eventbrite", setOf(SegmentType.ACTIVITY, SegmentType.OTHER), true, null, listOf("Eventbrite")),
    Brand("ticketmaster", "Ticketmaster", setOf(SegmentType.ACTIVITY, SegmentType.OTHER), true, null, listOf("Ticketmaster")),
    Brand("seatgeek", "SeatGeek", setOf(SegmentType.ACTIVITY, SegmentType.OTHER), true, null, listOf("SeatGeek")),
    Brand("stubhub", "StubHub", setOf(SegmentType.ACTIVITY, SegmentType.OTHER), true, null, listOf("StubHub")),
    Brand("disneyland", "Disney Parks", setOf(SegmentType.ACTIVITY, SegmentType.LODGING, SegmentType.OTHER), false, null, listOf("Disneyland", "Walt Disney World", "Disney World", "Disneyland Paris")),
    Brand("universal", "Universal Studios", setOf(SegmentType.ACTIVITY, SegmentType.LODGING, SegmentType.OTHER), false, null, listOf("Universal Studios", "Universal Orlando")),
)

private val nonAlnum = Regex("[^a-z0-9]+")

private fun fold(text: String): String = " " + foldText(text).replace(nonAlnum, " ").trim() + " "

/** The brand a booking names, as brands.ts's bookingBrand: the longest alias its title or provider says, a booking site only when no other. */
fun bookingBrand(segment: Segment): Brand? {
    val text = listOf(segment.title, segment.provider.orEmpty()).map(::fold)
    for (site in listOf(false, true)) {
        var best: Brand? = null
        var length = 0
        for (brand in brands) {
            if (brand.site != site || (brand.types != null && segment.type !in brand.types)) continue
            for (alias in brand.aliases) {
                val wanted = fold(alias)
                if (wanted.isNotBlank() && text.any { it.contains(wanted) } && wanted.length > length) {
                    best = brand
                    length = wanted.length
                }
            }
        }
        if (best != null) return best
    }
    return null
}

/** The brands whose logo a booking can show, its own first, then its parent's. */
fun brandLogoIds(segment: Segment): List<String> = bookingBrand(segment)?.let { listOfNotNull(it.id, it.parent) }.orEmpty()
