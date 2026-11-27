package app.travelmo.ui

import android.content.Context
import app.travelmo.data.SegmentVersionsStore
import java.io.File

/**
 * Each trip's last read booking version, in a file in the app's own storage that is not backed
 * up: rebuilt from Firestore if missing, so nothing is lost without it (SPEC "Reports").
 */
class SegmentVersionsFile(context: Context) : SegmentVersionsStore {
    private val file = File(context.applicationContext.noBackupFilesDir, "segment_versions.json")

    override fun read(): String? = if (file.exists()) file.readText() else null

    // Written whole to a new file and then moved over the old, so a crash midway never leaves half of one.
    override fun write(text: String) {
        val next = File(file.parentFile, "${file.name}.new")
        next.writeText(text)
        if (!next.renameTo(file)) error("Couldn't replace ${file.name}")
    }
}
