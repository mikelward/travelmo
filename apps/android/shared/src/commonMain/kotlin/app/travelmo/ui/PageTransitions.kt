package app.travelmo.ui

import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith

/**
 * How a page opens over the one it was opened from, and closes back to it,
 * as in stopdash (SPEC "Back"): a short slide, an eighth of the width, as it
 * fades, in a quarter of a second, and a little faster closing. Navigation
 * 3's default is a 700 ms fade, long enough to feel like waiting. Closing is
 * also what the predictive back gesture draws as the finger moves.
 */
const val PAGE_OPEN_MILLIS = 250
const val PAGE_CLOSE_MILLIS = 200
private const val PAGE_SLIDE_PARTS = 8

/** A page opening: it slides in from the end side as the page under it slides away toward the start. */
fun pageOpens(rtl: Boolean): ContentTransform {
    val toward = if (rtl) -1 else 1
    return (
        slideInHorizontally(tween(PAGE_OPEN_MILLIS)) { toward * it / PAGE_SLIDE_PARTS } + fadeIn(tween(PAGE_OPEN_MILLIS))
        ) togetherWith (
        slideOutHorizontally(tween(PAGE_OPEN_MILLIS)) { -toward * it / PAGE_SLIDE_PARTS } + fadeOut(tween(PAGE_OPEN_MILLIS))
        )
}

/** The reverse of [pageOpens], which the back gesture also draws as the user swipes. */
fun pageCloses(rtl: Boolean): ContentTransform {
    val toward = if (rtl) -1 else 1
    return (
        slideInHorizontally(tween(PAGE_CLOSE_MILLIS)) { -toward * it / PAGE_SLIDE_PARTS } + fadeIn(tween(PAGE_CLOSE_MILLIS))
        ) togetherWith (
        slideOutHorizontally(tween(PAGE_CLOSE_MILLIS)) { toward * it / PAGE_SLIDE_PARTS } + fadeOut(tween(PAGE_CLOSE_MILLIS))
        )
}
