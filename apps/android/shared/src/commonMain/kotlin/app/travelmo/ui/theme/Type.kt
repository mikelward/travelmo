package app.travelmo.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.FontWeight

/**
 * The app's type: five styles, and no others, so a screen reads as one.
 * - Title (`titleLarge`): a screen's or a card's title.
 * - Heading (`titleMedium`): a section's or a day's heading, a row's title.
 * - Body (`bodyLarge`): everything else, dialogs and secondary lines
 *   included; what matters less is muted in colour, not made smaller.
 * - Action (`labelLarge`): body in medium weight, for every button and menu
 *   item, so what can be tapped reads as such and every menu alike.
 * - Badge (`labelSmall`): the small capitals of SHARED, CANCELLED and the like.
 * Material's other styles, which its own components reach for (a dialog's
 * text is bodyMedium, a menu item's and a button's labelLarge), are mapped
 * onto these, so nothing on screen falls outside them.
 */
val AppTypography: Typography = Typography().let { m ->
    val title = m.titleLarge
    val heading = m.titleMedium
    val body = m.bodyLarge
    val action = body.copy(fontWeight = FontWeight.Medium)
    val badge = m.labelSmall
    m.copy(
        displayLarge = title, displayMedium = title, displaySmall = title,
        headlineLarge = title, headlineMedium = title, headlineSmall = title,
        titleLarge = title, titleMedium = heading, titleSmall = heading,
        bodyLarge = body, bodyMedium = body, bodySmall = body,
        labelLarge = action, labelMedium = badge, labelSmall = badge,
    )
}
