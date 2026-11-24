package app.travelmo.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import app.travelmo.shared.Res
import app.travelmo.shared.fira_sans_medium
import org.jetbrains.compose.resources.Font
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight

// Travelmo's palette, the one the web app and the mockups
// (design/android/project/styles/travelmo.css) use: zinc neutrals, an amber
// tertiary for warnings, red for errors. Fixed rather than dynamic, so the
// app looks like the product everywhere. Every role is set, so Material's
// baseline purple never shows through a component's defaults (the FAB, the
// switches' tracks, the pickers). Text meets WCAG AA (4.5:1) on the surfaces
// it sits on, and outline, the edge of text fields and switches, 3:1;
// ThemeContrastTest checks both. Two colors depart from the mockups for
// that: outline is zinc-500 rather than zinc-300 or zinc-700, and error is
// red-700 by day and red-400 by night.

val LightScheme = lightColorScheme(
    primary = Color(0xFF18181B),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF18181B),
    onPrimaryContainer = Color(0xFFFFFFFF),
    inversePrimary = Color(0xFFF4F4F5),
    secondary = Color(0xFF52525B),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE4E4E7),
    onSecondaryContainer = Color(0xFF18181B),
    tertiary = Color(0xFF78350F),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFEF3C7),
    onTertiaryContainer = Color(0xFF78350F),
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF171717),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF171717),
    surfaceVariant = Color(0xFFE4E4E7),
    onSurfaceVariant = Color(0xFF52525B),
    surfaceTint = Color(0xFF18181B),
    inverseSurface = Color(0xFF18181B),
    inverseOnSurface = Color(0xFFFAFAFA),
    error = Color(0xFFB91C1C),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF7F1D1D),
    outline = Color(0xFF71717A),
    outlineVariant = Color(0xFFE4E4E7),
    surfaceBright = Color(0xFFFFFFFF),
    surfaceDim = Color(0xFFE4E4E7),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFAFAFA),
    surfaceContainer = Color(0xFFF4F4F5),
    surfaceContainerHigh = Color(0xFFF4F4F5),
    surfaceContainerHighest = Color(0xFFE4E4E7),
)

val DarkScheme = darkColorScheme(
    primary = Color(0xFFF4F4F5),
    onPrimary = Color(0xFF18181B),
    primaryContainer = Color(0xFFF4F4F5),
    onPrimaryContainer = Color(0xFF18181B),
    inversePrimary = Color(0xFF18181B),
    secondary = Color(0xFFA1A1AA),
    onSecondary = Color(0xFF18181B),
    secondaryContainer = Color(0xFF3F3F46),
    onSecondaryContainer = Color(0xFFF4F4F5),
    tertiary = Color(0xFFFDE68A),
    onTertiary = Color(0xFF451A03),
    tertiaryContainer = Color(0xFF451A03),
    onTertiaryContainer = Color(0xFFFDE68A),
    background = Color(0xFF0A0A0A),
    onBackground = Color(0xFFEDEDED),
    surface = Color(0xFF0A0A0A),
    onSurface = Color(0xFFEDEDED),
    surfaceVariant = Color(0xFF27272A),
    onSurfaceVariant = Color(0xFFA1A1AA),
    surfaceTint = Color(0xFFF4F4F5),
    inverseSurface = Color(0xFFE4E4E7),
    inverseOnSurface = Color(0xFF18181B),
    error = Color(0xFFF87171),
    onError = Color(0xFF450A0A),
    errorContainer = Color(0xFF450A0A),
    onErrorContainer = Color(0xFFFECACA),
    outline = Color(0xFF71717A),
    outlineVariant = Color(0xFF27272A),
    surfaceBright = Color(0xFF27272A),
    surfaceDim = Color(0xFF0A0A0A),
    surfaceContainerLowest = Color(0xFF000000),
    surfaceContainerLow = Color(0xFF111113),
    surfaceContainer = Color(0xFF18181B),
    surfaceContainerHigh = Color(0xFF18181B),
    surfaceContainerHighest = Color(0xFF27272A),
)

/**
 * The colors Material has no role for. [shared] is the SHARED label's text;
 * a shared trip's calendar bar is [sharedContainer] with [onSharedContainer]
 * text. On the Reports map, [land] fills a country and [visited] one the
 * user has been to.
 */
@Immutable
data class TravelmoColors(
    val shared: Color,
    val sharedContainer: Color,
    val onSharedContainer: Color,
    val land: Color,
    val visited: Color,
)

// The web's violet-600 and sky-600 by day. By night the label is violet-400,
// since violet-600 text is 3.5:1 on the dark background, and the map sky-400
// on zinc-700 land, which stands out from the page.
val LightExtraColors = TravelmoColors(
    shared = Color(0xFF7C3AED),
    sharedContainer = Color(0xFF7C3AED),
    onSharedContainer = Color(0xFFFFFFFF),
    land = Color(0xFFE4E4E7),
    visited = Color(0xFF0284C7),
)

val DarkExtraColors = TravelmoColors(
    shared = Color(0xFFA78BFA),
    sharedContainer = Color(0xFF7C3AED),
    onSharedContainer = Color(0xFFFFFFFF),
    land = Color(0xFF3F3F46),
    visited = Color(0xFF38BDF8),
)

val LocalTravelmoColors = staticCompositionLocalOf { LightExtraColors }

/** Travelmo's own colors, for the light or dark theme in use. */
object TravelmoTheme {
    val colors: TravelmoColors
        @Composable
        @ReadOnlyComposable
        get() = LocalTravelmoColors.current
}

/**
 * The "Travelmo" wordmark's face, as on the Play listing and the web's header:
 * Fira Sans Medium (SIL Open Font License, apps/android/app/fonts/FiraSans-OFL.txt). Only
 * the wordmark uses it; the rest of the app keeps the system font.
 */
val Wordmark: FontFamily
    @Composable
    get() = FontFamily(Font(Res.font.fira_sans_medium, FontWeight.Medium))

/**
 * The palette for the light or dark theme: Material's colors and
 * Travelmo's own ([TravelmoTheme.colors]). Each app wraps it with what it
 * adds, Android the text size the user picks.
 */
@Composable
fun TravelmoPalette(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalTravelmoColors provides if (darkTheme) DarkExtraColors else LightExtraColors) {
        MaterialTheme(colorScheme = if (darkTheme) DarkScheme else LightScheme, content = content)
    }
}
