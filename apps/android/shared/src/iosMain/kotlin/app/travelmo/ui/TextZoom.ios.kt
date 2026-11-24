package app.travelmo.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
actual fun Modifier.pinchFontSizeHost(): Modifier = this

@Composable
actual fun FontSizeWindow(content: @Composable () -> Unit) = content()
