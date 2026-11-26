package app.travelmo.ui

import io.kotest.matchers.shouldBe
import org.junit.Test

class TypedConfirmationTest {
    @Test
    fun `goes ahead only once the word is typed, and never with one left from before`() {
        val confirmation = TypedConfirmation()
        confirmation.open()
        confirmation.confirmed shouldBe false
        confirmation.typed = " delete "
        confirmation.confirmed shouldBe true
        // Dismissed any way (Back, a tap outside): opened again, it asks again.
        confirmation.close()
        confirmation.open()
        confirmation.open shouldBe true
        confirmation.confirmed shouldBe false
        confirmation.typed = "DELET"
        confirmation.confirmed shouldBe false
    }
}
