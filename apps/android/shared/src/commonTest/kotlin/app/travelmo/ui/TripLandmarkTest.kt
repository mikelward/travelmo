package app.travelmo.ui

import androidx.compose.ui.graphics.vector.addPathNodes
import app.travelmo.core.landmarks
import kotlin.test.Test
import kotlin.test.assertTrue

// Every landmark path in landmarks.json must parse cleanly into Compose vector nodes.
class TripLandmarkTest {
    @Test
    fun `parses every landmark SVG path`() {
        for (landmark in landmarks) {
            val nodes = addPathNodes(landmark.d)
            assertTrue(nodes.isNotEmpty(), "empty path nodes for ${landmark.id}")
            landmark.dashed?.let { dashed ->
                assertTrue(addPathNodes(dashed).isNotEmpty(), "empty dashed path nodes for ${landmark.id}")
            }
        }
    }
}
