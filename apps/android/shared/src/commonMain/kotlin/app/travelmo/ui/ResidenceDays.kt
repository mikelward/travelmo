package app.travelmo.ui

import app.travelmo.core.groupedDecimal
import app.travelmo.core.groupThousands
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.travelmo.core.HomePeriod
import app.travelmo.core.LimitType
import app.travelmo.core.ResidenceStatus
import app.travelmo.core.RuleKind
import app.travelmo.core.RuleResult
import app.travelmo.core.Stretch
import app.travelmo.core.TripWithSegments
import app.travelmo.core.countryName
import app.travelmo.core.formatDateRange
import app.travelmo.core.formatDateWithYear
import app.travelmo.core.residenceReport
import app.travelmo.core.residenceRuleSets
import app.travelmo.core.spanText
import app.travelmo.shared.Res
import app.travelmo.shared.residence_applying_on
import app.travelmo.shared.residence_as_of
import app.travelmo.shared.residence_fewer
import app.travelmo.shared.residence_close
import app.travelmo.shared.residence_close_to_test
import app.travelmo.shared.residence_days
import app.travelmo.shared.residence_enough
import app.travelmo.shared.residence_estimate
import app.travelmo.shared.residence_just_enough
import app.travelmo.shared.residence_left
import app.travelmo.shared.residence_longest
import app.travelmo.shared.residence_meets_test
import app.travelmo.shared.residence_more
import app.travelmo.shared.residence_no_home_country
import app.travelmo.shared.residence_no_long_absence
import app.travelmo.shared.residence_no_time_away
import app.travelmo.shared.residence_not_enough
import app.travelmo.shared.residence_not_met
import app.travelmo.shared.residence_of_days
import app.travelmo.shared.residence_official_guidance
import app.travelmo.shared.residence_over
import app.travelmo.shared.residence_over_by
import app.travelmo.shared.residence_rules
import app.travelmo.shared.residence_short
import app.travelmo.shared.residence_spare
import app.travelmo.shared.residence_stays
import app.travelmo.shared.residence_this_year
import app.travelmo.shared.residence_time_away
import app.travelmo.shared.residence_title
import app.travelmo.shared.residence_under_31
import app.travelmo.shared.residence_unknown_away
import app.travelmo.shared.residence_unknown_in
import app.travelmo.shared.residence_weighted
import app.travelmo.shared.residence_within
import app.travelmo.shared.residence_worst
import app.travelmo.shared.residence_last
import app.travelmo.shared.residence_since_moved
import app.travelmo.shared.residence_counted_over
import app.travelmo.shared.residence_cant_place
import app.travelmo.shared.residence_cant_place_hint

import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource

/**
 * Days in and out of countries against residence and visa limits, as the
 * web's reports page shows them (packages/core/src/residence.ts, mirrored in
 * `:core`), counted to today or a day picked: pick a set of rules, see each count, its worst
 * stretch, and the time away or stays behind it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResidenceDays(trips: List<TripWithSegments>, homes: List<HomePeriod>, today: String, titles: Map<String, String>, onOpenTrip: (String) -> Unit, modifier: Modifier = Modifier) {
    var setId by rememberSaveable { mutableStateOf(residenceRuleSets.first().id) }
    val set = residenceRuleSets.firstOrNull { it.id == setId } ?: residenceRuleSets.first()
    // The day to count to: today unless the user picks another, such as the day they mean to apply.
    var date by rememberSaveable { mutableStateOf(today) }
    val report = remember(trips, homes, set, date) { residenceReport(trips, homes, set, date) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier = modifier.fillMaxWidth()) {
        Text(stringResource(Res.string.residence_title), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 8.dp))
        var open by remember { mutableStateOf(false) }
        ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
            OutlinedTextField(
                value = set.label,
                onValueChange = {},
                readOnly = true,
                label = { Text(stringResource(Res.string.residence_rules)) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.pinchFontSizeHost()) {
                for (s in residenceRuleSets) DropdownMenuItem(text = { Text(s.label) }, onClick = { setId = s.id; open = false })
            }
        }
        DateButton(
            stringResource(if (set.application) Res.string.residence_applying_on else Res.string.residence_as_of, formatDateWithYear(date)),
            date,
            { date = it },
            Modifier.padding(top = 8.dp),
        )
        if (!report.homeCountryKnown) {
            Text(stringResource(Res.string.residence_no_home_country), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        }
        for (result in report.results) Result(result, titles, onOpenTrip)
        Text(stringResource(Res.string.residence_estimate), style = MaterialTheme.typography.bodyMedium, color = muted, modifier = Modifier.padding(top = 8.dp))
    }
}

/** At most this many stretches are listed at first, latest first; the rest on asking. */
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
        result.period?.let { period ->
            val moved = rule.areaName?.takeIf { period.moved }
            Text(
                if (moved != null) {
                    stringResource(Res.string.residence_since_moved, moved, formatDateRange(period.start, period.start))
                } else {
                    stringResource(Res.string.residence_counted_over, formatDateRange(period.start, period.end))
                },
                style = MaterialTheme.typography.bodyMedium,
                color = muted,
            )
        }
        // A period shorter than one window is its own window, already said.
        val wholePeriod = result.period?.let { it.start == result.window.start && it.end == result.window.end } ?: false
        if (kind !is RuleKind.LongestAbsence && !wholePeriod) {
            val window = formatDateRange(result.window.start, result.window.end)
            val span = (kind as? RuleKind.Limit)?.window?.let(::spanText).orEmpty()
            val line = if (rolling) stringResource(Res.string.residence_worst, span, window) else window
            // The window ending today, when it is not the worst one.
            val current = result.current?.takeIf { rolling && it.window.start != result.window.start }?.let {
                " · " + pluralStringResource(Res.plurals.residence_last, it.used, it.used, span)
            }.orEmpty()
            Text(line + current, style = MaterialTheme.typography.bodyMedium, color = muted)
        }
        if (result.unknownDays > 0) {
            Text(
                pluralStringResource(if (stays) Res.plurals.residence_unknown_in else Res.plurals.residence_unknown_away, result.unknownDays, result.unknownDays),
                style = MaterialTheme.typography.bodyMedium,
                color = muted,
            )
        }
        if (result.unplaced.isNotEmpty()) {
            Stretches(stringResource(Res.string.residence_cant_place), result.unplaced, titles, onOpenTrip)
            Text(stringResource(Res.string.residence_cant_place_hint), style = MaterialTheme.typography.bodyMedium, color = muted)
        }
        if (result.stretches.isNotEmpty()) {
            Stretches(stringResource(if (stays) Res.string.residence_stays else Res.string.residence_time_away), result.stretches, titles, onOpenTrip)
        }
        Text(
            stringResource(Res.string.residence_official_guidance),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clickable { uri.openUri(rule.source) }.padding(vertical = 4.dp),
        )
    }
}

/** Runs of days under a heading, latest first, each opening its trip. */
@Composable
private fun Stretches(label: String, items: List<Stretch>, titles: Map<String, String>, onOpenTrip: (String) -> Unit) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Text(label, style = MaterialTheme.typography.labelLarge, color = muted, modifier = Modifier.padding(top = 4.dp))
    var all by rememberSaveable { mutableStateOf(false) }
    for (s in items.reversed().let { if (all) it else it.take(SHOWN_STRETCHES) }) {
        val where = s.countries.joinToString(", ") { countryName(it) }
        val text = listOf(formatDateRange(s.start, s.end), pluralStringResource(Res.plurals.residence_days, s.days, s.days), where).filter { it.isNotEmpty() }.joinToString(" · ")
        val trip = s.tripIds.firstOrNull()
        Text(
            if (trip != null) "$text · ${titles[trip] ?: trip}" else text,
            style = MaterialTheme.typography.bodyMedium,
            modifier = if (trip != null) Modifier.clickable { onOpenTrip(trip) }.padding(vertical = 2.dp) else Modifier.padding(vertical = 2.dp),
        )
    }
    val more = items.size - SHOWN_STRETCHES
    if (more > 0) {
        Text(
            if (all) stringResource(Res.string.residence_fewer) else pluralStringResource(Res.plurals.residence_more, more, more),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clickable { all = !all }.padding(vertical = 4.dp),
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
                ResidenceStatus.OK -> Res.string.residence_enough
                ResidenceStatus.NEAR -> Res.string.residence_just_enough
                ResidenceStatus.OVER -> Res.string.residence_not_enough
            },
        )
        else -> stringResource(
            when (result.status) {
                ResidenceStatus.OK -> Res.string.residence_within
                ResidenceStatus.NEAR -> Res.string.residence_close
                ResidenceStatus.OVER -> Res.string.residence_over
            },
        )
    }
    is RuleKind.LongestAbsence -> when (result.status) {
        ResidenceStatus.OK -> stringResource(Res.string.residence_no_long_absence)
        ResidenceStatus.NEAR -> kind.notes.near
        ResidenceStatus.OVER -> kind.notes.over
    }
    RuleKind.SubstantialPresence -> when {
        result.status == ResidenceStatus.OVER -> stringResource(Res.string.residence_meets_test)
        (result.current?.used ?: 0) < 31 -> stringResource(Res.string.residence_under_31)
        result.status == ResidenceStatus.NEAR -> stringResource(Res.string.residence_close_to_test)
        else -> stringResource(Res.string.residence_not_met)
    }
}

private fun grouped(n: Int) = groupThousands(n.toLong())

/** The count against the rule: "45 of 180 days · 135 days left". */
@Composable
private fun countText(result: RuleResult): String {
    val used = result.used.toInt()
    val remaining = result.remaining.toInt()
    return when (val kind = result.rule.kind) {
        is RuleKind.Limit -> {
            val of = pluralStringResource(Res.plurals.residence_of_days, result.limit, grouped(used), grouped(result.limit))
            val rest = when {
                kind.type == LimitType.MIN_PRESENT && remaining > 0 -> pluralStringResource(Res.plurals.residence_short, remaining, remaining)
                kind.type == LimitType.MIN_PRESENT -> pluralStringResource(Res.plurals.residence_spare, -remaining, -remaining)
                remaining >= 0 -> pluralStringResource(Res.plurals.residence_left, remaining, remaining)
                else -> pluralStringResource(Res.plurals.residence_over_by, -remaining, -remaining)
            }
            "$of · $rest"
        }
        is RuleKind.LongestAbsence -> if (used == 0) {
            stringResource(Res.string.residence_no_time_away)
        } else {
            pluralStringResource(Res.plurals.residence_longest, used, used, formatDateRange(result.window.start, result.window.end))
        }
        RuleKind.SubstantialPresence -> {
            val thisYear = result.current?.used ?: 0
            stringResource(Res.string.residence_weighted, groupedDecimal(result.used, 1).removeSuffix(".0"), grouped(result.limit), pluralStringResource(Res.plurals.residence_this_year, thisYear, thisYear))
        }
    }
}
