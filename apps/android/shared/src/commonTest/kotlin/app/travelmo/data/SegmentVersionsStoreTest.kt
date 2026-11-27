package app.travelmo.data

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class SegmentVersionsStoreTest {
    @Test
    fun `round-trips versions for the signed-in account and ignores another account's`() {
        val versions = mapOf(
            "trip-1" to SegmentVersion("2026-01-01T00:00:00Z", 3),
            "trip-2" to SegmentVersion("2026-02-01T00:00:00Z", 0),
        )
        val encoded = encodeSegmentVersions("user-a", versions)
        decodeSegmentVersions(encoded, "user-a") shouldBe versions
        decodeSegmentVersions(encoded, "user-b") shouldBe emptyMap()
        decodeSegmentVersions(null, "user-a") shouldBe emptyMap()
    }
}
