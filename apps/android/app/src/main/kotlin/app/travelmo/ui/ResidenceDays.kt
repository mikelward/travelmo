package app.travelmo.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.travelmo.R
import app.travelmo.core.HomePeriod
import app.travelmo.core.LimitType
import app.travelmo.core.ResidenceStatus
import app.travelmo.core.RuleKind
import app.travelmo.core.RuleResult
import app.travelmo.core.TripWithSegments
import app.travelmo.core.countryName
import app.travelmo.core.formatDateRange
import app.travelmo.core.residenceReport
import app.travelmo.core.residenceRuleSets
import com.mikelward.androidzoom.compose.pinchFontSizeHost
import java.util.Locale

/**
 * Days in and out of countries against residence and visa limits, as the
 * web's reports page shows them (packages/core/src/residence.ts, mirrored in
 * `:core`), counted to today: pick a set of rules, see each count, its worst
 * stretch, and the time away or stays behind it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResidenceDays(trips: List<TripWithSegments>, homes: List<HomePeriod>, today: String, titles: Map<String, String>, onOpenTrip: (String) -> Unit, modifier: Modifier = Modifier) {
    var setId by rememberSaveable { mutableStateOf(residenceRuleSets.first().id) }
    val set = residenceRuleSets.firstOrNull { it.id == setId } ?: residenceRuleSets.first()
    val report = remember(trips, homes, set, today) { residenceReport(trips, homes, set, today) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier = modifier.fillMaxWidth()) {
        Text(stringResource(R.string.residence_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 8.dp))
        var open by remember { mutableStateOf(false) }
        ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
            OutlinedTextField(
                value = set.label,
                onValueChange = {},
                readOnly = true,
                label = { Text(stringResource(R.string.residence_rules)) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.pinchFontSizeHost()) {
                for (s in residenceRuleSets) DropdownMenuItem(text = { Text(s.label) }, onClick = { setId = s.id; open = false })
            }
        }
        Text(
            stringResource(if (set.application) R.string.residence_applying_today else R.string.residence_as_of_today),
            style = MaterialTheme.typography.bodyMedium,
            color = muted,
            modifier = Modifier.padding(top = 4.dp),
        )
        if (!report.homeCountryKnown) {
            Text(stringResource(R.string.residence_no_home_country), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        }
        for (result in report.results) Result(result, titles, onOpenTrip)
        Text(stringResource(R.string.residence_estimate), style = MaterialTheme.typography.bodyMedium, color = muted, modifier = Modifier.padding(top = 8.dp))
    }
}

/** At most this many stretches are listed, latest first; the rest are counted. */
private const val SHOWN_STRETCHES = 5

@Composable
private fun Result(result: RuleResult, titles: Map<String, String>, onOpenTrip: (String) -> Unit) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val rule = result.rule
    val kind = rule.kind
    val stays = kind is RuleKind.SubstantialPresence || (kind is RuleKind.Limit && kind.type == LimitType.MAX_PRESENT)
    val rolling = kind is RuleKind.Limit && kind.rolling != null
    val uri = LocalUriHandler.current
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("residence-rule")) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(bottom = 8.dp))
        Text(rule.label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        Text(countText(result), style = MaterialTheme.typography.bodyLarge)
        Text(statusText(result), style = MaterialTheme.typography.bodyMedium, color = statusColor(result.status))
        if (kind !is RuleKind.LongestAbsence) {
            val window = formatDateRange(result.window.start, result.window.end)
            val line = if (rolling) stringResource(R.string.residence_worst_stretch, window) else window
            // The window ending today, when it is not the worst one.
            val current = result.current?.takeIf { rolling && it.window != result.window }?.let {
                " · " + pluralStringResource(R.plurals.residence_days_ending, it.used, it.used, formatDateRange(it.window.end, it.window.end))
            }.orEmpty()
            Text(line + current, style = MaterialTheme.typography.bodyMedium, color = muted)
        }
        if (result.unknownDays > 0) {
            Text(
                pluralStringResource(if (stays) R.plurals.residence_unknown_in else R.plurals.residence_unknown_away, result.unknownDays, result.unknownDays),
                style = MaterialTheme.typography.bodyMedium,
                color = muted,
            )
        }
        if (result.stretches.isNotEmpty()) {
            Text(stringResource(if (stays) R.string.residence_stays else R.string.residence_time_away), style = MaterialTheme.typography.labelLarge, color = muted, modifier = Modifier.padding(top = 4.dp))
            for (s in result.stretches.reversed().take(SHOWN_STRETCHES)) {
                val where = s.countries.joinToString(", ") { countryName(it) }
                val text = listOf(formatDateRange(s.start, s.end), pluralStringResource(R.plurals.residence_days, s.days, s.days), where).filter { it.isNotEmpty() }.joinToString(" · ")
                val trip = s.tripIds.firstOrNull()
                Text(
                    if (trip != null) "$text · ${titles[trip] ?: trip}" else text,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = if (trip != null) Modifier.clickable { onOpenTrip(trip) }.padding(vertical = 2.dp) else Modifier.padding(vertical = 2.dp),
                )
            }
            val more = result.stretches.size - SHOWN_STRETCHES
            if (more > 0) Text(pluralStringResource(R.plurals.residence_more, more, more), style = MaterialTheme.typography.bodyMedium, color = muted)
        }
        Text(
            stringResource(R.string.residence_official_guidance),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clickable { uri.openUri(rule.source) }.padding(vertical = 4.dp),
        )
    }
}

@Composable
private fun statusColor(status: ResidenceStatus): Color = when (status) {
    ResidenceStatus.OK -> MaterialTheme.colorScheme.onSurfaceVariant
    ResidenceStatus.NEAR -> MaterialTheme.colorScheme.tertiary
    ResidenceStatus.OVER -> MaterialTheme.colorScheme.error
}

/** How the result stands, in words that fit what the rule measures. */
@Composable
private fun statusText(result: RuleResult): String = when (val kind = result.rule.kind) {
    is RuleKind.Limit -> when {
        kind.type == LimitType.MIN_PRESENT -> stringResource(
            when (result.status) {
                ResidenceStatus.OK -> R.string.residence_enough
                ResidenceStatus.NEAR -> R.string.residence_just_enough
                ResidenceStatus.OVER -> R.string.residence_not_enough
            },
        )
        else -> stringResource(
            when (result.status) {
                ResidenceStatus.OK -> R.string.residence_within
                ResidenceStatus.NEAR -> R.string.residence_close
                ResidenceStatus.OVER -> R.string.residence_over
            },
        )
    }
    is RuleKind.LongestAbsence -> when (result.status) {
        ResidenceStatus.OK -> stringResource(R.string.residence_no_long_absence)
        ResidenceStatus.NEAR -> kind.notes.near
        ResidenceStatus.OVER -> kind.notes.over
    }
    RuleKind.SubstantialPresence -> when {
        result.status == ResidenceStatus.OVER -> stringResource(R.string.residence_meets_test)
        (result.current?.used ?: 0) < 31 -> stringResource(R.string.residence_under_31)
        result.status == ResidenceStatus.NEAR -> stringResource(R.string.residence_close_to_test)
        else -> stringResource(R.string.residence_not_met)
    }
}

private fun grouped(n: Int) = String.format(Locale.US, "%,d", n)

/** The count against the rule: "45 of 180 days · 135 days left". */
@Composable
private fun countText(result: RuleResult): String {
    val used = result.used.toInt()
    val remaining = result.remaining.toInt()
    return when (val kind = result.rule.kind) {
        is RuleKind.Limit -> {
            val of = pluralStringResource(R.plurals.residence_of_days, result.limit, grouped(used), grouped(result.limit))
            val rest = when {
                kind.type == LimitType.MIN_PRESENT && remaining > 0 -> pluralStringResource(R.plurals.residence_short, remaining, remaining)
                kind.type == LimitType.MIN_PRESENT -> pluralStringResource(R.plurals.residence_spare, -remaining, -remaining)
                remaining >= 0 -> pluralStringResource(R.plurals.residence_left, remaining, remaining)
                else -> pluralStringResource(R.plurals.residence_over_by, -remaining, -remaining)
            }
            "$of · $rest"
        }
        is RuleKind.LongestAbsence -> if (used == 0) {
            stringResource(R.string.residence_no_time_away)
        } else {
            pluralStringResource(R.plurals.residence_longest, used, used, formatDateRange(result.window.start, result.window.end))
        }
        RuleKind.SubstantialPresence -> {
            val thisYear = result.current?.used ?: 0
            stringResource(R.string.residence_weighted, String.format(Locale.US, "%,.1f", result.used).removeSuffix(".0"), grouped(result.limit), pluralStringResource(R.plurals.residence_this_year, thisYear, thisYear))
        }
    }
}
