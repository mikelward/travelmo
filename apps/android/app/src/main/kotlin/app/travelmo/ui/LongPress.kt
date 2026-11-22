package app.travelmo.ui

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics

/**
 * A long press with one finger, as stopdash's `unlessPinch`: a second finger
 * down before the timeout, a drag past the touch slop or a lift calls it off,
 * so a pinch that starts here resizes the text and never fires [onLongPress].
 * It buzzes as a long press does, and offers [label] as the long-click
 * action to TalkBack. Nothing is consumed until it fires, so the pinch host
 * and scrolling see the gesture as before.
 */
fun Modifier.longPressUnlessPinch(label: String, onLongPress: () -> Unit): Modifier = composed {
    val haptics = LocalHapticFeedback.current
    val action by rememberUpdatedState(onLongPress)
    semantics { onLongClick(label) { action(); true } }
        .pointerInput(Unit) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                // Null when the timeout passes with the one finger still down and still.
                val calledOff = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                    var still = true
                    while (still) {
                        val pressed = awaitPointerEvent().changes.filter { it.pressed }
                        val finger = pressed.singleOrNull()
                        still = finger != null && finger.id == down.id && !finger.isConsumed &&
                            (finger.position - down.position).getDistance() <= viewConfiguration.touchSlop
                    }
                    true
                }
                if (calledOff != null) return@awaitEachGesture
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                action()
                // The rest of the gesture is the long press's: no tap or scroll after it.
                do {
                    val event = awaitPointerEvent()
                    event.changes.forEach { it.consume() }
                } while (event.changes.any { it.pressed })
            }
        }
}
