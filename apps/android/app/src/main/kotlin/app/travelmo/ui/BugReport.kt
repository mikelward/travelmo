package app.travelmo.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.travelmo.core.BUG_REPORT_TEXT_MAX
import app.travelmo.core.TripWithSegments
import app.travelmo.core.bugReportFailure
import app.travelmo.data.OutgoingBugReport
import app.travelmo.data.TripActionFailed
import app.travelmo.log.ReportForSending
import app.travelmo.log.TravelmoLog
import app.travelmo.shared.Res
import app.travelmo.shared.cancel
import app.travelmo.shared.close
import app.travelmo.shared.report_a_bug
import app.travelmo.shared.report_disclosure
import app.travelmo.shared.report_disclosure_trip
import app.travelmo.shared.report_send
import app.travelmo.shared.report_send_failed
import app.travelmo.shared.report_sending
import app.travelmo.shared.report_sent
import app.travelmo.shared.report_share_instead
import app.travelmo.shared.report_what_went_wrong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withTimeoutOrNull
import org.jetbrains.compose.resources.stringResource

/** Sends a report to Travelmo: what the user wrote, from [screen], with the log and screenshot [context]'s activity gives. */
fun interface BugReportSender {
    suspend fun send(context: Context, text: String, screen: ReportScreen)
}

/**
 * Sending to Travelmo, which the signed-in app provides when the build has a
 * parser; null (signed out, or no parser) leaves Report a bug sharing
 * through the share sheet alone.
 */
val LocalBugReportSender = staticCompositionLocalOf<BugReportSender?> { null }

/**
 * The app's sender: the log and screenshot from [collect], the trip from
 * the screen (given [tripWaitMs] to arrive, else the report goes without
 * it), the build's [version], handed to [deliver] (the parser).
 */
class CollectingBugReportSender(
    private val version: String,
    private val collect: suspend (Context) -> ReportForSending,
    private val deliver: suspend (OutgoingBugReport) -> Unit,
    private val tripWaitMs: Long = 5_000,
) : BugReportSender {
    override suspend fun send(context: Context, text: String, screen: ReportScreen) {
        val collected = collect(context)
        val trip = screen.trip?.let { load ->
            withTimeoutOrNull(tripWaitMs) { load() }.also { if (it == null) TravelmoLog.warning("The trip's bookings didn't load; sending the report without them") }
        }
        deliver(OutgoingBugReport(text, screen.page, version, collected.log, collected.screenshot, trip))
    }
}

sealed interface SendState {
    data object Idle : SendState
    data object Sending : SendState
    data object Sent : SendState
    data class Failed(val reason: String) : SendState
}

/**
 * The send dialog's state: one send at a time, and none once sent; a
 * failure says why in the user's words, and Send tries again.
 */
class BugReportForm(private val deliver: suspend (text: String) -> Unit) {
    private val _state = MutableStateFlow<SendState>(SendState.Idle)
    val state: StateFlow<SendState> = _state.asStateFlow()

    suspend fun send(text: String) {
        if (_state.value == SendState.Sending || _state.value == SendState.Sent) return
        _state.value = SendState.Sending
        _state.value = try {
            deliver(text.trim())
            SendState.Sent
        } catch (e: CancellationException) {
            _state.value = SendState.Idle
            throw e
        } catch (e: TripActionFailed) {
            SendState.Failed(e.message ?: bugReportFailure(null))
        } catch (e: Exception) {
            TravelmoLog.failure(e, "Sending the bug report failed")
            SendState.Failed(bugReportFailure(null))
        }
    }
}

/**
 * Report a bug, signed in: an optional "What went wrong?", what Travelmo
 * will see (on a trip's screens, its bookings too), and Send; Share instead
 * offers the share sheet as before. Once sent it says so, with Close.
 */
@Composable
fun SendReportDialog(
    onTrip: Boolean,
    state: SendState,
    text: String,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    onShareInstead: () -> Unit,
    onDismiss: () -> Unit,
) {
    val sending = state == SendState.Sending
    val sent = state == SendState.Sent
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.report_a_bug)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { onTextChange(it.take(BUG_REPORT_TEXT_MAX)) },
                    label = { Text(stringResource(Res.string.report_what_went_wrong)) },
                    enabled = !sending && !sent,
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(stringResource(if (onTrip) Res.string.report_disclosure_trip else Res.string.report_disclosure), style = MaterialTheme.typography.bodyLarge)
                when (state) {
                    SendState.Sending -> Text(stringResource(Res.string.report_sending))
                    SendState.Sent -> Text(stringResource(Res.string.report_sent))
                    is SendState.Failed -> Text(stringResource(Res.string.report_send_failed, state.reason), color = MaterialTheme.colorScheme.error)
                    SendState.Idle -> Unit
                }
            }
        },
        confirmButton = {
            if (sent) {
                TextButton(onClick = onDismiss) { Text(stringResource(Res.string.close)) }
            } else {
                TextButton(onClick = onSend, enabled = !sending) { Text(stringResource(Res.string.report_send)) }
            }
        },
        dismissButton = if (sent) null else {
            {
                Row {
                    TextButton(onClick = onShareInstead, enabled = !sending) { Text(stringResource(Res.string.report_share_instead)) }
                    TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) }
                }
            }
        },
    )
}
