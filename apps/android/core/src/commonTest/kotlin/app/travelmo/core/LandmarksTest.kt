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
    }

    @Test
    fun leavesOutALongerNameContainingACitys() {
        assertEquals("trip", tripLandmark("Santiago de Cuba").id)
        assertEquals("santiago-de-compostela", tripLandmark("Santiago de Compostela").id)
        assertEquals("trip", tripLandmark("Victoria Falls").id)
        assertEquals("lake", tripLandmark("Lake Victoria").id)
        assertEquals("lake", tripLandmark("Lake Victoria holiday").id)
        assertEquals("victoria", tripLandmark("Lake Victoria, then Victoria").id)
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
        assertEquals(275, landmarks.size)
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
}
