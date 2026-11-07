package app.travelmo.core

import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import kotlin.math.abs

class WorldMapTest {
    @Test
    fun `the projection keeps the equator flat and the poles within the known bounds`() {
        equalEarth(0.0, 0.0) shouldBe (0.0 to -0.0)
        val (x, y) = equalEarth(180.0, 0.0)
        x shouldBe (2.7066 plusOrMinus 0.001)
        y shouldBe (0.0 plusOrMinus 1e-9)
        val (_, north) = equalEarth(0.0, 90.0)
        north shouldBe (-1.3173 plusOrMinus 0.001)
        // North is up: a northern latitude projects above the equator.
        (equalEarth(-0.1278, 51.5074).second < 0) shouldBe true
    }

    @Test
    fun `a path of moves, lines and closes reads as rings of points`() {
        parseRings("M1 -2L3 4L5 6ZM7 8L9 10Z") shouldBe listOf(listOf(1f to -2f, 3f to 4f, 5f to 6f), listOf(7f to 8f, 9f to 10f))
    }

    @Test
    fun `the web's map is read whole, and London lands on Great Britain's box`() {
        worldMap.scale shouldBe 185.0
        worldMap.viewBox.size shouldBe 4
        worldMap.countries.size shouldBe 174
        worldMap.countries.map { it.code } shouldContain "GB"
        val gb = worldMap.countries.first { it.code == "GB" }.rings.flatten()
        val (x, y) = worldMap.project(-0.1278, 51.5074)
        val near = gb.any { (px, py) -> abs(px - x) < 6 && abs(py - y) < 6 }
        near shouldBe true
    }
}
