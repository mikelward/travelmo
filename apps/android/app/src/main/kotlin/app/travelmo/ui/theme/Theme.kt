package app.travelmo.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Travelmo's palette, the one the web app and the mockups
// (design/android/project/styles/travelmo.css) use: zinc neutrals, an amber
// tertiary for warnings, red for errors. Fixed rather than dynamic, so the
// app looks like the product everywhere.

private val LightScheme = lightColorScheme(
    primary = Color(0xFF18181B),
    onPrimary = Color(0xFFFFFFFF),
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF171717),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF171717),
    onSurfaceVariant = Color(0xFF52525B),
    surfaceContainer = Color(0xFFF4F4F5),
    surfaceContainerHigh = Color(0xFFF4F4F5),
    outline = Color(0xFFD4D4D8),
    outlineVariant = Color(0xFFE4E4E7),
    tertiary = Color(0xFF78350F),
    tertiaryContainer = Color(0xFFFEF3C7),
    onTertiaryContainer = Color(0xFF78350F),
    error = Color(0xFFDC2626),
    onError = Color(0xFFFFFFFF),
    inverseSurface = Color(0xFF18181B),
    inverseOnSurface = Color(0xFFFAFAFA),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFFF4F4F5),
    onPrimary = Color(0xFF18181B),
    background = Color(0xFF0A0A0A),
    onBackground = Color(0xFFEDEDED),
    surface = Color(0xFF0A0A0A),
    onSurface = Color(0xFFEDEDED),
    onSurfaceVariant = Color(0xFFA1A1AA),
    surfaceContainer = Color(0xFF18181B),
    surfaceContainerHigh = Color(0xFF18181B),
    outline = Color(0xFF3F3F46),
    outlineVariant = Color(0xFF27272A),
    tertiary = Color(0xFFFDE68A),
    tertiaryContainer = Color(0xFF451A03),
    onTertiaryContainer = Color(0xFFFDE68A),
    error = Color(0xFFEF4444),
    onError = Color(0xFF450A0A),
    inverseSurface = Color(0xFFE4E4E7),
    inverseOnSurface = Color(0xFF18181B),
)

/** The badge color of a trip shared with the viewer. */
val SharedBadge = Color(0xFF7C3AED)

@Composable
fun TravelmoTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) DarkScheme else LightScheme, content = content)
}
