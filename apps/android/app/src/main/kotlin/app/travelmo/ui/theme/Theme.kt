package app.travelmo.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import app.travelmo.ui.AndroidChrome
import app.travelmo.ui.LocalAppChrome
import app.travelmo.ui.rememberAppFontSizeState
import com.mikelward.androidzoom.compose.FontSizeState
import com.mikelward.androidzoom.compose.ProvideFontSize

/**
 * The palette, the Android pieces the shared screens show (AndroidChrome),
 * and the text at the user's chosen size (SPEC "Text size"):
 * [fontSize] multiplies the system's font scale, and a two-finger pinch
 * anywhere under the theme changes it. Only text grows; paddings, icons and
 * touch targets keep their layout. A menu or dialog, being its own window,
 * re-applies both (FontSizeWindow, pinchFontSizeHost, AppAlertDialog).
 * [darkTheme] follows the phone's dark theme; the activity is recreated when
 * it changes, so the theme and the system bars' icons switch with it.
 */
@Composable
fun TravelmoTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    fontSize: FontSizeState = rememberAppFontSizeState(),
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val chrome = remember(context) { AndroidChrome(context) }
    TravelmoPalette(darkTheme) {
        CompositionLocalProvider(LocalAppChrome provides chrome) {
            ProvideFontSize(fontSize, content = content)
        }
    }
}
