package app.travelmo.ui.theme

import io.kotest.matchers.shouldBe
import org.junit.Test

// Every style Material's components or a screen can reach for is one of the
// app's own (AGENTS.md "Type"), so no screen grows a seventh.
class TypeTest {
    @Test
    fun `every Material style is one of the app's own, in three sizes`() {
        val t = AppTypography
        val all = listOf(
            t.displayLarge, t.displayMedium, t.displaySmall, t.headlineLarge, t.headlineMedium, t.headlineSmall,
            t.titleLarge, t.titleMedium, t.titleSmall, t.bodyLarge, t.bodyMedium, t.bodySmall,
            t.labelLarge, t.labelMedium, t.labelSmall,
        )
        all.distinct().size shouldBe 5
        all.map { it.fontSize }.distinct().size shouldBe 3
        // Buttons and menu items are body text, in medium weight.
        t.labelLarge.fontSize shouldBe t.bodyLarge.fontSize
    }
}
