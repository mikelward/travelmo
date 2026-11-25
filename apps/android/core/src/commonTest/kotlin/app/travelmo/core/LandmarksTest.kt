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
    }

    @Test
    fun ignoresAccentsAndCase() {
        assertEquals("lisbon", tripLandmark("LISBOA").id)
        assertEquals("edinburgh", tripLandmark("Édinburgh").id)
    }

    @Test
    fun takesTheCityNamedFirst() {
        assertEquals("dublin", tripLandmark("Dublin and Liverpool").id)
        assertEquals("liverpool", tripLandmark("Liverpool and Dublin").id)
    }

    @Test
    fun matchesWholeWordsOnly() {
        assertEquals("trip", tripLandmark("Parisian cafés").id)
        assertEquals("trip", tripLandmark("Bostonia").id)
    }

    @Test
    fun givesAPlaceWithNoLandmarkTheSuitcase() {
        assertEquals("trip", tripLandmark("Woburn").id)
        assertEquals("trip", tripLandmark("").id)
    }

    @Test
    fun readsEveryLandmarkTheWebHas() {
        assertEquals(listOf("boston", "las-vegas", "liverpool", "paris", "edinburgh", "lisbon", "dublin", "trip"), landmarks.map { it.id })
        for (landmark in landmarks) for (city in landmark.cities) assertEquals(city, foldText(city))
    }
}
