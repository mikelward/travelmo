package app.travelmo.ui

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// A screen closes only itself, and only while it is on top: a second Back
// tapped while it slides away, or a late signal from it, closes nothing else
// and never empties the stack (NavDisplay throws on an empty one).
class NavigationCloseTest {
    @Test
    fun `a screen on top closes`() {
        val stack = mutableListOf<Any>("home", "trip", "booking")
        stack.close("booking") shouldBe true
        stack shouldBe listOf("home", "trip")
    }

    @Test
    fun `a screen already gone closes nothing under it`() {
        val stack = mutableListOf<Any>("home", "trip")
        // The booking's Back again, as it slides away.
        stack.close("booking") shouldBe false
        stack shouldBe listOf("home", "trip")
    }

    @Test
    fun `the last screen never closes`() {
        val stack = mutableListOf<Any>("home")
        stack.close("home") shouldBe false
        stack shouldBe listOf("home")
    }
}
