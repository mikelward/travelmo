package app.travelmo.core

import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

private fun entry(title: String, vararg fields: Pair<String, String>) = ProfileEntry(title, fields.map { ProfileField(it.first, it.second) })

// Invented programs and numbers.
private val air = entry("Example Air Miles", "Name" to "Example Air Miles", "Account number" to "EA123", "Elite status" to "Gold", "Elite next status" to "Platinum", "Balance" to "12000", "Supplier code" to "exampleair")
private val hotels = entry("Sample Hotels Honors", "Account › Number" to "SH-9", "Points" to "350", "Tier" to "Silver")
private val bare = entry("Loyalty program 3", "Note" to "lapsed")

class LoyaltyTest {
    @Test
    fun `reads the account, balance and status by their usual labels`() {
        loyaltySummary(air) shouldBe LoyaltySummary("Example Air Miles", "EA123", "12,000", "Gold", "Platinum")
        loyaltySummary(hotels) shouldBe LoyaltySummary("Sample Hotels Honors", "SH-9", "350", "Silver")
        loyaltySummary(bare) shouldBe LoyaltySummary("Loyalty program 3")
        loyaltySummary(entry("P", "Number" to "wrong", "Account number" to "right", "Balance" to "  ", "Points" to "7")) shouldBe LoyaltySummary("P", "right", "7")
        loyaltySummary(entry("P", "Sub account › Balance" to "5", "Sub account › Account number" to "SUB-1", "Points" to "12000", "Account number" to "MAIN-1")) shouldBe
            LoyaltySummary("P", "MAIN-1", "12,000")
        loyaltySummary(entry("P", "Sub account › Balance" to "5")) shouldBe LoyaltySummary("P", balance = "5")
        formatBalance("1234567") shouldBe "1,234,567"
        formatBalance("12,000 pts") shouldBe "12,000 pts"
        formatBalance("-5") shouldBe "-5"
    }

    @Test
    fun `matches a booking's provider to a program by a distinctive word, never a generic one or a web address part`() {
        nameWords("Example Air Miles") shouldBe setOf("example")
        nameWords("Sample Hotels Honors") shouldBe setOf("sample")
        programsFor("Example Air", listOf(air, hotels, bare)) shouldBe listOf(air)
        programsFor("Sample Hotels & Resorts, Exampleville", listOf(air, hotels)) shouldBe listOf(hotels)
        programsFor("www.example-air.com", listOf(air)) shouldBe listOf(air)
        val dotCom = entry("Example.com Rewards", "Account number" to "EX123")
        nameWords("www.example.com") shouldBe setOf("example")
        programsFor("Other-air.com", listOf(dotCom)) shouldBe emptyList()
        programsFor("example.com", listOf(dotCom)) shouldBe listOf(dotCom)
        programsFor("Air Miles", listOf(air, hotels)) shouldBe emptyList()
        programsFor(null, listOf(air)) shouldBe emptyList()
        loyaltyLine(air) shouldBe "Example Air Miles · EA123 · Gold"
        loyaltyLine(bare) shouldBe "Loyalty program 3"
    }
}
