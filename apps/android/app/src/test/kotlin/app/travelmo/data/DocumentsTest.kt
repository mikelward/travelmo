package app.travelmo.data

import app.travelmo.core.Place
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
}
