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
import app.travelmo.core.gmailSearchUrl
import app.travelmo.core.journeyGapSearch
import app.travelmo.core.journeyGapText
import app.travelmo.shared.Res
import app.travelmo.shared.add_it_yourself
import app.travelmo.shared.find_it_in_gmail
import app.travelmo.shared.trip_is_one_way
import app.travelmo.ui.theme.TextButtonInset
import org.jetbrains.compose.resources.stringResource

/** A journey the trip seems to be missing, and what can be done about it: as the web's JourneyGapNotice. */
class JourneyGapActions(
    val gap: JourneyGap,
    /** Adds it by hand from the day it would be; null for a viewer who can't edit. */
    val onAdd: (() -> Unit)?,
    val onOneWay: () -> Unit,
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JourneyGapNotice(actions: JourneyGapActions, busy: Boolean, modifier: Modifier = Modifier) {
    val chrome = LocalAppChrome.current
    val shape = RoundedCornerShape(8.dp)
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 16.dp)
            .border(1.dp, MaterialTheme.colorScheme.tertiary.copy(alpha = 0.4f), shape)
            .background(MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.5f), shape)
            .padding(12.dp),
    ) {
        Text(journeyGapText(actions.gap), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.tertiary)
        FlowRow(modifier = Modifier.offset(x = -TextButtonInset)) {
            TextButton(onClick = { chrome.openLink(gmailSearchUrl(journeyGapSearch(actions.gap)), "a search for a missing booking") }) {
                Text(stringResource(Res.string.find_it_in_gmail))
            }
            actions.onAdd?.let { add -> TextButton(onClick = add, enabled = !busy) { Text(stringResource(Res.string.add_it_yourself)) } }
            TextButton(onClick = actions.onOneWay, enabled = !busy) { Text(stringResource(Res.string.trip_is_one_way)) }
        }
    }
}
