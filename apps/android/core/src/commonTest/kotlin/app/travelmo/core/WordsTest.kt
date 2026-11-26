package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/words.test.ts: what already says something says it as whole words.
class WordsTest {
    @Test
    fun `are letters and digits with case and accents aside`() {
        wordsOf("Göteborg C, 12:05") shouldBe listOf("goteborg", "c", "12", "5")
        hasWords("Room 12345", "1234") shouldBe false
        hasWords("Room 1234, sea view", "1234") shouldBe true
        hasWords("Romeo Hotel", "Rome") shouldBe false
        hasWords("Hotel Roma Centro", "roma centro") shouldBe true
        hasWords("Hotel Centro Roma", "roma centro") shouldBe false
        hasWordStarts("Paris and BA", "par ba") shouldBe true
        hasWordStarts("Cuba", "ba") shouldBe false
        hasWordStarts("America/New_York", "new y") shouldBe true
    }

    @Test
    fun `are numbers however a source pads them with zeros`() {
        hasWords("Gate 01", "Gate 1") shouldBe true
        hasWords("Gate 1", "gate 001") shouldBe true
        hasWords("Flight UA0122", "UA122") shouldBe true
        hasWords("Room 120034", "12034") shouldBe false
        hasWords("Platform 0", "0") shouldBe true
        hasWords("Gate 10", "Gate 1") shouldBe false
        hasWordStarts("Seat 07A", "7a") shouldBe true
        val booking = { ref: String -> mapOf("type" to "lodging", "title" to "Cove", "start" to "2026-12-12T15:00:00+00:00", "confirmation" to ref, "gmailMessageIds" to listOf("m")) }
        // A reference one booking pads with zeros is no other reference.
        mergedBookingDocument(booking("0708843612"), booking("708843612"), "b", "2026-11-25T10:00:00Z")["notes"] shouldBe null
    }

    @Test
    fun `keeps a merged booking's note another note only contains inside a word`() {
        val booking = { notes: String -> mapOf("type" to "car_rental", "title" to "Avis", "start" to "2026-11-24T17:30:00-05:00", "notes" to notes, "gmailMessageIds" to listOf("m")) }
        mergedBookingDocument(booking("Gate 12"), booking("Gate 1"), "b", "2026-11-25T10:00:00Z")["notes"] shouldBe "Gate 12\nGate 1"
        mergedBookingDocument(booking("Gate 1, level 2"), booking("Gate 1"), "b", "2026-11-25T10:00:00Z")["notes"] shouldBe "Gate 1, level 2"
    }

    @Test
    fun `adds a town a place's name only contains inside a word`() {
        directionsQuery(Place("Romeo Hotel", city = "Rome")) shouldBe "Romeo Hotel, Rome"
        directionsQuery(Place("Hotel Rome Centre", city = "Rome")) shouldBe "Hotel Rome Centre"
    }

    @Test
    fun `finds a review record by the starts of its words`() {
        val record = ParsedRecord("m", "not_booking", "2026-10-30T09:00:00Z", subject = "Your booking at Cove", from = "Cove <hello@cove.example>")
        matchesKeyword(record, "book cove") shouldBe true
        matchesKeyword(record, "ook") shouldBe false
    }

    @Test
    fun `knows a passport or visa by the word not by letters inside a name`() {
        travelDocuments(
            listOf(
                ProfileEntry("Visalia library card", listOf(ProfileField("Expiry", "2030-01-01"))),
                ProfileEntry("Visas", listOf(ProfileField("Expiry", "2030-01-01"))),
                ProfileEntry("ePassport", listOf(ProfileField("Expiry", "2030-01-01"))),
                ProfileEntry("Travel document", listOf(ProfileField("Type", "e-Visa"), ProfileField("Expiry", "2030-01-01"))),
            ),
        ).map { it.kind } shouldBe listOf(DocumentKind.OTHER, DocumentKind.VISA, DocumentKind.PASSPORT, DocumentKind.VISA)
        travelDocuments(
            listOf(ProfileEntry("Passport", listOf(ProfileField("Birthplace country", "FR"), ProfileField("Issuing country", "GB"), ProfileField("Expiry", "2030-01-01")))),
        ).single().country shouldBe "GB"
    }
}
