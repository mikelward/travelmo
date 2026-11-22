package app.travelmo.ui

import com.mikelward.androidzoom.MAX_FONT_SCALE
import com.mikelward.androidzoom.MIN_FONT_SCALE
import com.mikelward.androidzoom.fontScalePercent
import io.kotest.matchers.floats.plusOrMinus
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

/** Settings' − and +: one shown percent a tap, inside 80%–160%. */
class StepTextScaleTest {
    @Test
    fun `a whole percent steps by one either way`() {
        stepTextScale(1.25f, 1) shouldBe (1.26f plusOrMinus 0.00001f)
        stepTextScale(1.25f, -1) shouldBe (1.24f plusOrMinus 0.00001f)
        fontScalePercent(stepTextScale(1f, 1)) shouldBe 101
    }

    @Test
    fun `a size between two percents steps from the one shown`() {
        // 115.3% shows as 115%, so + lands on 116%.
        stepTextScale(1.153f, 1) shouldBe (1.16f plusOrMinus 0.00001f)
        // 115.6% shows as 116%, so − lands on 115%.
        stepTextScale(1.156f, -1) shouldBe (1.15f plusOrMinus 0.00001f)
    }

    @Test
    fun `the ends hold`() {
        stepTextScale(MAX_FONT_SCALE, 1) shouldBe MAX_FONT_SCALE
        stepTextScale(MIN_FONT_SCALE, -1) shouldBe MIN_FONT_SCALE
        stepTextScale(1.595f, 1) shouldBe MAX_FONT_SCALE
        stepTextScale(MAX_FONT_SCALE, -1) shouldBe (1.59f plusOrMinus 0.00001f)
        stepTextScale(MIN_FONT_SCALE, 1) shouldBe (0.81f plusOrMinus 0.00001f)
    }

    @Test
    fun `a corrupt size steps from the system's`() {
        stepTextScale(Float.NaN, 1) shouldBe (1.01f plusOrMinus 0.00001f)
        stepTextScale(Float.POSITIVE_INFINITY, -1) shouldBe (0.99f plusOrMinus 0.00001f)
    }
}
