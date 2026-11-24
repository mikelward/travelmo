package app.travelmo.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.mikelward.androidzoom.compose.FontSizeWindow as ZoomFontSizeWindow
import com.mikelward.androidzoom.compose.pinchFontSizeHost as zoomPinchFontSizeHost

@Composable
actual fun Modifier.pinchFontSizeHost(): Modifier = zoomPinchFontSizeHost()

@Composable
actual fun FontSizeWindow(content: @Composable () -> Unit) = ZoomFontSizeWindow(content = content)
