package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mikelward.androidzoom.compose.pinchFontSize
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The scroll cue (SPEC "Scroll cue"): an edge gets its fade and chevron only
 * while the list scrolls on past it, and a tap on the chevron pages that way.
 * White rows under a black edge, a blue plate and a red glyph, so each part of
 * the cue is told apart by color. At 160dpi a dp is a pixel.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w320dp-h480dp-160dpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScrollEdgeCueTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val colors = ScrollCueColors(edge = Color.Black, plate = Color.Blue, glyph = Color.Red)
    private lateinit var list: LazyListState
    private lateinit var scroll: ScrollState
    private val clicked = mutableListOf<Int>()

    /** A 200dp LazyColumn of 50dp rows. */
    private fun showList(rows: Int) {
        composeRule.setContent {
            list = rememberLazyListState()
            LazyColumn(modifier = Modifier.testTag("list").size(200.dp).scrollEdgeCue(list, colors), state = list) {
                items(rows) { row -> Box(Modifier.fillMaxWidth().height(50.dp).background(Color.White).clickable { clicked += row }) }
            }
        }
        composeRule.waitForIdle()
    }

    /** A 200dp verticalScroll Column of 50dp boxes, with no semantics of their own. */
    private fun showColumn(rows: Int) {
        composeRule.setContent {
            scroll = rememberScrollState()
            Column(Modifier.testTag("list").size(200.dp).scrollEdgeCue(scroll, colors).verticalScroll(scroll)) {
                repeat(rows) { Box(Modifier.fillMaxWidth().height(50.dp).background(Color.White)) }
            }
        }
        composeRule.waitForIdle()
    }

    private fun pixel(x: Int, y: Int): Color {
        val pixels = composeRule.onNodeWithTag("list").captureToImage().toPixelMap()
        return pixels[x, if (y < 0) pixels.height + y else y]
    }

    // The very top and bottom rows of pixels, mid-width: the fade's darkest.
    private fun edges() = pixel(100, 0) to pixel(100, -1)

    // The plate is centered 18dp in from the edge (4dp inset plus its 14dp
    // radius); its glyph spans the middle 12dp, so 10dp left of center is plate alone.
    private fun plate(top: Boolean) = pixel(90, if (top) 18 else -1 - 18)

    // The arrow's point: the down arrow's tip sits 4dp below the plate's center, the up arrow's above.
    private fun glyph(top: Boolean) = pixel(100, if (top) 18 - 3 else -1 - 18 + 3)

    private fun assertRed(color: Color) = assertTrue("$color", color.red > 0.5f && color.green < 0.5f && color.blue < 0.5f)

    private fun assertCued(top: Boolean, bottom: Boolean) {
        val (topEdge, bottomEdge) = edges()
        if (top) assertNotEquals(Color.White, topEdge) else assertEquals(Color.White, topEdge)
        if (bottom) assertNotEquals(Color.White, bottomEdge) else assertEquals(Color.White, bottomEdge)
        assertEquals(if (top) Color.Blue else Color.White, plate(top = true))
        assertEquals(if (bottom) Color.Blue else Color.White, plate(top = false))
        if (top) assertRed(glyph(top = true))
        if (bottom) assertRed(glyph(top = false))
    }

    private fun tap(x: Float, y: Float) {
        composeRule.onNodeWithTag("list").performTouchInput { click(Offset(x, y)) }
        composeRule.waitForIdle()
    }

    @Test
    fun `a list with more below cues only its bottom edge`() {
        showList(rows = 10)
        assertCued(top = false, bottom = true)
    }

    @Test
    fun `a list scrolled to the end cues only its top edge`() {
        showList(rows = 10)
        composeRule.runOnIdle { runBlocking { list.scrollToItem(9) } }
        composeRule.waitForIdle()
        assertCued(top = true, bottom = false)
    }

    @Test
    fun `a list that fits shows no cue`() {
        showList(rows = 4)
        assertCued(top = false, bottom = false)
    }

    @Test
    fun `a scrolling column cues its bottom, then only its top at the end`() {
        showColumn(rows = 10)
        assertCued(top = false, bottom = true)
        composeRule.runOnIdle { runBlocking { scroll.scrollTo(scroll.maxValue) } }
        composeRule.waitForIdle()
        assertCued(top = true, bottom = false)
    }

    @Test
    fun `a tap on the bottom chevron scrolls down a page and presses no row`() {
        showList(rows = 20)
        tap(100f, 182f)
        composeRule.runOnIdle {
            // 200px down: four 50px rows.
            assertEquals(4, list.firstVisibleItemIndex)
            assertEquals(0, list.firstVisibleItemScrollOffset)
            assertEquals(emptyList<Int>(), clicked)
        }
    }

    @Test
    fun `a tap on a scrolling column's chevrons pages it down and back up`() {
        showColumn(rows = 20)
        tap(100f, 199f)
        composeRule.runOnIdle { assertEquals(200, scroll.value) }
        tap(100f, 18f)
        composeRule.runOnIdle { assertEquals(0, scroll.value) }
    }

    @Test
    fun `a tap on the top chevron scrolls up a page`() {
        showList(rows = 20)
        composeRule.runOnIdle { runBlocking { list.scrollToItem(10) } }
        composeRule.waitForIdle()
        tap(100f, 18f)
        composeRule.runOnIdle {
            assertEquals(6, list.firstVisibleItemIndex)
            assertEquals(emptyList<Int>(), clicked)
        }
    }

    @Test
    fun `a tap beside the chevron, or where none shows, goes to the row`() {
        showList(rows = 20)
        // Beside the bottom chevron's target, and just past it from the edge.
        tap(20f, 182f)
        tap(100f, 150f)
        // Where the top chevron would be, at the top of the list.
        tap(100f, 18f)
        composeRule.runOnIdle {
            assertEquals(0, list.firstVisibleItemIndex)
            assertEquals(listOf(3, 3, 0), clicked)
        }
    }

    @Test
    fun `a drag that starts on the chevron still scrolls the list`() {
        showList(rows = 20)
        composeRule.onNodeWithTag("list").performTouchInput { swipe(Offset(100f, 182f), Offset(100f, 82f)) }
        composeRule.waitForIdle()
        composeRule.runOnIdle {
            assertTrue(list.firstVisibleItemIndex >= 1)
            assertEquals(emptyList<Int>(), clicked)
        }
    }

    @Test
    fun `a second finger on the list makes it no tap`() {
        showList(rows = 20)
        composeRule.onNodeWithTag("list").performTouchInput {
            down(0, Offset(100f, 182f))
            down(1, Offset(100f, 100f))
            up(0)
            up(1)
        }
        composeRule.waitForIdle()
        composeRule.runOnIdle { assertEquals(0, list.firstVisibleItemIndex) }
    }

    @Test
    fun `a pinch with its second finger outside the list pages nothing`() {
        composeRule.setContent {
            list = rememberLazyListState()
            // The app's pinch host around the screen, as the theme puts it, and
            // a bar above the list whose touches never reach the list.
            Column(
                Modifier.testTag("screen").size(200.dp, 250.dp)
                    .pinchFontSize(enabled = { true }, scale = { 1f }, onStart = {}, onPreview = {}, onSettled = {}),
            ) {
                Box(Modifier.fillMaxWidth().height(50.dp).clickable {})
                LazyColumn(modifier = Modifier.size(200.dp).scrollEdgeCue(list, colors), state = list) {
                    items(20) { Box(Modifier.fillMaxWidth().height(50.dp).background(Color.White)) }
                }
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("screen").performTouchInput {
            // The bottom chevron, under the 50px bar; the second finger on the
            // bar, then spread well past the pinch's 24dp slop.
            down(0, Offset(100f, 232f))
            down(1, Offset(100f, 25f))
            moveTo(1, Offset(100f, 5f))
            moveTo(1, Offset(100f, 0f))
            up(1)
            up(0)
        }
        composeRule.waitForIdle()
        composeRule.runOnIdle { assertEquals(0, list.firstVisibleItemIndex) }
        // And the next tap on the chevron, a gesture of its own, still pages.
        composeRule.onNodeWithTag("screen").performTouchInput { click(Offset(100f, 232f)) }
        composeRule.waitForIdle()
        composeRule.runOnIdle { assertEquals(4, list.firstVisibleItemIndex) }
    }

    @Test
    fun `screen readers never see the cue`() {
        showColumn(rows = 20)
        // Both chevrons showing.
        composeRule.runOnIdle { runBlocking { scroll.scrollTo(100) } }
        composeRule.waitForIdle()
        val root = composeRule.onRoot(useUnmergedTree = true).fetchSemanticsNode()
        // The scrolling column and its 20 boxes, and nothing else: the cue adds
        // no node, and nothing on screen is labeled or clickable.
        val column = root.children.single()
        assertEquals(20, column.children.size)
        fun all(node: SemanticsNode): List<SemanticsNode> = listOf(node) + node.children.flatMap(::all)
        for (node in all(root)) {
            assertNull(node.config.getOrNull(SemanticsProperties.ContentDescription))
            assertNull(node.config.getOrNull(SemanticsActions.OnClick))
        }
    }
}
