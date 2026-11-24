package app.travelmo.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.toArgb
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import kotlin.math.pow

/**
 * WCAG AA contrast for the theme, light and dark: 4.5:1 for text against
 * what it sits on, 3:1 for the edges and fills a control is seen by (text
 * fields' and switches' outlines, filled buttons, the map's visited
 * countries). Disabled controls are exempt, as WCAG has them.
 */
class ThemeContrastTest {
    private data class Check(val name: String, val foreground: Color, val background: Color, val minimum: Double)

    private fun pairs(scheme: ColorScheme, extra: TravelmoColors): List<Check> = with(scheme) {
        // The passport warnings' box: tertiaryContainer at half strength over the page.
        val warningBox = tertiaryContainer.copy(alpha = 0.5f).compositeOver(background)
        listOf(
            Check("onBackground on background", onBackground, background, TEXT),
            Check("onSurface on surface", onSurface, surface, TEXT),
            Check("onSurfaceVariant on surface", onSurfaceVariant, surface, TEXT),
            Check("onSurface on surfaceContainer", onSurface, surfaceContainer, TEXT),
            Check("onSurfaceVariant on surfaceContainer", onSurfaceVariant, surfaceContainer, TEXT),
            Check("onSurface on surfaceContainerHigh", onSurface, surfaceContainerHigh, TEXT),
            Check("onSurfaceVariant on surfaceContainerHigh", onSurfaceVariant, surfaceContainerHigh, TEXT),
            Check("onSurfaceVariant on surfaceVariant", onSurfaceVariant, surfaceVariant, TEXT),
            Check("onSurface on surfaceContainerHighest", onSurface, surfaceContainerHighest, TEXT),
            Check("onPrimary on primary", onPrimary, primary, TEXT),
            Check("onPrimaryContainer on primaryContainer", onPrimaryContainer, primaryContainer, TEXT),
            Check("onSecondary on secondary", onSecondary, secondary, TEXT),
            Check("onSecondaryContainer on secondaryContainer", onSecondaryContainer, secondaryContainer, TEXT),
            Check("onTertiary on tertiary", onTertiary, tertiary, TEXT),
            Check("onTertiaryContainer on tertiaryContainer", onTertiaryContainer, tertiaryContainer, TEXT),
            Check("onError on error", onError, error, TEXT),
            Check("onErrorContainer on errorContainer", onErrorContainer, errorContainer, TEXT),
            Check("inverseOnSurface on inverseSurface", inverseOnSurface, inverseSurface, TEXT),
            Check("primary on surface", primary, surface, TEXT),
            Check("primary on surfaceContainerHigh", primary, surfaceContainerHigh, TEXT),
            Check("tertiary on surface", tertiary, surface, TEXT),
            Check("error on surface", error, surface, TEXT),
            Check("error on surfaceContainerHigh", error, surfaceContainerHigh, TEXT),
            Check("tertiary on the warnings' box", tertiary, warningBox, TEXT),
            Check("error on the warnings' box", error, warningBox, TEXT),
            Check("shared on surface", extra.shared, surface, TEXT),
            Check("onSharedContainer on sharedContainer", extra.onSharedContainer, extra.sharedContainer, TEXT),
            Check("outline on surface", outline, surface, UI),
            Check("outline on surfaceContainerHigh", outline, surfaceContainerHigh, UI),
            Check("outline on surfaceContainerHighest", outline, surfaceContainerHighest, UI),
            Check("primary on surface, as a fill", primary, surface, UI),
            Check("error on surface, as a fill", error, surface, UI),
            Check("visited on land", extra.visited, extra.land, UI),
            Check("onNavIndicator on navIndicator", extra.onNavIndicator, extra.navIndicator, UI),
        )
    }

    private fun failures(scheme: ColorScheme, extra: TravelmoColors): List<String> =
        pairs(scheme, extra)
            .map { it to contrast(it.foreground, it.background) }
            .filter { (check, ratio) -> ratio < check.minimum }
            .map { (check, ratio) -> "${check.name}: %.2f:1, needs %.1f:1".format(ratio, check.minimum) }

    @Test
    fun `the light theme meets WCAG AA`() {
        failures(LightScheme, LightExtraColors).shouldBeEmpty()
    }

    @Test
    fun `the dark theme meets WCAG AA`() {
        failures(DarkScheme, DarkExtraColors).shouldBeEmpty()
    }

    @Test
    fun `contrast is WCAG's`() {
        contrast(Color.Black, Color.White) shouldBe (21.0 plusOrMinus 0.001)
        contrast(Color.White, Color.White) shouldBe (1.0 plusOrMinus 0.001)
        // #767676 is the lightest gray that passes 4.5:1 on white.
        contrast(Color(0xFF767676), Color.White) shouldBe (4.54 plusOrMinus 0.01)
    }

    private companion object {
        const val TEXT = 4.5
        const val UI = 3.0

        fun contrast(a: Color, b: Color): Double {
            val (light, dark) = listOf(luminance(a), luminance(b)).sortedDescending()
            return (light + 0.05) / (dark + 0.05)
        }

        // WCAG 2's relative luminance, from the sRGB channels.
        fun luminance(color: Color): Double {
            val argb = color.toArgb()
            fun channel(shift: Int): Double {
                val c = ((argb shr shift) and 0xFF) / 255.0
                return if (c <= 0.04045) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
            }
            return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
        }
    }
}
