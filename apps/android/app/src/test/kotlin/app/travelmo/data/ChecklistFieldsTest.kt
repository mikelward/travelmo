package app.travelmo.data

import app.travelmo.core.Lead
import app.travelmo.core.LeadUnit
import app.travelmo.core.Reminder
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

// The reminders' documents as Firestore hands them over and as the rules
// check them (firestore.rules' validReminder).
class ChecklistFieldsTest {
    @Test
    fun `reads a reminder's document, numbers as Firestore gives them, and leaves out one that does not parse`() {
        reminderOf("s0", mapOf("id" to "visa", "text" to "Apply for a visa", "amount" to 30L, "unit" to "days", "createdAt" to "x"), dated = false) shouldBe
            Reminder("s0", "visa", "Apply for a visa", Lead(30, LeadUnit.DAYS))
        reminderOf("a1", mapOf("id" to "x1", "text" to "Pack", "date" to "2026-12-10"), dated = true) shouldBe Reminder("a1", "x1", "Pack", date = "2026-12-10")
        reminderOf("s1", mapOf("id" to "x1", "text" to "Pack", "date" to "2026-12-10"), dated = false).shouldBeNull()
        reminderOf("s2", mapOf("id" to "visa", "text" to "", "amount" to 30L, "unit" to "days"), dated = false).shouldBeNull()
        reminderOf("s3", null, dated = false).shouldBeNull()
    }

    @Test
    fun `writes a reminder's fields as the rules want them`() {
        reminderFields(Reminder("s0", "visa", "Apply for a visa", Lead(2, LeadUnit.WEEKS)), "2026-11-01T00:00:00Z") shouldBe
            mapOf("id" to "visa", "text" to "Apply for a visa", "createdAt" to "2026-11-01T00:00:00Z", "amount" to 2, "unit" to "weeks")
        reminderFields(Reminder("a0", "x1", "Pack", date = "2026-12-10"), "2026-11-01T00:00:00Z") shouldBe
            mapOf("id" to "x1", "text" to "Pack", "createdAt" to "2026-11-01T00:00:00Z", "date" to "2026-12-10")
    }

    @Test
    fun `reads the ticked ids, leaving out what is not one`() {
        doneOf(mapOf("done" to listOf("visa", 3L, "a/b"))) shouldBe listOf("visa")
        doneOf(null) shouldBe emptyList()
    }
}
