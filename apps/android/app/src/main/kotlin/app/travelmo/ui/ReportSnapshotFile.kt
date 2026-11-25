package app.travelmo.ui

import android.content.Context
import app.travelmo.data.ReportSnapshotStore
import java.io.File

/**
 * Reports' last counts and map, in a file in the app's own storage that is not backed up: worked
 * out again from the bookings on every visit, so nothing is lost without it (SPEC "Reports").
 */
class ReportSnapshotFile(context: Context) : ReportSnapshotStore {
    private val file = File(context.applicationContext.noBackupFilesDir, "report_snapshot.json")

    override fun read(): String? = if (file.exists()) file.readText() else null

    // Written whole to a new file and then moved over the old, so a crash midway never leaves half of one.
    override fun write(text: String) {
        val next = File(file.parentFile, "${file.name}.new")
        next.writeText(text)
        if (!next.renameTo(file)) error("Couldn't replace ${file.name}")
    }
}
