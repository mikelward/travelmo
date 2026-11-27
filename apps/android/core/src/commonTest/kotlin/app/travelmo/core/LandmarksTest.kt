package app.travelmo.core

import kotlin.test.Test
import kotlin.test.assertEquals

class LandmarksTest {
    @Test
    fun findsTheCityATitleNames() {
        assertEquals("boston", tripLandmark("Boston").id)
        assertEquals("las-vegas", tripLandmark("Las Vegas").id)
        assertEquals("las-vegas", tripLandmark("Vegas, baby").id)
        assertEquals("paris", tripLandmark("Weekend in Paris").id)
        assertEquals("sydney", tripLandmark("Sydney").id)
        assertEquals("dubai", tripLandmark("Dubai stopover").id)
        assertEquals("singapore", tripLandmark("Singapore").id)
        assertEquals("barcelona", tripLandmark("Barcelona").id)
        assertEquals("new-york", tripLandmark("NYC weekend").id)
        assertEquals("san-francisco", tripLandmark("San Francisco").id)
        assertEquals("tokyo", tripLandmark("Tokyo").id)
        assertEquals("pisa", tripLandmark("Pisa").id)
        assertEquals("shanghai", tripLandmark("Shanghai").id)
        assertEquals("philadelphia", tripLandmark("Philly").id)
        assertEquals("ho-chi-minh-city", tripLandmark("Saigon").id)
        assertEquals("cusco", tripLandmark("Machu Picchu").id)
        assertEquals("amman", tripLandmark("Petra").id)
        assertEquals("bath", tripLandmark("Bath").id)
        assertEquals("oxford", tripLandmark("Oxford").id)
        assertEquals("siem-reap", tripLandmark("Angkor Wat").id)
        assertEquals("bali", tripLandmark("Bali").id)
        assertEquals("queenstown", tripLandmark("Queenstown").id)
        assertEquals("galway", tripLandmark("Galway").id)
        assertEquals("inverness", tripLandmark("Loch Ness").id)
        assertEquals("yogyakarta", tripLandmark("Borobudur").id)
        assertEquals("riyadh", tripLandmark("Riyadh").id)
        assertEquals("wellington", tripLandmark("Wellington").id)
        assertEquals("zagreb", tripLandmark("Zagreb").id)
        assertEquals("adelaide", tripLandmark("Adelaide").id)
        assertEquals("park-city", tripLandmark("Park City").id)
        assertEquals("bergen", tripLandmark("Bergen").id)
        assertEquals("tenerife", tripLandmark("Tenerife").id)
        assertEquals("winchester", tripLandmark("Winchester").id)
        assertEquals("chelmsford", tripLandmark("Chelmsford").id)
        assertEquals("sacramento", tripLandmark("Sacramento").id)
        assertEquals("hurghada", tripLandmark("Hurghada").id)
        assertEquals("heraklion", tripLandmark("Heraklion").id)
        assertEquals("valletta", tripLandmark("Valetta").id)
        assertEquals("valletta", tripLandmark("Malta").id)
        assertEquals("carmel", tripLandmark("Carmel").id)
        assertEquals("ravenna", tripLandmark("Ravenna").id)
        assertEquals("split", tripLandmark("Split").id)
        assertEquals("lake-tahoe", tripLandmark("Lake Tahoe").id)
        assertEquals("kahului", tripLandmark("Kahului").id)
        assertEquals("honolulu", tripLandmark("Waikiki").id)
        assertEquals("nadi", tripLandmark("Nadi").id)
        assertEquals("suva", tripLandmark("Suva").id)
        assertEquals("beach", tripLandmark("Kihei").id)
        assertEquals("beach", tripLandmark("Lahaina").id)
        assertEquals("beach", tripLandmark("Bora Bora").id)
        assertEquals("beach", tripLandmark("Santa Cruz").id)
        assertEquals("tenerife", tripLandmark("Santa Cruz de Tenerife").id)
        assertEquals("salt-lake-city", tripLandmark("Salt Lake City").id)
        assertEquals("santa-fe", tripLandmark("Santa Fe").id)
        assertEquals("pittsburgh", tripLandmark("Pittsburgh").id)
        assertEquals("memphis", tripLandmark("Memphis").id)
        assertEquals("halifax", tripLandmark("Halifax").id)
        assertEquals("victoria", tripLandmark("Victoria, BC").id)
        assertEquals("oaxaca", tripLandmark("Oaxaca").id)
        assertEquals("guadalajara", tripLandmark("Guadalajara").id)
        assertEquals("mont-saint-michel", tripLandmark("Mont Saint-Michel").id)
        assertEquals("santiago-de-compostela", tripLandmark("Santiago de Compostela").id)
        assertEquals("heidelberg", tripLandmark("Heidelberg").id)
        assertEquals("innsbruck", tripLandmark("Innsbruck").id)
        assertEquals("utrecht", tripLandmark("Utrecht").id)
        assertEquals("newcastle", tripLandmark("Newcastle").id)
        assertEquals("thessaloniki", tripLandmark("Thessaloniki").id)
        assertEquals("bucharest", tripLandmark("Bucharest").id)
        assertEquals("belgrade", tripLandmark("Belgrade").id)
        assertEquals("xian", tripLandmark("Xi'an").id)
        assertEquals("chengdu", tripLandmark("Chengdu").id)
        assertEquals("hangzhou", tripLandmark("Hangzhou").id)
        assertEquals("nara", tripLandmark("Nara").id)
        assertEquals("kolkata", tripLandmark("Kolkata").id)
        assertEquals("hyderabad", tripLandmark("Hyderabad").id)
        assertEquals("amritsar", tripLandmark("Amritsar").id)
        assertEquals("udaipur", tripLandmark("Udaipur").id)
        assertEquals("samarkand", tripLandmark("Samarkand").id)
        assertEquals("tbilisi", tripLandmark("Tbilisi").id)
        assertEquals("baku", tripLandmark("Baku").id)
        assertEquals("hobart", tripLandmark("Hobart").id)
        assertEquals("christchurch", tripLandmark("Christchurch").id)
        assertEquals("fez", tripLandmark("Fez").id)
        assertEquals("quito", tripLandmark("Quito").id)
        assertEquals("montevideo", tripLandmark("Montevideo").id)
        assertEquals("makarska", tripLandmark("Makarska").id)
        assertEquals("makarska", tripLandmark("Makarska Riviera").id)
        assertEquals("makarska", tripLandmark("Biokovo").id)
        assertEquals("johannesburg", tripLandmark("Johannesburg").id)
        assertEquals("johannesburg", tripLandmark("Joburg").id)
        assertEquals("graz", tripLandmark("Graz").id)
        assertEquals("san-jose", tripLandmark("San Jose").id)
        assertEquals("san-jose", tripLandmark("Silicon Valley").id)
        assertEquals("beach", tripLandmark("San Jose del Cabo").id)
        assertEquals("trip", tripLandmark("San Jose, Costa Rica").id)
        assertEquals("oakland", tripLandmark("Oakland").id)
        assertEquals("leipzig", tripLandmark("Leipzig").id)
        assertEquals("lausanne", tripLandmark("Lausanne").id)
        assertEquals("osijek", tripLandmark("Osijek").id)
        assertEquals("marseille", tripLandmark("Marseilles").id)
        assertEquals("gold-coast", tripLandmark("Gold Coast").id)
        assertEquals("gold-coast", tripLandmark("Surfers Paradise").id)
        assertEquals("gold-coast", tripLandmark("Surfer's Paradise").id)
        assertEquals("uluru", tripLandmark("Uluru").id)
        assertEquals("uluru", tripLandmark("Ayers Rock").id)
        assertEquals("uluru", tripLandmark("Alice Springs").id)
        assertEquals("uluru", tripLandmark("Yulara").id)
        assertEquals("mackay", tripLandmark("Mackay").id)
        assertEquals("townsville", tripLandmark("Townsville").id)
        assertEquals("darwin", tripLandmark("Darwin").id)
        assertEquals("cairns", tripLandmark("Cairns").id)
        assertEquals("byron-bay", tripLandmark("Byron Bay").id)
        assertEquals("rotorua", tripLandmark("Rotorua").id)
        assertEquals("dunedin", tripLandmark("Dunedin").id)
        assertEquals("launceston", tripLandmark("Launceston").id)
        assertEquals("bali", tripLandmark("Kuta").id)
        assertEquals("bali", tripLandmark("Seminyak").id)
        assertEquals("bali", tripLandmark("Canggu").id)
        assertEquals("bali", tripLandmark("Nusa Dua").id)
        assertEquals("bali", tripLandmark("Jimbaran").id)
        assertEquals("bali", tripLandmark("Sanur").id)
    }

    @Test
    fun ignoresAccentsAndCase() {
        assertEquals("lisbon", tripLandmark("LISBOA").id)
        assertEquals("edinburgh", tripLandmark("Édinburgh").id)
        assertEquals("munich", tripLandmark("München").id)
        assertEquals("reykjavik", tripLandmark("Reykjavík").id)
        assertEquals("mexico-city", tripLandmark("Ciudad de México").id)
        assertEquals("rome", tripLandmark("Roma").id)
        assertEquals("geneva", tripLandmark("Genève").id)
        assertEquals("copenhagen", tripLandmark("København").id)
        assertEquals("krakow", tripLandmark("Kraków").id)
        assertEquals("cologne", tripLandmark("Köln").id)
        assertEquals("quebec-city", tripLandmark("Québec").id)
        assertEquals("cancun", tripLandmark("Chichén Itzá").id)
        assertEquals("sao-paulo", tripLandmark("São Paulo").id)
        assertEquals("bogota", tripLandmark("Bogotá").id)
        assertEquals("turin", tripLandmark("Torino").id)
        assertEquals("cordoba", tripLandmark("Córdoba").id)
        assertEquals("gdansk", tripLandmark("Gdańsk").id)
        assertEquals("tromso", tripLandmark("Tromsø").id)
        assertEquals("malmo", tripLandmark("Malmö").id)
        assertEquals("medellin", tripLandmark("Medellín").id)
    }

    @Test
    fun takesTheCityNamedFirst() {
        assertEquals("dublin", tripLandmark("Dublin and Liverpool").id)
        assertEquals("liverpool", tripLandmark("Liverpool and Dublin").id)
        assertEquals("sydney", tripLandmark("Sydney via Singapore").id)
    }

    @Test
    fun matchesWholeWordsOnly() {
        assertEquals("trip", tripLandmark("Parisian cafés").id)
        assertEquals("trip", tripLandmark("Bostonia").id)
        assertEquals("trip", tripLandmark("Romanian coast").id)
    }

    @Test
    fun takesANameThatIsAlsoAWordOnlyAsAPlace() {
        assertEquals("nice", tripLandmark("Nice").id)
        assertEquals("nice", tripLandmark("Nice, France").id)
        assertEquals("nice", tripLandmark("Weekend in Nice").id)
        assertEquals("trip", tripLandmark("Nice weekend").id)
        assertEquals("trip", tripLandmark("A nice break").id)
        assertEquals("trip", tripLandmark("NICE").id)
        assertEquals("bath", tripLandmark("Bath").id)
        assertEquals("trip", tripLandmark("Bath time").id)
        assertEquals("bath", tripLandmark("Nice weekend in Bath").id)
        assertEquals("split", tripLandmark("Split, Croatia").id)
        assertEquals("split", tripLandmark("Week in Split").id)
        assertEquals("trip", tripLandmark("Split stay").id)
        assertEquals("orange", tripLandmark("Orange, CA").id)
        assertEquals("orange", tripLandmark("Weekend in Orange").id)
        assertEquals("trip", tripLandmark("Orange juice").id)
        assertEquals("strawberry", tripLandmark("Strawberry").id)
        assertEquals("trip", tripLandmark("Strawberry picking").id)
        assertEquals("eagle", tripLandmark("Eagle, CO").id)
        assertEquals("trip", tripLandmark("Eagle watching").id)
    }

    @Test
    fun leavesOutALongerNameContainingACitys() {
        assertEquals("trip", tripLandmark("Santiago de Cuba").id)
        assertEquals("santiago-de-compostela", tripLandmark("Santiago de Compostela").id)
        assertEquals("trip", tripLandmark("Victoria Falls").id)
        assertEquals("lake", tripLandmark("Lake Victoria").id)
        assertEquals("lake", tripLandmark("Lake Victoria holiday").id)
        assertEquals("victoria", tripLandmark("Lake Victoria, then Victoria").id)
        assertEquals("lake", tripLandmark("Milford Sound").id)
        assertEquals("trip", tripLandmark("Rio Grande").id)
        assertEquals("trip", tripLandmark("Washington State").id)
        assertEquals("road-trip", tripLandmark("Washington State road trip").id)
        assertEquals("trip", tripLandmark("Canton, Ohio").id)
        assertEquals("trip", tripLandmark("Santa Cruz de la Sierra").id)
        assertEquals("santiago", tripLandmark("Santiago").id)
        assertEquals("washington", tripLandmark("Washington, DC").id)
        assertEquals("rio-de-janeiro", tripLandmark("Rio Grande, then Rio").id)
    }

    @Test
    fun givesPlacesNamedAfterARealWorldNounAMatchingDrawing() {
        assertEquals("rose", tripLandmark("Roseville").id)
        assertEquals("rose", tripLandmark("Santa Rosa").id)
        assertEquals("acorn", tripLandmark("Fair Oaks").id)
        assertEquals("acorn", tripLandmark("Thousand Oaks").id)
        assertEquals("apple", tripLandmark("Appleton").id)
        assertEquals("orange", tripLandmark("Orangevale").id)
        assertEquals("cherry", tripLandmark("Cherry Hill").id)
        assertEquals("peach", tripLandmark("Peachtree City").id)
        assertEquals("lemon", tripLandmark("Lemon Grove").id)
        assertEquals("strawberry", tripLandmark("Strawberry Plains").id)
        assertEquals("clover", tripLandmark("Cloverdale").id)
        assertEquals("sunflower", tripLandmark("Sunnyvale").id)
        assertEquals("anchor", tripLandmark("Anchorage").id)
        assertEquals("bell", tripLandmark("Bellevue").id)
        assertEquals("crown", tripLandmark("Coronado").id)
        assertEquals("diamond", tripLandmark("Diamond Bar").id)
        assertEquals("bear", tripLandmark("Big Bear").id)
        assertEquals("swan", tripLandmark("Swansea").id)
        assertEquals("fox", tripLandmark("Foxborough").id)
        assertEquals("stag", tripLandmark("Elk Grove").id)
        assertEquals("butterfly", tripLandmark("Mariposa").id)
        assertEquals("windmill", tripLandmark("Mill Valley").id)
        assertEquals("whale", tripLandmark("Orcas Island").id)
        assertEquals("eagle", tripLandmark("Eagle River").id)
        assertEquals("shell", tripLandmark("Shell Beach").id)
        assertEquals("star", tripLandmark("Northstar").id)
    }

    @Test
    fun fallsBackToPlaceKindSeasonHolidayOrVacationWhenNoCityIsNamed() {
        assertEquals("mountains", tripLandmark("Alps").id)
        assertEquals("mountains", tripLandmark("Whistler").id)
        assertEquals("mountains", tripLandmark("Mountain getaway").id)
        assertEquals("forest", tripLandmark("Yosemite").id)
        assertEquals("forest", tripLandmark("Forest cabin").id)
        assertEquals("lake", tripLandmark("Lake Como").id)
        assertEquals("lake", tripLandmark("Lake house").id)
        assertEquals("farm", tripLandmark("Farm stay").id)
        assertEquals("beach", tripLandmark("Beach week").id)
        assertEquals("city", tripLandmark("City break").id)
        assertEquals("city", tripLandmark("Kansas City").id)
        assertEquals("town", tripLandmark("Old town weekend").id)
        assertEquals("camp", tripLandmark("Camping trip").id)
        assertEquals("countryside", tripLandmark("Cotswolds").id)
        assertEquals("countryside", tripLandmark("Countryside cottage").id)
        assertEquals("desert", tripLandmark("Grand Canyon").id)
        assertEquals("desert", tripLandmark("Desert dunes").id)
        assertEquals("wine", tripLandmark("Napa Valley").id)
        assertEquals("wine", tripLandmark("Winery weekend").id)
        assertEquals("road-trip", tripLandmark("Pacific Coast Highway").id)
        assertEquals("safari", tripLandmark("Serengeti").id)
        assertEquals("safari", tripLandmark("Safari week").id)
        assertEquals("theme-park", tripLandmark("Disneyland").id)
        assertEquals("theme-park", tripLandmark("Theme park trip").id)
        assertEquals("celebration", tripLandmark("Wedding weekend").id)
        assertEquals("celebration", tripLandmark("Honeymoon").id)
        assertEquals("castle", tripLandmark("Neuschwanstein").id)
        assertEquals("castle", tripLandmark("Medieval castle tour").id)
        assertEquals("summer", tripLandmark("Summer vacation").id)
        assertEquals("autumn", tripLandmark("Autumn foliage").id)
        assertEquals("autumn", tripLandmark("Fall break").id)
        assertEquals("winter", tripLandmark("Winter getaway").id)
        assertEquals("spring", tripLandmark("Spring break").id)
        assertEquals("thanksgiving", tripLandmark("Thanksgiving").id)
        assertEquals("christmas", tripLandmark("Christmas break").id)
        assertEquals("new-year", tripLandmark("New Year's Eve").id)
        assertEquals("new-year", tripLandmark("Lunar New Year").id)
        assertEquals("easter", tripLandmark("Easter weekend").id)
        assertEquals("halloween", tripLandmark("Halloween").id)
        assertEquals("cruise", tripLandmark("Caribbean cruise").id)
        assertEquals("vacation", tripLandmark("Family holiday").id)
        assertEquals("vacation", tripLandmark("Passover").id)
    }

    @Test
    fun prefersANamedPlaceOverAnEarlierSeasonHolidayOrThemeWord() {
        assertEquals("paris", tripLandmark("Summer in Paris").id)
        assertEquals("boston", tripLandmark("Thanksgiving in Boston").id)
        assertEquals("sydney", tripLandmark("Beach trip to Sydney").id)
        assertEquals("beach", tripLandmark("Christmas in Kihei").id)
        assertEquals("mountains", tripLandmark("Summer in the Alps").id)
        assertEquals("forest", tripLandmark("Fall in Yosemite").id)
        assertEquals("lake", tripLandmark("Summer at Lake Como").id)
        assertEquals("wine", tripLandmark("Wedding in Tuscany").id)
        assertEquals("desert", tripLandmark("Road trip to Sedona").id)
        assertEquals("banff", tripLandmark("Ski trip to Banff").id)
        assertEquals("summer", tripLandmark("Summer holiday").id)
        assertEquals("christmas", tripLandmark("Christmas holiday").id)
    }

    @Test
    fun givesAPlaceWithNoLandmarkTheSuitcase() {
        assertEquals("trip", tripLandmark("Woburn").id)
        assertEquals("trip", tripLandmark("Niagara Falls").id)
        assertEquals("trip", tripLandmark("Springfield").id)
        assertEquals("trip", tripLandmark("Cornwall").id)
        assertEquals("trip", tripLandmark("").id)
    }

    @Test
    fun readsEveryLandmarkTheWebHas() {
        val rawEntries = landmarksJson.lines().count { it.startsWith("{\"id\":") }
        assertEquals(rawEntries, landmarks.size)
        assertEquals(317, landmarks.size)
        assertEquals(landmarks.size, landmarks.map { it.id }.toSet().size)
        val seenCities = mutableSetOf<String>()
        val seenFallbacks = mutableSetOf<String>()
        for (landmark in landmarks) {
            for (city in landmark.cities) {
                assertEquals(city, foldText(city))
                assertEquals(true, seenCities.add(city))
            }
            for (name in landmark.capitalized) {
                assertEquals(name.lowercase(), foldText(name))
                assertEquals(true, name.first().isUpperCase())
                assertEquals(true, seenCities.add(foldText(name)))
            }
            for (name in landmark.not) assertEquals(name, foldText(name))
            for (word in landmark.fallback) {
                assertEquals(word, foldText(word))
                assertEquals(true, seenFallbacks.add(word))
            }
        }
    }

    @Test
    fun givesATripThatIsJustAnEventItsBookingsIconWhateverItsTitle() {
        assertEquals(SegmentType.OTHER, tripBookingType("other"))
        assertEquals(SegmentType.ACTIVITY, tripBookingType("activity"))
        assertEquals(SegmentType.CAR_RENTAL, tripBookingType("car_rental"))
        assertEquals(null, tripBookingType("city"))
        assertEquals(null, tripBookingType("none"))
        assertEquals(null, tripBookingType(null))
        val show = Segment("s", "t", SegmentType.ACTIVITY, "Show", "2026-12-12T19:00:00Z", destination = Place("Theatre", city = "London", country = "GB"))
        val dinner = Segment("d", "t", SegmentType.OTHER, "Dinner", "2026-12-12T17:00:00Z", destination = Place("Bistro", city = "London"))
        // The dinner comes first.
        assertEquals("other", tripSetting(listOf(show, dinner)))
        assertEquals("activity", tripSetting(listOf(show)))
        assertEquals("town", tripSetting(listOf(show, stay("i", Place("Inn", city = "Woburn")))))
    }

    @Test
    fun tripPictureGoesByTheTitleThenTheKindOfPlaceElseTheSuitcase() {
        assertEquals("paris", tripPicture("Paris", "town").id)
        assertEquals("town", tripPicture("Woburn", "town").id)
        assertEquals("beach", tripPicture("Cornwall", "beach").id)
        assertEquals("trip", tripPicture("Woburn", "none").id)
        assertEquals("trip", tripPicture("Woburn").id)
        for (setting in PLACE_SETTINGS) assertEquals(setting, tripPicture("Somewhere", setting).id)
    }

    @Test
    fun placeSettingTakesWhatTheReaderSaidElseTheTownsSize() {
        assertEquals("beach", placeSetting(Place("Sea View", city = "Boston", setting = "beach")))
        assertEquals("city", placeSetting(Place("Hotel", city = "Boston", country = "US")))
        assertEquals("town", placeSetting(Place("Hotel", city = "Woburn", country = "US")))
        assertEquals("city", placeSetting(Place("Hotel", city = "São Paulo")))
        // A city in Canada, a town in England.
        assertEquals("city", placeSetting(Place("Hotel", city = "Windsor", country = "CA")))
        assertEquals("town", placeSetting(Place("Hotel", city = "Windsor", country = "GB")))
        assertEquals(null, placeSetting(Place("Terminal 5")))
        assertEquals(null, placeSetting(null))
    }

    private fun stay(id: String, place: Place, start: String = "2026-12-12T15:00:00Z", end: String? = "2026-12-14T11:00:00Z", cancelledAt: String? = null) =
        Segment(id, "t", SegmentType.LODGING, "Stay", start, end, destination = place, cancelledAt = cancelledAt)

    @Test
    fun tripSettingGoesByTheLongestStay() {
        val short = stay("a", Place("Airport Inn", city = "Boston", country = "US"), end = "2026-12-13T11:00:00Z")
        val long = stay("b", Place("Beach House", city = "Truro", setting = "beach"), start = "2026-12-13T15:00:00Z", end = "2026-12-20T11:00:00Z")
        assertEquals("beach", tripSetting(listOf(short, long)))
        assertEquals("beach", tripSetting(listOf(long, short)))
    }

    @Test
    fun tripSettingGoesByAnOutingElseWhereTheFirstJourneyArrives() {
        val show = Segment("s", "t", SegmentType.ACTIVITY, "Show", "2026-12-12T19:00:00Z", destination = Place("Theatre", city = "Woburn", country = "US"))
        val out = Segment("o", "t", SegmentType.FLIGHT, "XX 1 LHR to BOS", "2026-12-12T09:00:00Z", destination = Place("Logan", city = "Boston", country = "US"))
        val back = Segment("r", "t", SegmentType.FLIGHT, "XX 2 BOS to LHR", "2026-12-19T21:00:00Z", destination = Place("Heathrow", city = "London", country = "GB"))
        assertEquals("town", tripSetting(listOf(back, out, show)))
        assertEquals("city", tripSetting(listOf(back, out)))
    }

    @Test
    fun tripSettingGoesByWhatIsStillBooked() {
        val cancelled = stay("a", Place("Ski Lodge", city = "Zermatt", setting = "mountains"), cancelledAt = "2026-12-01T00:00:00Z")
        val kept = stay("b", Place("Inn", city = "Woburn"), end = "2026-12-13T11:00:00Z")
        assertEquals("town", tripSetting(listOf(cancelled, kept)))
    }

    @Test
    fun tripSettingIsNoneWhenNoBookingSays() {
        assertEquals("none", tripSetting(emptyList()))
        assertEquals("none", tripSetting(listOf(stay("a", Place("Somewhere")))))
    }
}
