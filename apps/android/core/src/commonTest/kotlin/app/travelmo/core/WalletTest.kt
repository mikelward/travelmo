package app.travelmo.core

import kotlin.test.Test
import kotlin.test.assertEquals

class WalletTest {
    @Test
    fun buildsAndParsesPassportEntry() {
        val entry = buildDocumentEntry(
            DocumentInput(
                type = DocumentInputType.PASSPORT,
                title = "",
                country = "United States",
                number = "P12345678",
                expires = "2031-05-06",
                issued = "2021-05-06",
                notes = "Biometric",
            ),
        )
        assertEquals("United States Passport", entry.title)
        assertEquals(
            listOf(TravelDocument("United States Passport", DocumentKind.PASSPORT, "2031-05-06", "US")),
            travelDocuments(listOf(entry)),
        )
        assertEquals(
            DocumentInput(
                type = DocumentInputType.PASSPORT,
                title = "United States Passport",
                country = "United States",
                number = "P12345678",
                expires = "2031-05-06",
                issued = "2021-05-06",
                notes = "Biometric",
            ),
            parseDocumentEntry(entry),
        )
    }

    @Test
    fun readsVisaCountryIndependentlyOfNationalityAndPreservesImportedFields() {
        val imported = ProfileEntry(
            title = "US Visa",
            fields = listOf(
                ProfileField("Document type", "Visa"),
                ProfileField("Full name", "Sam Example"),
                ProfileField("Nationality", "GB"),
                ProfileField("Country", "US"),
                ProfileField("Country of birth", "GB"),
                ProfileField("Number", "V123"),
                ProfileField("Expiration date", "2029-04-01"),
            ),
        )
        val parsed = parseDocumentEntry(imported)
        assertEquals(DocumentInputType.VISA, parsed.type)
        assertEquals("US", parsed.country)
        val edited = buildDocumentEntry(parsed.copy(title = "US B1/B2 Visa"), existing = imported)
        assertEquals(listOf(TravelDocument("US B1/B2 Visa", DocumentKind.VISA, "2029-04-01", "US")), travelDocuments(listOf(edited)))
        assertEquals(true, ProfileField("Full name", "Sam Example") in edited.fields)
        assertEquals(true, ProfileField("Nationality", "GB") in edited.fields)
        assertEquals(true, ProfileField("Country of birth", "GB") in edited.fields)
        val sc = buildDocumentEntry(DocumentInput(DocumentInputType.SHARE_CODE, "UK share code", country = "GB", number = "ABC 12D 3EF"))
        assertEquals(DocumentInputType.SHARE_CODE, parseDocumentEntry(sc).type)
    }

    @Test
    fun buildsAndParsesLoyaltyEntryPreservingFieldsAndReconcilingOwner() {
        val imported = ProfileEntry(
            title = "Qatar Airways Privilege Club",
            fields = listOf(
                ProfileField("Account number", "820342520"),
                ProfileField("Elite status", "Silver"),
                ProfileField("Elite next status", "Gold"),
                ProfileField("Nickname", "Main"),
            ),
        )
        val parsed = parseLoyaltyEntry(imported)
        val edited = buildLoyaltyEntry(parsed.copy(status = "Gold", balance = "45000", person = "Alex"), existing = imported)
        assertEquals(
            LoyaltySummary("Qatar Airways Privilege Club", account = "820342520", balance = "45,000", status = "Gold", nextStatus = "Gold", person = "Alex"),
            loyaltySummary(edited),
        )
        assertEquals(true, ProfileField("Nickname", "Main") in edited.fields)

        val manual = buildLoyaltyEntry(LoyaltyInput("Example Air", number = "EA123", person = "Alex"))
        assertEquals("Alex", loyaltySummary(allLoyalty(TravelProfile("u1", loyalty = listOf(manual)))[0]).person)
        assertEquals(
            "Sam",
            loyaltySummary(allLoyalty(TravelProfile("u1", loyalty = listOf(manual), loyaltyPeople = listOf(LoyaltyPerson("Example Air", "EA123", "Sam"))))[0]).person,
        )
        assertEquals(
            null,
            loyaltySummary(allLoyalty(TravelProfile("u1", loyalty = listOf(manual), loyaltyPeople = listOf(LoyaltyPerson("Example Air", "EA123", null))))[0]).person,
        )
    }

    @Test
    fun clearsNestedSourcedLoyaltyValuesWhilePreservingSubAccountData() {
        val imported = ProfileEntry(
            title = "Example Air",
            fields = listOf(
                ProfileField("Account › Number", "EA123"),
                ProfileField("Account › Balance", "5000"),
                ProfileField("Partner › Nickname", "Family pool"),
            ),
        )
        val parsed = parseLoyaltyEntry(imported)
        assertEquals("EA123", parsed.number)
        assertEquals("5,000", parsed.balance)
        val cleared = buildLoyaltyEntry(parsed.copy(number = "", balance = ""), existing = imported)
        assertEquals(null, loyaltySummary(cleared).account)
        assertEquals(null, loyaltySummary(cleared).balance)
        assertEquals(true, ProfileField("Partner › Nickname", "Family pool") in cleared.fields)
    }

    @Test
    fun mergesExistingAndImportedEntries() {
        val manual = buildDocumentEntry(
            DocumentInput(DocumentInputType.PASSPORT, "US Passport", number = "P1", expires = "2031-05-06", notes = "Renewed"),
        )
        val importedMatchingManual = ProfileEntry(
            title = "US Passport",
            fields = listOf(ProfileField("Number", "P1"), ProfileField("Expiration date", "2028-01-01")),
        )
        val oldVisa = ProfileEntry(
            title = "UK Visa",
            fields = listOf(ProfileField("Number", "V1"), ProfileField("Expiration date", "2027-01-01")),
        )
        val newVisa = ProfileEntry(
            title = "UK Visa",
            fields = listOf(ProfileField("Number", "V1"), ProfileField("Expiration date", "2029-01-01")),
        )
        val importedOnly = ProfileEntry(
            title = "Global Entry",
            fields = listOf(ProfileField("Number", "K1")),
        )

        val merged = mergeProfileEntries(listOf(manual, oldVisa), listOf(importedMatchingManual, newVisa, importedOnly))
        assertEquals(listOf("US Passport", "UK Visa", "Global Entry"), merged.map { it.title })
        assertEquals(true, merged[0].manual)
        assertEquals("2031-05-06", parseDocumentEntry(merged[0]).expires)
        assertEquals("Renewed", parseDocumentEntry(merged[0]).notes)
        assertEquals("2029-01-01", parseDocumentEntry(merged[1]).expires)
    }

    @Test
    fun findsUpcomingBoardingFlightsWithinWindow() {
        val nowMs = instantMillis("2026-11-28T12:00:00Z")
        val t1 = Trip("t1", "Trip t1", "2026-11-28", "2026-12-05", "u1", emptyList())
        val tCancelled = Trip("t2", "Trip t2", "2026-11-28", "2026-12-05", "u1", emptyList(), cancelledAt = "2026-11-20T00:00:00Z")
        fun seg(id: String, tripId: String, start: String, type: SegmentType = SegmentType.FLIGHT, cancelledAt: String? = null) =
            Segment(id = id, tripId = tripId, type = type, title = "Flight $id", start = start, cancelledAt = cancelledAt)

        val byTrip = mapOf(
            "t1" to listOf(
                seg("too-old", "t1", "2026-11-28T08:00:00Z"),
                seg("recent", "t1", "2026-11-28T10:30:00Z"),
                seg("later", "t1", "2026-11-29T18:00:00Z"),
                seg("soon", "t1", "2026-11-28T15:00:00Z"),
                seg("too-far", "t1", "2026-12-01T12:00:00Z"),
                seg("cancelled", "t1", "2026-11-28T16:00:00Z", cancelledAt = "2026-11-27T00:00:00Z"),
                seg("hotel", "t1", "2026-11-28T14:00:00Z", type = SegmentType.LODGING),
            ),
            "t2" to listOf(seg("on-cancelled-trip", "t2", "2026-11-28T14:00:00Z")),
        )

        val upcoming = upcomingBoardingFlights(listOf(t1, tCancelled), byTrip, nowMs)
        assertEquals(listOf("recent", "soon", "later"), upcoming.map { it.segment.id })
    }

    @Test
    fun explicitDocumentTypeOverridesTitleWords() {
        val edited = buildDocumentEntry(
            DocumentInput(
                type = DocumentInputType.VISA,
                title = "US Passport",
                country = "Japan",
                expires = "2028-06-01",
            ),
        )
        assertEquals(DocumentInputType.VISA, parseDocumentEntry(edited).type)
        assertEquals(DocumentKind.VISA, travelDocuments(listOf(edited)).first().kind)
    }

    @Test
    fun manualLoyaltyEditOverridesOlderEmailStatementsPerMembership() {
        val edited = buildLoyaltyEntry(
            LoyaltyInput(program = "Delta SkyMiles", number = "987654", status = "Gold", balance = "2,000 miles"),
            updatedAt = "2026-11-28T12:00:00Z",
        )
        val unedited = ProfileEntry(
            title = "British Airways Club",
            fields = listOf(
                ProfileField("Account number", "112233"),
                ProfileField("Status", "Bronze"),
                ProfileField("Balance", "500 Avios"),
            ),
        )
        val entries = allLoyalty(
            TravelProfile(
                ownerUid = "u1",
                loyalty = listOf(edited, unedited),
                foundLoyalty = listOf(
                    FoundLoyalty(
                        program = "Delta SkyMiles",
                        number = "987654",
                        status = "Silver",
                        statusAt = "2026-11-20T00:00:00Z",
                        balance = "1,000 miles",
                        balanceAt = "2026-11-20T00:00:00Z",
                        messageId = "m1",
                        at = "2026-11-20T00:00:00Z",
                    ),
                    FoundLoyalty(
                        program = "British Airways Club",
                        number = "112233",
                        status = "Silver",
                        statusAt = "2026-11-20T00:00:00Z",
                        balance = "12,000 Avios",
                        balanceAt = "2026-11-20T00:00:00Z",
                        messageId = "m2",
                        at = "2026-11-20T00:00:00Z",
                    ),
                ),
                importedAt = "2026-11-01T00:00:00Z",
            ),
        )
        val delta = loyaltySummary(entries.first { it.title == "Delta SkyMiles" })
        assertEquals("Gold", delta.status)
        assertEquals("2,000 miles", delta.balance)

        val ba = loyaltySummary(entries.first { it.title == "British Airways Club" })
        assertEquals("Silver", ba.status)
        assertEquals("12,000 Avios", ba.balance)
    }

    @Test
    fun unrelatedLaterImportDoesNotAgeRetainedManualMembership() {
        val manual = buildLoyaltyEntry(
            LoyaltyInput(program = "Delta SkyMiles", number = "987654", status = "Silver", balance = "100 miles"),
            updatedAt = "2026-11-01T00:00:00Z",
        )
        val entries = allLoyalty(
            TravelProfile(
                ownerUid = "u1",
                loyalty = listOf(manual),
                foundLoyalty = listOf(
                    FoundLoyalty(
                        program = "Delta SkyMiles",
                        number = "987654",
                        status = "Gold",
                        statusAt = "2026-11-20T00:00:00Z",
                        balance = "200 miles",
                        balanceAt = "2026-11-20T00:00:00Z",
                        messageId = "m1",
                        at = "2026-11-20T00:00:00Z",
                    ),
                ),
                importedAt = "2026-11-28T00:00:00Z",
            ),
        )
        val delta = loyaltySummary(entries.first())
        assertEquals("Gold", delta.status)
        assertEquals("200 miles", delta.balance)
    }

    @Test
    fun preservesDistinctNumberlessDocumentsWithSameTitle() {
        val usVisa = buildDocumentEntry(DocumentInput(DocumentInputType.VISA, "Visa", country = "United States", expires = "2028-01-01"))
        val inVisa = buildDocumentEntry(DocumentInput(DocumentInputType.VISA, "Visa", country = "India", expires = "2029-01-01"))
        val merged = mergeProfileEntries(listOf(usVisa, inVisa), emptyList())
        assertEquals(2, merged.size)
        assertEquals(listOf("United States", "India"), merged.map { parseDocumentEntry(it).country })
    }
}
