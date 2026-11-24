package app.travelmo.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

// The text size the user picks on Android (SPEC "Text size"), which a menu
// or dialog, being a window of its own, takes up again. iOS has Dynamic
// Type instead, so there these change nothing.

/** Lets a pinch inside a menu or dialog change the text size, as it does on the screen behind. */
@Composable
expect fun Modifier.pinchFontSizeHost(): Modifier

/** [content] in a window of its own (a dialog's buttons, a date picker) at the user's text size. */
@Composable
expect fun FontSizeWindow(content: @Composable () -> Unit)
