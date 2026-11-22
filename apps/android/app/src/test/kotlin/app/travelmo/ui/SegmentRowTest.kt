package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.SegmentType
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** A booking's type shows as an icon that a screen reader names, not as a word. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class SegmentRowTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the type is an icon named for it`() {
        val stay = fixtureSegments.getValue("liverpool").first { it.type == SegmentType.LODGING }
        composeRule.setContent { TravelmoTheme { SegmentRow(stay) } }
        composeRule.onNodeWithContentDescription("Stay").assertExists()
        composeRule.onNodeWithText("STAY").assertDoesNotExist()
    }

    @Test
    fun `every type has its own icon`() {
        val icons = SegmentType.entries.map(::segmentIcon)
        icons.toSet().size shouldBe SegmentType.entries.size
    }
}
