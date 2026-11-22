package app.travelmo.ui

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

// Ported from mikelward/stopdash's ui/ScrollEdgeCue.kt (its fade from
// mikelward/simmo, its chevron after mikelward/typelauncher's). No shared
// mikelward/* library carries it yet; one would be its home.

/** How far the fade reaches in from the edge. */
private val FADE_HEIGHT = 16.dp

// A 24dp Material arrow on a 28dp plate, kept 4dp inside the edge so it never
// reaches into the navigation bar or the top bar.
private val GLYPH_SIZE = 24.dp
private val PLATE_RADIUS = 14.dp
private val EDGE_INSET = 4.dp

// The chevron's tap target: Material's 48dp minimum, from the edge in,
// centered on the plate across.
private val TAP_TARGET = 48.dp

/**
 * The cue's colors: [edge] is the screen's background, which the fade blends
 * into; [plate] and [glyph] are the chevron's. The plate is solid and tonal,
 * not the background, so the arrow stays apart from the row's text under it.
 */
@Immutable
data class ScrollCueColors(val edge: Color, val plate: Color, val glyph: Color)

/**
 * The cue over a screen whose background is [edge]. The palette has no
 * secondaryContainer (stopdash's plate), so the plate is the divider gray,
 * which shows on both the background and the bordered cards.
 */
@Composable
@ReadOnlyComposable
fun scrollCueColors(edge: Color = MaterialTheme.colorScheme.background): ScrollCueColors =
    ScrollCueColors(edge, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.colorScheme.onSurface)

/**
 * Marks the top and/or bottom edge of a [ScrollState]-scrolled container while
 * there is more content that way (SPEC "Scroll cue"): a fade into the
 * background and a chevron on a plate. A tap on a shown chevron scrolls a page
 * (the viewport's height) that way.
 *
 * Drawn, not laid out: the cue has no accessibility node (a screen reader
 * user scrolls by gesture; a labeled icon would only be one more focus stop on
 * every screen). Only a tap within the chevron's 48dp target is taken, and
 * only while it shows; a drag that starts there still scrolls, and every other
 * touch goes to the row underneath.
 *
 * **Apply it before `.verticalScroll(scrollState)` in the chain.**
 * `verticalScroll` measures what follows at the content's full height and
 * translates it by the offset, so a cue placed after it would scroll with the
 * content instead of staying at the viewport's edge.
 */
fun Modifier.scrollEdgeCue(scrollState: ScrollState, colors: ScrollCueColors): Modifier = edgeCue(scrollState, colors)

/** [scrollEdgeCue] for a [LazyListState]-scrolled `LazyColumn`; same contract. */
fun Modifier.scrollEdgeCue(listState: LazyListState, colors: ScrollCueColors): Modifier = edgeCue(listState, colors)

// Everything but the two scroll flags is built once per size and density, so
// a scrolling frame allocates nothing: the flags are read only in
// onDrawWithContent, which keeps a scroll from invalidating the cache.
private fun Modifier.edgeCue(state: ScrollableState, colors: ScrollCueColors): Modifier = pageOnTap(state).drawWithCache {
    val fadePx = FADE_HEIGHT.toPx().coerceAtMost(size.height)
    val radius = PLATE_RADIUS.toPx()
    val inset = EDGE_INSET.toPx()
    val glyph = GLYPH_SIZE.toPx()
    // The same color fading its alpha, not a fade to Color.Transparent
    // (transparent black), which would pass through a gray band on a light
    // background.
    val clear = colors.edge.copy(alpha = 0f)
    val topFade = Brush.verticalGradient(listOf(colors.edge, clear), startY = 0f, endY = fadePx)
    val bottomFade = Brush.verticalGradient(listOf(clear, colors.edge), startY = size.height - fadePx, endY = size.height)
    val fadeSize = Size(size.width, fadePx)
    val bottomFadeAt = Offset(0f, size.height - fadePx)
    val topCenter = Offset(size.width / 2, inset + radius)
    val bottomCenter = Offset(size.width / 2, size.height - inset - radius)
    val upArrow = arrowPath(glyph / 24f, flip = true)
    val downArrow = arrowPath(glyph / 24f, flip = false)
    onDrawWithContent {
        drawContent()
        if (state.canScrollBackward) {
            drawRect(topFade, size = fadeSize)
            drawChevron(topCenter, radius, glyph, upArrow, colors)
        }
        if (state.canScrollForward) {
            drawRect(bottomFade, topLeft = bottomFadeAt, size = fadeSize)
            drawChevron(bottomCenter, radius, glyph, downArrow, colors)
        }
    }
}

/**
 * Pages [state] by its viewport's height on a tap on a shown chevron. Seen on
 * the way in (the [PointerEventPass.Initial] pass), ahead of the rows under it,
 * so a tap on the chevron is the chevron's alone: its down is consumed, which
 * keeps the row from pressing. The rest of the gesture is only watched: a drag
 * past the touch slop, one the list consumes in scrolling, a second finger on
 * the list, or a pinch the text-size host has taken is no tap.
 */
private fun Modifier.pageOnTap(state: ScrollableState): Modifier = pointerInput(state) {
    coroutineScope {
        awaitEachGesture {
            val down = awaitFirstDown(pass = PointerEventPass.Initial)
            // 48dp square from the edge in: centered on the plate it would hang
            // 6dp off the edge, where no touch reaches it.
            val target = TAP_TARGET.toPx()
            val onCenter = abs(down.position.x - size.width / 2f) <= target / 2
            val direction = when {
                onCenter && state.canScrollBackward && down.position.y <= target -> -1f
                onCenter && state.canScrollForward && down.position.y >= size.height - target -> 1f
                else -> return@awaitEachGesture
            }
            down.consume()
            val slop = viewConfiguration.touchSlop
            while (true) {
                val changes = awaitPointerEvent(PointerEventPass.Initial).changes
                if (changes.any { it.id != down.id && it.pressed }) return@awaitEachGesture
                val change = changes.firstOrNull { it.id == down.id } ?: return@awaitEachGesture
                if (!change.pressed) {
                    // Consumed: the pinch host, which sees the whole screen
                    // ahead of this, took the gesture as a resize.
                    if (change.isConsumed) return@awaitEachGesture
                    change.consume()
                    launch { state.animateScrollBy(direction * size.height) }
                    return@awaitEachGesture
                }
                if (change.isConsumed || (change.position - down.position).getDistance() > slop) return@awaitEachGesture
            }
        }
    }
}

private fun ContentDrawScope.drawChevron(center: Offset, radius: Float, glyph: Float, arrow: Path, colors: ScrollCueColors) {
    drawCircle(colors.plate, radius = radius, center = center)
    translate(center.x - glyph / 2, center.y - glyph / 2) {
        drawPath(arrow, colors.glyph)
    }
}

/**
 * Material's `KeyboardArrowDown` outline on its 24-unit viewport, scaled;
 * [flip] mirrors it into `KeyboardArrowUp`. Traced here rather than taken from
 * the icon library, because a vector painter can only be made in composition
 * and this cue is draw-only.
 */
private fun arrowPath(scale: Float, flip: Boolean): Path {
    val points = listOf(7.41f to 8.59f, 12f to 13.17f, 16.59f to 8.59f, 18f to 10f, 12f to 16f, 6f to 10f)
    return Path().apply {
        points.forEachIndexed { i, (x, y) ->
            val px = x * scale
            val py = (if (flip) 24f - y else y) * scale
            if (i == 0) moveTo(px, py) else lineTo(px, py)
        }
        close()
    }
}
