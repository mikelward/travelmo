package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

private fun entry(title: String, vararg fields: Pair<String, String>) = ProfileEntry(title, fields.map { ProfileField(it.first, it.second) })

// Invented programs and numbers.
private val air = entry("Example Air Miles", "Name" to "Example Air Miles", "Account number" to "EA123", "Elite status" to "Gold", "Elite next status" to "Platinum", "Balance" to "12000", "Supplier code" to "exampleair")
private val hotels = entry("Sample Hotels Honors", "Account › Number" to "SH-9", "Points" to "350", "Tier" to "Silver")
private val bare = entry("Loyalty program 3", "Note" to "lapsed")

class LoyaltyTest {
    @Test
    fun `reads the account balance and status by their usual labels`() {
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
    fun `matches a booking's provider to a program by a distinctive word never a generic one or a web address part`() {
        nameWords("Example Air Miles") shouldBe setOf("example")
        nameWords("Sample Hotels Honors") shouldBe setOf("sample")
        programsFor("Example Air", listOf(air, hotels, bare)) shouldBe listOf(air)
        programsFor("Sample Hotels & Resorts, Exampleville", listOf(air, hotels)) shouldBe listOf(hotels)
        programsFor("www.example-air.com", listOf(air)) shouldBe listOf(air)
        val dotCom = entry("Example.com Rewards", "Account number" to "EX123")
        nameWords("www.example.com") shouldBe setOf("example")
        nameWords("Frequent Flyer number") shouldBe emptySet()
        nameWords("Frequent flier no.") shouldBe emptySet()
        programsFor("Other-air.com", listOf(dotCom)) shouldBe emptyList()
        programsFor("example.com", listOf(dotCom)) shouldBe listOf(dotCom)
        programsFor("Air Miles", listOf(air, hotels)) shouldBe emptyList()
        programsFor(null, listOf(air)) shouldBe emptyList()
        loyaltyLine(air) shouldBe "Example Air Miles · EA123 · Gold"
        loyaltyLine(bare) shouldBe "Loyalty program 3"
    }

    @Test
    fun `lists what TripIt imported then what emails showed that it did not have`() {
        fun seen(program: String, number: String, status: String? = null) =
            FoundLoyalty(program, number, status = status, messageId = "m1", label = "Your booking", at = "2026-11-01T00:00:00Z")
        val imported = entry("Example Air Club", "Account Number" to "12345678")
        val profile = TravelProfile("u", loyalty = listOf(imported), foundLoyalty = listOf(seen("Example Air Club", "12 345 678"), seen("Sample Hotels Rewards", "777", "Gold")))
        val all = allLoyalty(profile)
        all.size shouldBe 2
        loyaltySummary(all[1]) shouldBe LoyaltySummary("Sample Hotels Rewards", "777", status = "Gold")
        all[1].fields.last() shouldBe ProfileField("From email", "Your booking")
        programsFor("Sample Hotels", all) shouldBe listOf(all[1])
        // A statement's balance joins the table.
        val statement = seen("Emerald Club", "EC 1").copy(balance = "3 credits", balanceAt = "2026-11-01T00:00:00Z")
        loyaltySummary(foundLoyaltyEntry(statement)) shouldBe LoyaltySummary("Emerald Club", "EC 1", balance = "3 credits")
    }

    @Test
    fun `brings a newer statement's balance and status to the program TripIt imported`() {
        val imported = entry("Emerald Club", "Account number" to "EC 77", "Balance" to "1", "Elite status" to "Member")
        val statement = FoundLoyalty("Emerald Club", "EC77", status = "Executive", messageId = "m1", label = "Your Emerald Club eStatement", at = "2026-11-01T00:00:00Z", balance = "3 free rental days", balanceAt = "2026-11-01T00:00:00Z", statusAt = "2026-11-01T00:00:00Z")
        val newer = allLoyalty(TravelProfile("u", loyalty = listOf(imported), foundLoyalty = listOf(statement), importedAt = "2026-06-01T00:00:00Z"))
        newer.size shouldBe 1
        loyaltySummary(newer[0]) shouldBe LoyaltySummary("Emerald Club", "EC 77", "3 free rental days", "Executive")
        newer[0].fields.last() shouldBe ProfileField("Balance from email", "Your Emerald Club eStatement")
        // The balance names the email it came from, though a later one is the label.
        val relabeled = statement.copy(label = "Your rental receipt", balanceLabel = "Your Emerald Club eStatement")
        allLoyalty(TravelProfile("u", loyalty = listOf(imported), foundLoyalty = listOf(relabeled)))[0].fields.last() shouldBe
            ProfileField("Balance from email", "Your Emerald Club eStatement")
        val older = allLoyalty(TravelProfile("u", loyalty = listOf(imported), foundLoyalty = listOf(statement), importedAt = "2026-11-20T00:00:00Z"))
        loyaltySummary(older[0]) shouldBe LoyaltySummary("Emerald Club", "EC 77", "1", "Member")
    }

    @Test
    fun `brings a statement only to the same program whatever the number`() {
        val air = entry("Example Air Club", "Account number" to "123", "Balance" to "10")
        val hotel = FoundLoyalty("Sample Hotels Rewards", "123", messageId = "m1", at = "2026-11-01T00:00:00Z", balance = "999", balanceAt = "2026-11-01T00:00:00Z")
        val all = allLoyalty(TravelProfile("u", loyalty = listOf(air), foundLoyalty = listOf(hotel)))
        loyaltySummary(all[0]).balance shouldBe "10"
        loyaltySummary(all[1]) shouldBe LoyaltySummary("Sample Hotels Rewards", "123", "999")
    }

    private fun seen(program: String, number: String, person: String? = null) = FoundLoyalty(program, number, messageId = "m1", at = "2026-11-01T00:00:00Z", person = person)
    private val tripIt = entry("Example Air", "Account number" to "111222333")
    private fun people(entries: List<ProfileEntry>) = loyaltyByPerson(entries).map { g -> (g.person ?: "You") to g.entries.map { loyaltySummary(it).account } }

    @Test
    fun `groups the owner's first then each person an email named and says whose on a booking's line`() {
        val found = listOf(seen("SkyMiles", "9168692292", "Sam Ward"), seen("SkyMiles", "9099656416"), seen("SkyMiles", "9368712163", "Alex Ward"))
        val all = allLoyalty(TravelProfile("u1", loyalty = listOf(tripIt), foundLoyalty = found))
        people(all) shouldBe listOf(
            "You" to listOf("111222333", "9099656416"),
            "Alex Ward" to listOf("9368712163"),
            "Sam Ward" to listOf("9168692292"),
        )
        all.map(::loyaltyLine).contains("SkyMiles · 9168692292 · Sam Ward") shouldBe true
    }

    @Test
    fun `follows the owner's word over the email's for TripIt's programs too`() {
        val found = listOf(seen("SkyMiles", "9168692292", "Sam Ward"))
        var said = withLoyaltyPerson(emptyList(), "SkyMiles", "9168692292", null)
        said = withLoyaltyPerson(said, "Example Air", "111 222 333", " Sam Ward ")
        said.size shouldBe 2
        people(allLoyalty(TravelProfile("u1", loyalty = listOf(tripIt), foundLoyalty = found, loyaltyPeople = said))) shouldBe listOf(
            "You" to listOf("9168692292"),
            "Sam Ward" to listOf("111222333"),
        )
        withLoyaltyPerson(said, "SkyMiles", "9168692292", "Alex Ward").filter { it.number == "9168692292" } shouldBe
            listOf(LoyaltyPerson("SkyMiles", "9168692292", "Alex Ward"))
    }

    @Test
    fun `shows a number TripIt has written with padding zeros once`() {
        val tripIt = entry("Emirates Skywards", "Account number" to "EK557710580")
        allLoyalty(TravelProfile("u1", loyalty = listOf(tripIt), foundLoyalty = listOf(seen("Emirates Skywards", "EK00557710580")))).size shouldBe 1
    }

    @Test
    fun `shows a number TripIt has under a program name with nothing distinctive once`() {
        val qatar = entry("QATAR AIRWAYS", "Account number" to "820342520")
        allLoyalty(TravelProfile("u1", loyalty = listOf(qatar), foundLoyalty = listOf(seen("Privilege Club", "820342520")))).map { it.title } shouldBe listOf("QATAR AIRWAYS")
    }

    @Test
    fun `tells a balance read as a number from a membership number`() {
        listOf("9,600 Points", "XXXXX8400", "1200 miles", "UA-XXXXX166", "Gold").map(::isMembershipNumber) shouldBe listOf(false, true, false, true, false)
    }

    @Test
    fun `shows every spelling of someone as one person and the owner's own as theirs`() {
        val travelers = listOf(
            Person("me", "Mikel Ward", aliases = listOf("Mikel Bradlee Ward", "Michael Ward"), me = true, bookings = 9, direct = 9),
            Person("jess", "Jessica Ward", aliases = listOf("Jessica Wilkes"), bookings = 4),
        )
        fun found(number: String, person: String) = FoundLoyalty("Example Air", number, messageId = "m$number", at = "2027-01-01T00:00:00Z", person = person)
        val profile = TravelProfile(
            "u1",
            foundLoyalty = listOf(found("1", "Mikelbradlee Ward"), found("2", "Mikelb Ward"), found("3", "Michael Ward"), found("4", "Jessica Wilkes"), found("5", "Jessica Ward"), found("6", "Alex Sample")),
            // The owner said this one is "Jessica Wilkes"'s.
            loyaltyPeople = listOf(LoyaltyPerson("Example Air", "6", "Jessica Wilkes")),
        )
        people(allLoyalty(profile, travelers)) shouldBe listOf("You" to listOf("1", "2", "3"), "Jessica Ward" to listOf("4", "5", "6"))
        people(allLoyalty(profile)).map { it.first } shouldBe listOf("Jessica Ward", "Jessica Wilkes", "Michael Ward", "Mikelb Ward", "Mikelbradlee Ward")
    }

    @Test
    fun `finds the email-extracted membership behind a unified loyalty entry`() {
        val found = FoundLoyalty("Emirates Skywards", "EK00557710580", messageId = "m1", at = "2026-11-01T00:00:00Z")
        val imported = entry("Emirates Skywards", "Account number" to "EK557710580")
        val other = entry("Sample Hotels", "Account number" to "SH-9")
        val noAccount = entry("Bare Program", "Status" to "Silver")
        findFoundLoyalty(listOf(found), imported) shouldBe found
        findFoundLoyalty(listOf(found), other) shouldBe null
        findFoundLoyalty(listOf(found), noAccount) shouldBe null
    }

    @Test
    fun `keeps distinct savedIndex for numberless memberships with the same program name`() {
        val profile = TravelProfile(
            "u1",
            loyalty = listOf(
                entry("Example Air", "Belongs to" to "Alex Example", "Status" to "Silver"),
                entry("Example Air", "Status" to "Gold"),
            ),
            foundLoyalty = listOf(FoundLoyalty("Other Air", "OA99", messageId = "m1", at = "2026-11-01T00:00:00Z")),
        )
        val resolved = allLoyaltyWithSource(profile)
        // Owner's entry (originally index 1) sorts ahead of Alex's (originally index 0); found-only gets -1.
        resolved.map { loyaltySummary(it.entry).person to it.savedIndex } shouldBe listOf(
            null to 1,
            null to -1,
            "Alex Example" to 0,
        )
    }

    @Test
    fun `deduplicates masked airline-prefixed tier-suffixed and aliased foundLoyalty entries`() {
        val at = "2026-11-01T00:00:00Z"
        val profile = TravelProfile(
            "u1",
            foundLoyalty = listOf(
                FoundLoyalty("Qatar Airways Privilege Club", "QR-XXXXX3456/TIER", messageId = "m1", at = at),
                FoundLoyalty("Qatar Airways", "555123456", balance = "12,000 Avios", balanceAt = at, status = "Silver", statusAt = at, messageId = "m2", at = at),
                FoundLoyalty("United MileagePlus", "XXXXX901", messageId = "m3", at = at),
                FoundLoyalty("United Airlines MileagePlus", "UA-*****901", messageId = "m4", at = at),
                FoundLoyalty("AAdvantage", "AA-***7B8C", messageId = "m5", at = at),
                FoundLoyalty("American Airlines", "12A7B8C", messageId = "m6", at = at),
                FoundLoyalty("Airpoints", "NZ-7776665", messageId = "m7", at = at),
                FoundLoyalty("Air New Zealand", "7776665", messageId = "m8", at = at),
                FoundLoyalty("SkyMiles", "DL-9998887", messageId = "m9", at = at),
                FoundLoyalty("Delta Air Lines", "9998887", messageId = "m10", at = at),
                FoundLoyalty("Mileage Plan", "AS-3332221", messageId = "m11", at = at),
                FoundLoyalty("Alaska Airlines", "3332221", messageId = "m12", at = at),
                FoundLoyalty("Qantas Frequent Flyer", "QF-4445556", messageId = "m13", at = at),
                FoundLoyalty("Qantas", "4445556", messageId = "m14", at = at),
                FoundLoyalty("United MileagePlus", "XXXXX444", person = "Alex Example", messageId = "m15", at = at),
                FoundLoyalty("United MileagePlus", "*****444", person = "Sam Example", messageId = "m16", at = at),
                FoundLoyalty("Example Air", "AB12345", messageId = "m17", at = at),
                FoundLoyalty("Example Air", "CD12345", messageId = "m18", at = at),
            ),
        )
        val summaries = allLoyalty(profile).map(::loyaltySummary)
        summaries.size shouldBe 11
        summaries[0].title shouldBe "Qatar Airways Privilege Club"
        summaries[0].account shouldBe "555123456"
        summaries[0].balance shouldBe "12,000 Avios"
        summaries[0].status shouldBe "Silver"
        summaries[1].title shouldBe "United Airlines MileagePlus"
        summaries[1].account shouldBe "XXXXX901"
        summaries[2].account shouldBe "12A7B8C"
        summaries[3].account shouldBe "7776665"
        summaries[4].account shouldBe "9998887"
        summaries[5].account shouldBe "3332221"
        summaries[6].account shouldBe "4445556"
        summaries.subList(7, 9).map { it.account } shouldBe listOf("AB12345", "CD12345")
        summaries.drop(9).map { it.person }.sortedBy { it } shouldBe listOf("Alex Example", "Sam Example")

        val mergedX = allLoyalty(
            TravelProfile(
                "u1",
                foundLoyalty = listOf(
                    FoundLoyalty("United MileagePlus", "XXXXX901", messageId = "x1", at = at),
                    FoundLoyalty("United Airlines", "12345901", messageId = "x2", at = at),
                ),
            ),
        )
        mergedX.size shouldBe 1
        loyaltySummary(mergedX[0]).account shouldBe "12345901"

        val entries = allLoyalty(profile)
        programsFor("Alaska Airlines", entries).map { loyaltySummary(it).account } shouldBe listOf("3332221")

        val samCard = entries.first { loyaltySummary(it).person == "Sam Example" }
        findFoundLoyalty(profile.foundLoyalty, samCard)?.person shouldBe "Sam Example"

        val reassigned = withLoyaltyPerson(emptyList(), "United MileagePlus", "*****444", "Pat Example")
        val afterOverride = allLoyalty(profile.copy(loyaltyPeople = reassigned)).map(::loyaltySummary)
        afterOverride.first { it.account == "XXXXX444" }.person shouldBe "Alex Example"
        afterOverride.first { it.account == "*****444" }.person shouldBe "Pat Example"

        val importedSplit = allLoyalty(
            TravelProfile(
                "u1",
                loyalty = listOf(entry("United MileagePlus", "Account number" to "12345444", "Belongs to" to "Alex Example")),
                foundLoyalty = listOf(FoundLoyalty("United MileagePlus", "*****444", person = "Sam Example", balance = "5,000 miles", balanceAt = at, messageId = "s1", at = at)),
            ),
        ).map(::loyaltySummary)
        importedSplit.size shouldBe 2
        importedSplit.first { it.account == "12345444" }.person shouldBe "Alex Example"
        importedSplit.first { it.account == "*****444" }.person shouldBe "Sam Example"

        val diffAirlines = allLoyalty(
            TravelProfile(
                "u1",
                loyalty = listOf(entry("BA", "Account number" to "BA-*****444")),
                foundLoyalty = listOf(FoundLoyalty("United MileagePlus", "UA-*****444", messageId = "u1", at = at)),
            ),
        )
        diffAirlines.size shouldBe 2

        val mergedOverride = allLoyalty(
            TravelProfile(
                "u1",
                foundLoyalty = listOf(
                    FoundLoyalty("United MileagePlus", "XXXXX901", messageId = "o1", at = at),
                    FoundLoyalty("United MileagePlus", "*****901", messageId = "o2", at = at),
                ),
                loyaltyPeople = listOf(LoyaltyPerson("United MileagePlus", "*****901", "Pat Example")),
            ),
        ).map(::loyaltySummary)
        mergedOverride.size shouldBe 1
        mergedOverride[0].person shouldBe "Pat Example"
    }
}
