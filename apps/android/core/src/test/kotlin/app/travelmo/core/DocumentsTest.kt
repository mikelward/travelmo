package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

private fun entry(title: String, vararg fields: Pair<String, String>) = ProfileEntry(title, fields.map { ProfileField(it.first, it.second) })

class DocumentsTest {
    @Test
    fun `reads the usual spellings of a date and leaves ambiguous ones alone`() {
        for ((value, date) in listOf("2031-05-06" to "2031-05-06", "2031-05-06T00:00:00Z" to "2031-05-06", "6 May 2031" to "2031-05-06", "6th May, 2031" to "2031-05-06", "May 6, 2031" to "2031-05-06", "Sept 6 2031" to "2031-09-06")) {
            parseDocumentDate(value) shouldBe date
        }
        for (value in listOf("06/05/2031", "2031-02-30", "soon", "31 Foo 2031")) parseDocumentDate(value).shouldBeNull()
    }

    @Test
    fun `finds expiry dates, kinds and countries by their labels`() {
        travelDocuments(
            listOf(
                entry("Travel document: Passport", "Number" to "X1234567", "Expiration date" to "2031-05-06", "Issuing country" to "gb"),
                entry("Travel document 2", "Type" to "Visa", "Valid until" to "1 Jan 2027", "Country" to "US"),
                entry("Trusted traveler", "Card › Expiry" to "March 3, 2028"),
                entry("Ann Example", "Home city" to "Exampleton"),
            ),
        ) shouldBe listOf(
            TravelDocument("Travel document: Passport", DocumentKind.PASSPORT, "2031-05-06", "GB"),
            TravelDocument("Travel document 2", DocumentKind.VISA, "2027-01-01", "US"),
            TravelDocument("Trusted traveler", DocumentKind.OTHER, "2028-03-03"),
        )
        // Never a visa's country from its holder's nationality, nor a passport's from its country of birth; names read too.
        val (visa, bare, passport) = travelDocuments(
            listOf(
                entry("Visa", "Nationality" to "GB", "Country" to "US", "Expiry" to "2027-01-01"),
                entry("Visa", "Nationality" to "GB", "Expiry" to "2027-01-01"),
                entry("Passport", "Nationality" to "GB", "Expiry" to "2030-01-01"),
            ),
        )
        visa.country shouldBe "US"
        bare.country.shouldBeNull()
        passport.country shouldBe "GB"
        val (named, namedVisa) = travelDocuments(
            listOf(
                entry("Passport: Ann Example", "Country of birth" to "New Zealand", "Nationality" to "Australia", "Date expire" to "2031-05-06"),
                entry("Visa", "Country" to "United States", "Expiry" to "2027-01-01"),
            ),
        )
        named.country shouldBe "AU"
        namedVisa.country shouldBe "US"
        countryCodeOf("U.S.A.") shouldBe "US"
        countryCodeOf("The Netherlands") shouldBe "NL"
        countryCodeOf("nowhere").shouldBeNull()
    }

    private val passport = TravelDocument("Passport", DocumentKind.PASSPORT, "2027-03-01", "GB")
    private val visa = TravelDocument("US visa", DocumentKind.VISA, "2026-12-20", "US")
    private val trip = Trip("t", "Example", "2026-12-12", "2026-12-24", "me", sharedWith = listOf("partner@example.com"))
    private val today = "2026-11-01"
    private val abroad = TripPlaces(setOf("GB", "US"), complete = true)

    @Test
    fun `warns of what runs out before or too soon after a trip, and only when the trip may need it`() {
        documentWarnings(listOf(passport), trip, today, abroad) shouldBe listOf(DocumentWarning(passport, WarningWhen.SOON, 67))
        documentWarnings(listOf(visa), trip, today, abroad) shouldBe listOf(DocumentWarning(visa, WarningWhen.BEFORE, -4))
        documentWarnings(listOf(passport.copy(expires = "2026-10-01")), trip, today, abroad).single().`when` shouldBe WarningWhen.BEFORE
        documentWarnings(listOf(passport.copy(expires = "2027-06-24"), visa.copy(expires = "2030-01-01")), trip, today, abroad) shouldBe emptyList()
        // Only a passport is margined.
        documentWarnings(listOf(visa.copy(expires = "2027-01-01")), trip, today, abroad) shouldBe emptyList()
        // A trip known to stay home needs no passport, and no visa for elsewhere.
        documentWarnings(listOf(passport, visa), trip, today, TripPlaces(setOf("GB"), complete = true)) shouldBe emptyList()
        // Not all known: warn.
        documentWarnings(listOf(passport, visa), trip, today, TripPlaces(setOf("GB"), complete = false)).map { it.document.title } shouldBe listOf("Passport", "US visa")
        documentWarnings(listOf(passport), trip, today).size shouldBe 1
        documentWarnings(listOf(passport), trip.copy(start = "2026-01-01", end = "2026-01-05"), today, abroad) shouldBe emptyList()
    }

    private fun profile(ownerUid: String, expires: String, ownerEmail: String? = null) =
        TravelProfile(ownerUid, ownerEmail, documents = listOf(entry("Passport", "Expiration date" to expires)))

    @Test
    fun `checks the viewer's documents and those of people on the trip, not others'`() {
        val people = peopleDocuments(
            profile("me", "2027-02-01"),
            listOf(profile("p", "2026-12-20", "partner@example.com"), profile("s", "2026-12-01", "someone@example.com"), profile("me", "2026-12-01")),
            "me",
        )
        tripWarnings(people, trip, null, today).map { it.person.uid to it.warning.`when` } shouldBe listOf("me" to WarningWhen.SOON, "p" to WarningWhen.BEFORE)
        val others = peopleDocuments(null, listOf(profile("me-too", "2026-12-20", "owner@example.com")), "viewer")
        tripWarnings(others, trip.copy(ownerUid = "me-too"), null, today).size shouldBe 1
    }

    @Test
    fun `words a warning as the web does`() {
        val me = PersonDocuments("me", null, true, listOf(passport))
        warningText(PersonWarning(me, DocumentWarning(passport, WarningWhen.SOON, 67)), today) shouldBe
            "Your passport expires on 1 Mar 2027, 2 months after this trip ends; many countries require six months’ validity."
        warningText(PersonWarning(me, DocumentWarning(passport, WarningWhen.SOON, 19)), today) shouldBe
            "Your passport expires on 1 Mar 2027, 19 days after this trip ends; many countries require six months’ validity."
        val partner = PersonDocuments("p", "partner@example.com", false, listOf(visa))
        warningText(PersonWarning(partner, DocumentWarning(visa, WarningWhen.BEFORE, -4)), today) shouldBe
            "partner@example.com’s United States visa expires on 20 Dec 2026, before this trip ends."
        warningText(PersonWarning(me, DocumentWarning(passport.copy(expires = "2026-10-01"), WarningWhen.BEFORE, -84)), today) shouldBe
            "Your passport expired on 1 Oct 2026."
    }

    @Test
    fun `lists each document once, for the earliest-ending trip, named in the text`() {
        val me = PersonDocuments("me", null, true, listOf(passport))
        val soon = { days: Long -> PersonWarning(me, DocumentWarning(passport, WarningWhen.SOON, days)) }
        val dublin = Trip("Dublin", "Dublin", "2026-11-28", "2026-12-02", "me")
        val liverpool = Trip("Liverpool", "Liverpool", "2026-12-12", "2026-12-14", "me")
        val listed = listWarnings(mapOf("Liverpool" to listOf(soon(49)), "Dublin" to listOf(soon(61))), listOf(liverpool, dublin))
        listed.map { it.trip.id } shouldBe listOf("Dublin")
        warningText(listed.single().warning, today, listed.single().trip.title) shouldBe
            "Your passport expires on 1 Mar 2027, 2 months after Dublin ends; many countries require six months’ validity."
        listWarnings(emptyMap(), listOf(dublin)) shouldBe emptyList()
    }

    @Test
    fun `keeps two visas apart that share a title and an expiry but not a country`() {
        val me = PersonDocuments("me", null, true, emptyList())
        val visa = { country: String -> PersonWarning(me, DocumentWarning(TravelDocument("Visa: Ann", DocumentKind.VISA, "2027-01-01", country), WarningWhen.BEFORE, -5)) }
        val dublin = Trip("Dublin", "Dublin", "2026-11-28", "2026-12-02", "me")
        listWarnings(mapOf("Dublin" to listOf(visa("US"), visa("IN"))), listOf(dublin)).map { it.warning.warning.document.country } shouldBe listOf("US", "IN")
    }

    @Test
    fun `a trip's countries come from its bookings and their airports`() {
        airportPlace("MAN")!!.country shouldBe "GB"
        airportPlace("DXB")!!.country shouldBe "AE"
        airportPlace("ZZZ").shouldBeNull()
        val flight = Segment("f", "t", SegmentType.FLIGHT, "XX 100", "2026-12-13T09:00:00+05:00", origin = Place("Manchester", code = "MAN"), destination = Place("Dubai", code = "DXB"))
        val stay = Segment("s", "t", SegmentType.LODGING, "Hotel", "2026-12-13T15:00:00+04:00", destination = Place("Hotel", country = "ae"))
        tripPlaces(listOf(flight, stay)) shouldBe TripPlaces(setOf("GB", "AE"), complete = true)
        // A station code is not an airport code; a journey missing an end is incomplete.
        val train = Segment("r", "t", SegmentType.TRAIN, "Avanti", "2026-12-12T09:07:00+00:00", origin = Place("Euston", code = "EUS"))
        tripPlaces(listOf(train)) shouldBe TripPlaces(emptySet(), complete = false)
        tripPlaces(emptyList()) shouldBe TripPlaces(emptySet(), complete = false)
    }
}
