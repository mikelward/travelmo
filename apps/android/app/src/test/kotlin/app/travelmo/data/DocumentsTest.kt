package app.travelmo.data

import app.travelmo.core.FoundLoyalty
import app.travelmo.core.AddressHolder
import app.travelmo.core.PendingEmail
import app.travelmo.core.Place
import app.travelmo.core.PlaceDraft
import app.travelmo.core.ProfileEntry
import app.travelmo.core.ProfileField
import app.travelmo.core.SegmentDraft
import app.travelmo.core.SegmentType
import app.travelmo.core.SourceKind
import app.travelmo.core.SourceRef
import app.travelmo.core.isCancelled
import app.travelmo.core.liveSegments
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class DocumentsTest {
    @Test
    fun `reads a flight's status as the parser writes it, and drops one missing what it needs`() {
        val status = flightStatusFromDocument(
            mapOf(
                "ident" to "XX100", "date" to "2026-12-13", "origin" to "SYD", "found" to true,
                "departureGate" to "8", "departureTerminal" to "1", "baggageClaim" to "16",
                "scheduledOut" to "2026-12-12T22:00:00Z", "checkedAt" to "2026-12-12T21:00:00Z",
            ),
        )!!
        status.departureGate shouldBe "8"
        status.baggageClaim shouldBe "16"
        status.arrivalGate.shouldBeNull()
        status.cancelled shouldBe false
        flightStatusFromDocument(mapOf("ident" to "XX100", "date" to "2026-12-13", "checkedAt" to "2026-12-12T21:00:00Z")).shouldBeNull()
    }

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
                "sources" to listOf(
                    mapOf("kind" to "tripit", "id" to "x", "label" to "Liverpool", "at" to "2026-11-02T00:00:00Z"),
                    mapOf("kind" to "gmail", "id" to "m1", "label" to "Your tickets", "uid" to "u1", "at" to "2026-11-01T00:00:00Z"),
                    mapOf("kind" to "carrier-pigeon", "id" to "y", "at" to "2026-11-01T00:00:00Z"),
                ),
                "gmailMessageIds" to listOf("m1", "m0"),
                "createdAt" to "2026-10-31T00:00:00Z",
            ),
        )!!
        segment.type shouldBe SegmentType.TRAIN
        segment.origin shouldBe Place("London Euston", code = "EUS")
        segment.destination!!.country shouldBe "GB"
        segment.rating shouldBe 4
        segment.favorite shouldBe true
        // Every source once, oldest first, an older document's Gmail id dated by the booking's creation; an unknown kind is dropped.
        segment.sources shouldBe listOf(
            SourceRef(SourceKind.GMAIL, "m0", at = "2026-10-31T00:00:00Z"),
            SourceRef(SourceKind.GMAIL, "m1", label = "Your tickets", uid = "u1", at = "2026-11-01T00:00:00Z"),
            SourceRef(SourceKind.TRIPIT, "x", label = "Liverpool", at = "2026-11-02T00:00:00Z"),
        )
        segmentFromDocument("s2", "t1", mapOf("type" to "train", "title" to "x", "start" to "2026-12-12T09:07:00+00:00", "gmailMessageIds" to listOf("m1")))!!.sources shouldBe
            listOf(SourceRef(SourceKind.GMAIL, "m1", at = ""))
        segmentFromDocument("s3", "t1", mapOf("type" to "hovercraft", "title" to "x", "start" to "2026-12-12T09:07:00+00:00")).shouldBeNull()
        segmentFromDocument("s4", "t1", mapOf("type" to "train", "title" to "x", "start" to "2026-12-12T09:07:00+00:00", "rating" to 9L))!!.rating.shouldBeNull()
    }

    @Test
    fun `reads a cancelled segment so it drops out of what is live`() {
        val base = mapOf("type" to "lodging", "title" to "Harbor Inn", "start" to "2026-12-12T15:00:00+01:00")
        val cancelled = segmentFromDocument("s1", "t1", base + mapOf("cancelledAt" to "2026-11-20T08:00:00Z", "cancelledBy" to "m2"))!!
        cancelled.cancelledAt shouldBe "2026-11-20T08:00:00Z"
        cancelled.cancelledBy shouldBe "m2"
        cancelled.isCancelled shouldBe true
        val live = segmentFromDocument("s2", "t1", base)!!
        live.isCancelled shouldBe false
        liveSegments(listOf(cancelled, live)) shouldBe listOf(live)
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

    @Test
    fun `reads loyalty numbers found in emails and drops malformed ones`() {
        val found = mapOf("program" to "Cove Club", "number" to "CC 4455", "status" to "Member", "messageId" to "m1", "label" to "Your stay at Cove", "at" to "2026-11-01T00:00:00Z", "balance" to "1,200 points", "balanceAt" to "2026-10-31T00:00:00Z")
        val profile = profileFromDocument(mapOf("ownerUid" to "u1", "foundLoyalty" to listOf(found, mapOf("program" to "No number"), "junk")))!!
        profile.foundLoyalty shouldBe listOf(FoundLoyalty("Cove Club", "CC 4455", status = "Member", messageId = "m1", label = "Your stay at Cove", at = "2026-11-01T00:00:00Z", balance = "1,200 points", balanceAt = "2026-10-31T00:00:00Z"))
        profile.hasDetails shouldBe true
    }

    @Test
    fun `reads the user's addresses from their user document and drops malformed ones`() {
        val holder = addressHolderFromDocument(
            mapOf(
                "email" to "owner@example.com",
                "emails" to listOf("owner@work.example", 3),
                "gmail" to mapOf("emailAddress" to "owner.mail@example.net", "connectedAt" to "2026-11-01T00:00:00Z"),
                "pendingEmails" to listOf(mapOf("email" to "next@example.org", "sentAt" to "a", "expiresAt" to "b"), mapOf("email" to "half@example.org")),
            ),
        )
        holder shouldBe AddressHolder(listOf("owner@work.example"), "owner.mail@example.net", listOf(PendingEmail("next@example.org", "a", "b")))
        addressHolderFromDocument(emptyMap()) shouldBe AddressHolder()
    }
}
