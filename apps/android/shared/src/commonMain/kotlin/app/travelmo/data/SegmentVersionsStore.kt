package app.travelmo.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Last known booking version of one trip: when the trip was last updated and how many
 * bookings were read at that version (catching Firestore cache eviction on restart).
 */
@Serializable
data class SegmentVersion(val updatedAt: String, val count: Int)

@Serializable
private data class SegmentVersionsManifest(val uid: String, val trips: Map<String, SegmentVersion>)

/**
 * Where each trip's last read booking version is kept on this device, as JSON, so unchanged
 * trips can be read from Firestore's local cache without server RPCs (SPEC "Reports").
 */
interface SegmentVersionsStore {
    /** The last text written, or null when there is none. */
    fun read(): String?

    fun write(text: String)
}

/** Kept only while the app runs: what a test or a preview has. */
class InMemorySegmentVersionsStore(private var text: String? = null) : SegmentVersionsStore {
    override fun read(): String? = text

    override fun write(text: String) {
        this.text = text
    }
}

private val segmentVersionsJson = Json { ignoreUnknownKeys = true }

/** [versions] as [uid]'s manifest, for [SegmentVersionsStore.write]. */
fun encodeSegmentVersions(uid: String, versions: Map<String, SegmentVersion>): String =
    segmentVersionsJson.encodeToString(SegmentVersionsManifest(uid, versions))

/** The trip versions a manifest holds, when it is [uid]'s; another account's are ignored. Throws on text it can't read. */
fun decodeSegmentVersions(text: String?, uid: String): Map<String, SegmentVersion> =
    text?.let { segmentVersionsJson.decodeFromString<SegmentVersionsManifest>(it) }?.takeIf { it.uid == uid }?.trips.orEmpty()
