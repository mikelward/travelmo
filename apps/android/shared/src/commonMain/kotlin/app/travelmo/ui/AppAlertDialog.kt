package app.travelmo.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * An [AlertDialog] at the chosen text size, answering a pinch. A dialog is a
 * window of its own, which neither the size nor the gesture crosses into, so
 * each slot re-applies the size and the surface hosts the pinch (as stopdash's
 * dialogs do).
 */
@Composable
fun AppAlertDialog(
    onDismissRequest: () -> Unit,
    confirmButton: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    dismissButton: (@Composable () -> Unit)? = null,
    title: (@Composable () -> Unit)? = null,
    text: (@Composable () -> Unit)? = null,
) {
    AlertDialog(
        onDismissRequest = onDismissRequest,
        confirmButton = { FontSizeWindow(confirmButton) },
        modifier = modifier.pinchFontSizeHost(),
        dismissButton = dismissButton?.let { { FontSizeWindow(it) } },
        title = title?.let { { FontSizeWindow(it) } },
        text = text?.let { { FontSizeWindow(it) } },
    )
}
