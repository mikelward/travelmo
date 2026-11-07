package app.travelmo.data

import app.travelmo.core.Place
import app.travelmo.core.PlaceDraft
import app.travelmo.core.ProfileEntry
import app.travelmo.core.ProfileField
import app.travelmo.core.SegmentDraft
import app.travelmo.core.SegmentType
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class DocumentsTest {
    @Test
    fun `reads a trip as the web app writes it`() {
        val trip = tripFromDocument(
            "t1",
            mapOf("title" to "Liverpool", "start" to "2026-12-12", "end" to "2026-12-14", "ownerUid" to "u1", "sharedWith" to listOf("partner@example.com"), "createdAt" to "x", "updatedAt" to "y"),
        )!!
        trip.title shouldBe "Liverpool"
        trip.sharedWith shouldBe listOf("partner@example.com")
        trip.deleting shouldBe false
        tripFromDocument("t2", mapOf("title" to "No dates")).shouldBeNull()
    }

    @Test
    fun `reads a segment with its places, verdict and sources, and drops one it cannot place`() {
        val segment = segmentFromDocument(
            "s1",
            "t1",
            mapOf(
                "type" to "train", "title" to "Avanti to Liverpool", "start" to "2026-12-12T09:07:00+00:00", "end" to "2026-12-12T11:25:00+00:00",
                "provider" to "Avanti West Coast", "confirmation" to "ABC123",
                "origin" to mapOf("name" to "London Euston", "code" to "EUS"), "destination" to mapOf("name" to "Liverpool Lime Street", "code" to "LIV", "country" to "GB"),
                "rating" to 4L, "favorite" to true, "sender" to "avantiwestcoast.example",
                "sources" to listOf(mapOf("kind" to "gmail", "id" to "m1"), mapOf("kind" to "tripit", "id" to "x")),
                "gmailMessageIds" to listOf("m1"),
            ),
        )!!
        segment.type shouldBe SegmentType.TRAIN
        segment.origin shouldBe Place("London Euston", code = "EUS")
        segment.destination!!.country shouldBe "GB"
        segment.rating shouldBe 4
        segment.favorite shouldBe true
        segment.sourceCount shouldBe 2
        segmentFromDocument("s2", "t1", mapOf("type" to "train", "title" to "x", "start" to "2026-12-12T09:07:00+00:00", "gmailMessageIds" to listOf("m1")))!!.sourceCount shouldBe 1
        segmentFromDocument("s3", "t1", mapOf("type" to "hovercraft", "title" to "x", "start" to "2026-12-12T09:07:00+00:00")).shouldBeNull()
        segmentFromDocument("s4", "t1", mapOf("type" to "train", "title" to "x", "start" to "2026-12-12T09:07:00+00:00", "rating" to 9L))!!.rating.shouldBeNull()
    }

    @Test
    fun `a save keeps what the form does not edit and drops what it cleared`() {
        val stored = mapOf(
            "id" to "s1", "tripId" to "t1", "type" to "lodging", "title" to "Cove Liverpool", "start" to "2026-12-12T15:00:00+00:00", "end" to "2026-12-14T11:00:00+00:00",
            "provider" to "Cove", "confirmation" to "CV-55120", "notes" to "Late",
            "destination" to mapOf("name" to "Cove Liverpool", "city" to "Liverpool", "country" to "GB", "lat" to 53.4, "lon" to -2.98),
            "source" to "gmail", "gmailMessageIds" to listOf("m1"), "sources" to listOf(mapOf("kind" to "gmail", "id" to "m1")), "sender" to "cove.example",
            "rating" to 4L, "favorite" to true, "createdAt" to "2026-11-01T00:00:00Z", "updatedAt" to "2026-11-01T00:00:00Z",
        )
        val draft = SegmentDraft(SegmentType.LODGING, "Cove Liverpool", provider = null, confirmation = "CV-55120", start = "2026-12-12T16:00:00+00:00", end = null,
            origin = null, destination = PlaceDraft("Cove Liverpool", code = null, country = "GB"), notes = null)
        val doc = draftToDocument(draft, stored, "s1", "t1", "2026-11-07T20:00:00Z")
        doc["start"] shouldBe "2026-12-12T16:00:00+00:00"
        doc.containsKey("end") shouldBe false
        doc.containsKey("provider") shouldBe false
        doc.containsKey("notes") shouldBe false
        // The place kept its city and spot, since the name held.
        doc["destination"] shouldBe mapOf("name" to "Cove Liverpool", "city" to "Liverpool", "country" to "GB", "lat" to 53.4, "lon" to -2.98)
        doc["source"] shouldBe "gmail"
        doc["gmailMessageIds"] shouldBe listOf("m1")
        doc["sources"] shouldBe listOf(mapOf("kind" to "gmail", "id" to "m1"))
        doc["rating"] shouldBe 4L
        doc["favorite"] shouldBe true
        doc["createdAt"] shouldBe "2026-11-01T00:00:00Z"
        doc["updatedAt"] shouldBe "2026-11-07T20:00:00Z"
        // A renamed place starts afresh; a new booking is manual.
        val renamed = draftToDocument(draft.copy(destination = PlaceDraft("Elsewhere", "XYZ", null)), stored, "s1", "t1", "now")
        renamed["destination"] shouldBe mapOf("name" to "Elsewhere", "code" to "XYZ")
        val fresh = draftToDocument(draft, null, "new", "t1", "now")
        fresh["source"] shouldBe "manual"
        fresh["gmailMessageIds"] shouldBe emptyList<String>()
        fresh["createdAt"] shouldBe "now"
        fresh.keys shouldBe setOf("id", "tripId", "type", "title", "start", "confirmation", "destination", "source", "gmailMessageIds", "createdAt", "updatedAt")
    }

    @Test
    fun `reads a travel profile's entries and drops malformed ones`() {
        val profile = profileFromDocument(
            mapOf(
                "ownerUid" to "u1", "ownerEmail" to "owner@example.com", "trustedEmails" to listOf("partner@example.com"),
                "documents" to listOf(mapOf("title" to "Passport", "fields" to listOf(mapOf("label" to "Expiry", "value" to "2031-05-06"), mapOf("label" to 3))), mapOf("fields" to emptyList<Any>())),
                "loyalty" to emptyList<Any>(),
            ),
        )!!
        profile.ownerEmail shouldBe "owner@example.com"
        profile.trustedEmails shouldBe listOf("partner@example.com")
        profile.documents shouldBe listOf(ProfileEntry("Passport", listOf(ProfileField("Expiry", "2031-05-06"))))
        profile.travelers shouldBe emptyList()
        profileFromDocument(mapOf("ownerEmail" to "x")).shouldBeNull()
    }
}
