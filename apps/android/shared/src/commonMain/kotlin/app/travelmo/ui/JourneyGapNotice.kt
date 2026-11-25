package app.travelmo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.travelmo.core.JourneyGap
import app.travelmo.core.LookResult
import app.travelmo.core.LookedEmail
import app.travelmo.core.journeyGapText
import app.travelmo.shared.Res
import app.travelmo.shared.add_it_yourself
import app.travelmo.shared.copy_report
import app.travelmo.shared.keep_looking
import app.travelmo.shared.look_for_it
import app.travelmo.shared.looked_already
import app.travelmo.shared.looked_busy
import app.travelmo.shared.looked_cancellation
import app.travelmo.shared.looked_failed
import app.travelmo.shared.looked_imported
import app.travelmo.shared.looked_not_booking
import app.travelmo.shared.looking
import app.travelmo.shared.no_emails_mention
import app.travelmo.shared.no_subject
import app.travelmo.shared.trip_is_one_way
import app.travelmo.ui.theme.TextButtonInset
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

/** What looking for one gap found so far ([found]), and how the last look went ([outcome]). */
class GapLook(val found: LookResult?, val outcome: Outcome?)

/** The journeys the trip seems to be missing, and what can be done about them: as the web's JourneyGapNotice. */
class JourneyGapActions(
    val gaps: List<JourneyGap>,
    val lookOf: (JourneyGap) -> GapLook,
    /** Searches the user's mailbox for one's emails; null on a build with no parser to ask. */
    val onLook: ((JourneyGap) -> Unit)?,
    /** Adds one by hand from the day it would be; null for a viewer who can't edit. */
    val onAdd: ((date: String) -> Unit)?,
    val onOneWay: () -> Unit,
)

private fun lookedText(outcome: String): StringResource = when (outcome) {
    "imported" -> Res.string.looked_imported
    "cancellation" -> Res.string.looked_cancellation
    "already" -> Res.string.looked_already
    "failed" -> Res.string.looked_failed
    "busy" -> Res.string.looked_busy
    else -> Res.string.looked_not_booking
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JourneyGapNotice(actions: JourneyGapActions, busy: Boolean, modifier: Modifier = Modifier) {
    val chrome = LocalAppChrome.current
    val shape = RoundedCornerShape(8.dp)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 16.dp)
            .border(1.dp, MaterialTheme.colorScheme.tertiary.copy(alpha = 0.4f), shape)
            .background(MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.5f), shape)
            .padding(12.dp),
    ) {
        actions.gaps.forEachIndexed { i, gap ->
            val look = actions.lookOf(gap)
            val found = look.found
            val looking = look.outcome is Outcome.Busy
            Text(
                journeyGapText(gap),
                modifier = if (i > 0) Modifier.padding(top = 8.dp) else Modifier,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.tertiary,
            )
            found?.emails?.forEach { email -> LookedRow(email, muted) { chrome.copyToClipboard("Import report", it) } }
            if (found != null && found.emails.isEmpty()) {
                Text(stringResource(Res.string.no_emails_mention, gap.from, gap.to), color = muted, modifier = Modifier.padding(top = 4.dp))
            }
            (look.outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 4.dp)) }
            // While there are more matches: a booking that fills the gap removes it, one that doesn't leaves it to keep looking.
            val more = found == null || found.next != null
            FlowRow(modifier = Modifier.offset(x = -TextButtonInset)) {
                actions.onLook?.takeIf { more }?.let { onLook ->
                    TextButton(onClick = { onLook(gap) }, enabled = !looking) {
                        Text(stringResource(if (looking) Res.string.looking else if (found == null) Res.string.look_for_it else Res.string.keep_looking))
                    }
                }
                actions.onAdd?.let { add -> TextButton(onClick = { add(gap.date) }, enabled = !busy) { Text(stringResource(Res.string.add_it_yourself)) } }
            }
        }
        if (actions.gaps.any { it.direction != "between" }) {
            TextButton(onClick = actions.onOneWay, enabled = !busy, modifier = Modifier.offset(x = -TextButtonInset)) {
                Text(stringResource(Res.string.trip_is_one_way))
            }
        }
    }
}

/** One email a look read: its subject, what came of it, and its report to copy when it wasn't added. */
@Composable
private fun LookedRow(email: LookedEmail, muted: androidx.compose.ui.graphics.Color, onCopy: (String) -> Unit) {
    Column(Modifier.padding(top = 4.dp)) {
        Text(email.subject.ifBlank { stringResource(Res.string.no_subject) }, style = MaterialTheme.typography.bodyLarge)
        Text(stringResource(lookedText(email.outcome)), color = muted, style = MaterialTheme.typography.bodyLarge)
        val report = email.report
        if (report != null && email.outcome != "imported" && email.outcome != "cancellation") {
            TextButton(onClick = { onCopy(report) }, modifier = Modifier.offset(x = -TextButtonInset)) { Text(stringResource(Res.string.copy_report)) }
        }
    }
}
