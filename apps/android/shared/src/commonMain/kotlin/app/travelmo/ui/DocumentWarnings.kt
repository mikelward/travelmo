package app.travelmo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.travelmo.core.PersonWarning
import app.travelmo.core.WarningWhen
import app.travelmo.core.warningText

/** A trip page's passports and visas that run out too close to it (SPEC.md "Document reminders"): red before the trip ends, amber within the margin after. */
@Composable
fun DocumentWarnings(warnings: List<PersonWarning>, today: String, modifier: Modifier = Modifier) {
    if (warnings.isEmpty()) return
    val shape = RoundedCornerShape(8.dp)
    val boxed = modifier
        .fillMaxWidth()
        .padding(top = 16.dp)
        .border(1.dp, MaterialTheme.colorScheme.tertiary.copy(alpha = 0.4f), shape)
        .background(MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.5f), shape)
        .padding(12.dp)
    Column(modifier = boxed) {
        for (w in warnings) {
            Text(
                warningText(w, today),
                style = MaterialTheme.typography.bodyMedium,
                color = if (w.warning.`when` == WarningWhen.BEFORE) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.tertiary,
            )
        }
    }
}
