package app.travelmo.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * A dialog that goes ahead only once [word] is typed, as "Delete everything and start over" asks. Opening and closing
 * it, however it closes (Keep, Back, a tap outside), clear what was typed, so a confirmation never carries over.
 */
class TypedConfirmation(private val word: String = "DELETE") {
    var open by mutableStateOf(false)
        private set
    var typed by mutableStateOf("")

    /** Whether what was typed is the word, whatever its case or spaces around it. */
    val confirmed: Boolean get() = typed.trim().equals(word, ignoreCase = true)

    fun open() {
        typed = ""
        open = true
    }

    fun close() {
        open = false
        typed = ""
    }
}
