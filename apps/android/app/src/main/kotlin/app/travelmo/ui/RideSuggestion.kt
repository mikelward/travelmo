package app.travelmo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.travelmo.R
import app.travelmo.core.RideCompany
import app.travelmo.core.RideNeedKind
import app.travelmo.core.Segment
import app.travelmo.core.rideCompaniesFor

/** The question a suggestion asks: the airport by its name, a city by its own, as on the web. */
@Composable
private fun rideQuestion(kind: RideNeedKind, flight: Segment): String {
    val airport = stringResource(R.string.the_airport)
    val from = flight.origin?.name ?: flight.origin?.code ?: airport
    val to = flight.destination?.name ?: flight.destination?.code ?: airport
    return when (kind) {
        RideNeedKind.TO_AIRPORT -> stringResource(R.string.ride_to_airport, from)
        RideNeedKind.FROM_AIRPORT -> stringResource(R.string.ride_home_from_airport, to)
        RideNeedKind.CAR -> stringResource(R.string.car_in, flight.destination?.city ?: to)
    }
}

/**
 * Under a flight with no car or ride booked: links to book one, the
 * traveler's own companies among them, and Hide. Nothing shows for a ride at
 * home until the traveler adds a company near home (on the web's Settings).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RideSuggestion(kind: RideNeedKind, flight: Segment, companies: List<RideCompany>, onHide: () -> Unit, modifier: Modifier = Modifier) {
    val offers = rideCompaniesFor(kind, companies)
    if (offers.isEmpty()) return
    val context = LocalContext.current
    OutlinedCard(modifier = modifier.fillMaxWidth().padding(start = 40.dp, bottom = 12.dp)) {
        Column(modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(rideQuestion(kind, flight), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                TextButton(onClick = onHide) { Text(stringResource(R.string.hide)) }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                for (offer in offers) {
                    TextButton(onClick = { openLink(context, offer.url, "a car or ride company") }) { Text(offer.name) }
                }
            }
        }
    }
}
