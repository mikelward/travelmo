package app.travelmo.data

import app.travelmo.core.ReportSnapshot
import app.travelmo.core.TravelReport
import kotlinx.serialization.json.Json

/** Where Reports' last counts and map are kept on this phone, as JSON (ReportSnapshot, SPEC "Reports"). */
interface ReportSnapshotStore {
    /** The last text written, or null when there is none. */
    fun read(): String?

    fun write(text: String)
}

/** Kept only while the app runs: what a test or a preview has. */
class InMemoryReportSnapshotStore(private var text: String? = null) : ReportSnapshotStore {
    override fun read(): String? = text

    override fun write(text: String) {
        this.text = text
    }
}

private val snapshotJson = Json { ignoreUnknownKeys = true }

/** [report] as [uid]'s snapshot, for [ReportSnapshotStore.write]. */
fun encodeReportSnapshot(uid: String, report: TravelReport): String = snapshotJson.encodeToString(ReportSnapshot(uid, report))

/** The counts and map a snapshot holds, when it is [uid]'s; another account's are not theirs to see. Throws on text it can't read. */
fun decodeReportSnapshot(text: String?, uid: String): TravelReport? =
    text?.let { snapshotJson.decodeFromString<ReportSnapshot>(it) }?.takeIf { it.uid == uid }?.report
