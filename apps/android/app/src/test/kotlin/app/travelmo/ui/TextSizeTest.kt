package app.travelmo.ui

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.TouchInjectionScope
import androidx.compose.ui.test.SemanticsMatcher
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.ui.theme.TravelmoTheme
import com.mikelward.androidzoom.FontSizeSettings
import io.kotest.matchers.floats.plusOrMinus
import io.kotest.matchers.floats.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * The text size as the user meets it: Settings' − and +, slider and switch,
 * a two-finger pinch anywhere, and the size inside a dialog's own window.
 * Wired to the real [TextSizeSetting], its writes run in place and counted.
 *
 * 420dpi makes androidzoom's 24dp pinch slop 63px, which the spreads below
 * are measured against.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class TextSizeTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val writes = mutableListOf<FontSizeSettings>()

    @Before
    fun reset() {
        context.getSharedPreferences("text_size", Context.MODE_PRIVATE).edit().clear().commit()
        TextSizeSetting.resetForTest()
        TextSizeSetting.storeFor = { context ->
            val store = TextSizeStore(context)
            val counted: (FontSizeSettings) -> Boolean = { settings ->
                writes += settings
                store.write(settings)
            }
            counted
        }
    }

    @After
    fun leaveDefaults() {
        TextSizeSetting.resetForTest()
    }

    private val stored get() = TextSizeStore(context).read()

    private fun settings(scale: Float = 1f, pinch: Boolean = true) {
        if (scale != 1f) TextSizeSetting.setScale(context, scale)
        if (!pinch) TextSizeSetting.setPinchEnabled(context, false)
        writes.clear()
        composeRule.setContent { TravelmoTheme { Column { TextSizeSection() } } }
        composeRule.waitForIdle()
    }

    @Test
    fun `plus makes the text one percent larger and saves it`() {
        settings()
        composeRule.onNodeWithText("100%").assertExists()
        composeRule.onNodeWithContentDescription("Larger text").performClick()
        composeRule.onNodeWithText("101%").assertExists()
        stored.scale shouldBe (1.01f plusOrMinus 0.0001f)
        writes.size shouldBe 1
    }

    @Test
    fun `minus makes the text one percent smaller and saves it`() {
        settings(scale = 1.2f)
        composeRule.onNodeWithContentDescription("Smaller text").performClick()
        composeRule.onNodeWithText("119%").assertExists()
        stored.scale shouldBe (1.19f plusOrMinus 0.0001f)
    }

    @Test
    fun `minus is off at the smallest size`() {
        settings(scale = 0.8f)
        composeRule.onNodeWithText("80%").assertExists()
        composeRule.onNodeWithContentDescription("Smaller text").assertIsNotEnabled()
        composeRule.onNodeWithContentDescription("Larger text").assertIsEnabled()
    }

    @Test
    fun `plus is off at the largest size`() {
        settings(scale = 1.6f)
        composeRule.onNodeWithText("160%").assertExists()
        composeRule.onNodeWithContentDescription("Larger text").assertIsNotEnabled()
        composeRule.onNodeWithContentDescription("Smaller text").assertIsEnabled()
    }

    @Test
    fun `the slider sets the size and saves it once`() {
        settings()
        composeRule.onNode(SemanticsMatcher.keyIsDefined(SemanticsActions.SetProgress)).performSemanticsAction(SemanticsActions.SetProgress) { it(1.3f) }
        composeRule.waitForIdle()
        composeRule.onNodeWithText("130%").assertExists()
        stored.scale shouldBe (1.3f plusOrMinus 0.0001f)
        writes.size shouldBe 1
    }

    @Test
    fun `the switch turns the pinch off and on, and saves it`() {
        settings()
        val switch = composeRule.onNode(isToggleable())
        switch.assertIsOn()
        switch.performClick()
        switch.assertIsOff()
        stored.pinchEnabled shouldBe false
        switch.performClick()
        switch.assertIsOn()
        stored.pinchEnabled shouldBe true
    }

    private fun pinchContent() {
        writes.clear()
        composeRule.setContent {
            TravelmoTheme {
                Box(Modifier.fillMaxSize().testTag(SURFACE)) { Text("Liverpool") }
            }
        }
        composeRule.waitForIdle()
    }

    /** Two fingers 100px apart, spread past the slop, then to [to] px apart. */
    private fun TouchInjectionScope.spread(to: Float) {
        down(0, Offset(CENTER_X - 50f, ROW_Y))
        down(1, Offset(CENTER_X + 50f, ROW_Y))
        listOf(180f, 190f, to).forEach { spread ->
            updatePointerTo(0, Offset(CENTER_X - spread / 2f, ROW_Y))
            updatePointerTo(1, Offset(CENTER_X + spread / 2f, ROW_Y))
            move()
        }
        up(0)
        up(1)
    }

    @Test
    fun `a pinch anywhere resizes the text and saves once when the fingers lift`() {
        pinchContent()
        composeRule.onNodeWithTag(SURFACE).performTouchInput { spread(200f) }
        composeRule.waitForIdle()
        // 180px to 200px is a zoom of 1.111, which androidzoom's gain squares.
        TextSizeSetting.current.scale shouldBe (1.2346f plusOrMinus 0.001f)
        writes.size shouldBe 1
        stored.scale shouldBe (1.2346f plusOrMinus 0.001f)
    }

    @Test
    fun `with the switch off a pinch changes nothing`() {
        TextSizeSetting.setPinchEnabled(context, false)
        pinchContent()
        composeRule.onNodeWithTag(SURFACE).performTouchInput { spread(200f) }
        composeRule.waitForIdle()
        TextSizeSetting.current.scale shouldBe 1f
        writes.size shouldBe 0
    }

    @Test
    fun `a dialog's text is at the chosen size`() {
        TextSizeSetting.setScale(context, 1.5f)
        var dialogScale = 0f
        var systemScale = 0f
        composeRule.setContent {
            systemScale = LocalDensity.current.fontScale
            TravelmoTheme {
                AppAlertDialog(onDismissRequest = {}, confirmButton = {}, text = {
                    dialogScale = LocalDensity.current.fontScale
                    Text("Delete this booking?")
                })
            }
        }
        composeRule.waitForIdle()
        dialogScale shouldBe (systemScale * 1.5f plusOrMinus 0.0001f)
    }

    @Test
    fun `the menu's items are at the chosen size`() {
        TextSizeSetting.setScale(context, 1.6f)
        composeRule.setContent { TravelmoTheme { AppMenu() } }
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.waitForIdle()
        // bodyLarge is 24sp a line: 38.4dp at 160%.
        val height = composeRule.onNodeWithText("About").fetchSemanticsNode().size.height / 2.625f
        height shouldBeGreaterThan 36f
    }

    // The menu is a popup window, which the theme's pinch doesn't reach on its own.
    @Test
    fun `a pinch inside the menu resizes the text`() {
        composeRule.setContent { TravelmoTheme { AppMenu() } }
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.waitForIdle()
        writes.clear()
        composeRule.onNodeWithText("About").performTouchInput {
            val y = center.y
            down(0, Offset(center.x - 50f, y))
            down(1, Offset(center.x + 50f, y))
            listOf(180f, 190f, 200f).forEach { spread ->
                updatePointerTo(0, Offset(center.x - spread / 2f, y))
                updatePointerTo(1, Offset(center.x + spread / 2f, y))
                move()
            }
            up(0)
            up(1)
        }
        composeRule.waitForIdle()
        TextSizeSetting.current.scale shouldBe (1.2346f plusOrMinus 0.001f)
        writes.size shouldBe 1
    }

    private companion object {
        const val SURFACE = "surface"
        const val CENTER_X = 500f
        const val ROW_Y = 800f
    }
}
