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
import app.travelmo.core.MixedTrip
import app.travelmo.shared.Res
import app.travelmo.shared.it_is_one_trip
import app.travelmo.shared.mixed_elsewhere
import app.travelmo.shared.mixed_overlap
import app.travelmo.shared.mixed_travelers
import app.travelmo.shared.split
import app.travelmo.shared.travelers_menu
import app.travelmo.ui.theme.TextButtonInset
import org.jetbrains.compose.resources.stringResource

/** A trip whose bookings look like two in one, and what the owner can do about it; each action null for a viewer who can't. */
class MixedTripActions(
    val mixed: MixedTrip,
    val onSplit: (() -> Unit)?,
    val onTravelers: (() -> Unit)?,
    val onOneTrip: (() -> Unit)?,
)

/** Why a trip looks like two in one ([app.travelmo.core.mixedTrip]), in words: as the web's mixedTripText. */
@Composable
fun mixedTripText(mixed: MixedTrip): String = when (mixed) {
    is MixedTrip.Overlap -> stringResource(Res.string.mixed_overlap, mixed.first.title, mixed.second.title)
    is MixedTrip.Elsewhere -> stringResource(Res.string.mixed_elsewhere, mixed.second.title, mixed.first.title)
    is MixedTrip.Travelers -> stringResource(Res.string.mixed_travelers, mixed.groups[0].joinToString(", "), mixed.groups[1].joinToString(", "))
}

/** The notice on a trip that looks like two in one, as the web's MixedTripNotice. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MixedTripNotice(actions: MixedTripActions, busy: Boolean, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(8.dp)
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 16.dp)
            .border(1.dp, MaterialTheme.colorScheme.tertiary.copy(alpha = 0.4f), shape)
            .background(MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.5f), shape)
            .padding(12.dp),
    ) {
        Text(mixedTripText(actions.mixed), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.tertiary)
        if (actions.onSplit != null || actions.onTravelers != null || actions.onOneTrip != null) {
            FlowRow(modifier = Modifier.offset(x = -TextButtonInset)) {
                actions.onSplit?.let { TextButton(onClick = it, enabled = !busy) { Text(stringResource(Res.string.split)) } }
                actions.onTravelers?.let { TextButton(onClick = it, enabled = !busy) { Text(stringResource(Res.string.travelers_menu)) } }
                actions.onOneTrip?.let { TextButton(onClick = it, enabled = !busy) { Text(stringResource(Res.string.it_is_one_trip)) } }
            }
        }
    }
}
