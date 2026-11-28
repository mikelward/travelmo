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
import app.travelmo.core.DuplicateFlight
import app.travelmo.core.Segment
import app.travelmo.core.duplicateFlightCancel
import app.travelmo.core.duplicateFlightText
import app.travelmo.shared.Res
import app.travelmo.shared.both_were_taken
import app.travelmo.ui.theme.TextButtonInset
import org.jetbrains.compose.resources.stringResource

/** One flight booked on two days near each other, and what can be done about it; each action null for a viewer who can't. */
class DuplicateFlightActions(
    val pair: DuplicateFlight,
    val onCancel: ((Segment) -> Unit)?,
    val onBothTaken: (() -> Unit)?,
)

/** The notice on a trip with a flight booked twice ([app.travelmo.core.duplicateFlights]), as the web's DuplicateFlightNotice. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DuplicateFlightNotice(actions: DuplicateFlightActions, busy: Boolean, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(8.dp)
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 16.dp)
            .border(1.dp, MaterialTheme.colorScheme.tertiary.copy(alpha = 0.4f), shape)
            .background(MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.5f), shape)
            .padding(12.dp),
    ) {
        Text(duplicateFlightText(actions.pair), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.tertiary)
        if (actions.onCancel != null || actions.onBothTaken != null) {
            FlowRow(modifier = Modifier.offset(x = -TextButtonInset)) {
                actions.onCancel?.let { cancel ->
                    for (flight in listOf(actions.pair.first, actions.pair.second)) {
                        TextButton(onClick = { cancel(flight) }, enabled = !busy) { Text(duplicateFlightCancel(flight)) }
                    }
                }
                actions.onBothTaken?.let { TextButton(onClick = it, enabled = !busy) { Text(stringResource(Res.string.both_were_taken)) } }
            }
        }
    }
}
