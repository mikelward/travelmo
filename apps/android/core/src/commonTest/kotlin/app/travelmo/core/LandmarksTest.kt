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
    fun givesAPlaceWithNoLandmarkTheSuitcase() {
        assertEquals("trip", tripLandmark("Woburn").id)
        assertEquals("trip", tripLandmark("").id)
    }

    @Test
    fun readsEveryLandmarkTheWebHas() {
        val rawEntries = landmarksJson.lines().count { it.startsWith("{\"id\":") }
        assertEquals(rawEntries, landmarks.size)
        assertEquals(191, landmarks.size)
        assertEquals(landmarks.size, landmarks.map { it.id }.toSet().size)
        val seenCities = mutableSetOf<String>()
        for (landmark in landmarks) {
            for (city in landmark.cities) {
                assertEquals(city, foldText(city))
                assertEquals(true, seenCities.add(city))
            }
        }
    }
}
