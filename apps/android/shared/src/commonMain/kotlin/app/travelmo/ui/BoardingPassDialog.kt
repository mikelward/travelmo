package app.travelmo.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.travelmo.core.BoardingPass
import app.travelmo.core.Segment
import app.travelmo.core.bookingHeading
import app.travelmo.core.encodeQrMatrix
import app.travelmo.core.formatDate
import app.travelmo.core.localDate
import app.travelmo.core.localTime
import app.travelmo.shared.Res
import app.travelmo.shared.boarding_pass_board
import app.travelmo.shared.boarding_pass_done
import app.travelmo.shared.boarding_pass_gate
import app.travelmo.shared.boarding_pass_group
import app.travelmo.shared.boarding_pass_no_barcode
import app.travelmo.shared.boarding_pass_passenger
import app.travelmo.shared.boarding_pass_saved_offline
import app.travelmo.shared.boarding_pass_scan_hint
import app.travelmo.shared.boarding_pass_seat
import app.travelmo.shared.close
import org.jetbrains.compose.resources.stringResource

private val PassInk = Color(0xFF09090B)
private val PassMuted = Color(0xFF52525B)
private val PassBorder = Color(0xFFE4E4E7)
private val PassSurfaceTint = Color(0xFFFAFAFA)

@Composable
private fun QrMatrixCanvas(
    matrix: List<List<Boolean>>,
    description: String,
    modifier: Modifier = Modifier,
) {
    val quiet = 4
    val n = matrix.size
    val total = n + quiet * 2
    Canvas(
        modifier = modifier
            .size(208.dp)
            .background(Color.White)
            .semantics { contentDescription = description },
    ) {
        drawRect(color = Color.White, size = size)
        val cell = minOf(size.width, size.height) / total
        val offsetX = (size.width - cell * total) / 2f
        val offsetY = (size.height - cell * total) / 2f
        for (y in 0 until n) {
            val row = matrix[y]
            for (x in 0 until n) {
                if (row[x]) {
                    drawRect(
                        color = Color.Black,
                        topLeft = Offset(offsetX + (x + quiet) * cell, offsetY + (y + quiet) * cell),
                        size = Size(cell + 0.5f, cell + 0.5f),
                    )
                }
            }
        }
    }
}

/**
 * High-contrast offline scannable boarding pass dialog. Always renders dark
 * ink on pure white so optical gate scanners can read the QR code regardless
 * of the app's dark theme.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BoardingPassDialog(
    segment: Segment,
    passes: List<BoardingPass>,
    initialIndex: Int = 0,
    onDismiss: () -> Unit,
) {
    if (passes.isEmpty()) return
    var selected by rememberSaveable(segment.id, initialIndex) {
        mutableIntStateOf(initialIndex.coerceIn(0, passes.lastIndex))
    }
    val pass = passes.getOrElse(selected) { passes.first() }
    val heading = remember(segment) { bookingHeading(segment) }
    val originCode = segment.origin?.code ?: segment.origin?.name
    val destCode = segment.destination?.code ?: segment.destination?.name
    val route = if (originCode != null && destCode != null) "$originCode → $destCode" else null
    val subtitle = listOfNotNull(route, formatDate(localDate(segment.start)), localTime(segment.start)).joinToString(" · ")
    val pnr = segment.confirmation
    val footerMeta = listOfNotNull(
        pnr?.let { "Ref $it" },
        pass.sequence?.let { "Seq $it" },
        pass.cabin,
    ).joinToString(" · ")

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = Color.White,
            contentColor = PassInk,
            shadowElevation = 8.dp,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
        ) {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                Row(
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 16.dp, bottom = 12.dp),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(heading.headline, style = MaterialTheme.typography.titleLarge, color = PassInk)
                        if (subtitle.isNotEmpty()) {
                            Text(subtitle, style = MaterialTheme.typography.bodyLarge, color = PassMuted)
                        }
                    }
                    TextButton(onClick = onDismiss) {
                        Text(stringResource(Res.string.close), style = MaterialTheme.typography.labelLarge, color = PassMuted)
                    }
                }
                HorizontalDivider(color = PassBorder)

                Column(
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.fillMaxWidth().padding(20.dp),
                ) {
                    if (passes.size > 1) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            passes.forEachIndexed { idx, p ->
                                FilterChip(
                                    selected = idx == selected,
                                    onClick = { selected = idx },
                                    label = { Text(p.passenger) },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = PassInk,
                                        selectedLabelColor = Color.White,
                                        labelColor = PassInk,
                                    ),
                                )
                            }
                        }
                    }

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(stringResource(Res.string.boarding_pass_passenger), style = MaterialTheme.typography.bodyLarge, color = PassMuted)
                            Text(pass.passenger, style = MaterialTheme.typography.titleMedium, color = PassInk)
                        }
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .border(1.dp, PassBorder, RoundedCornerShape(999.dp))
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                        ) {
                            Text(
                                stringResource(Res.string.boarding_pass_saved_offline),
                                style = MaterialTheme.typography.labelSmall,
                                color = PassMuted,
                            )
                        }
                    }

                    Row(
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(PassSurfaceTint)
                            .border(1.dp, PassBorder, RoundedCornerShape(10.dp))
                            .padding(vertical = 12.dp, horizontal = 8.dp),
                    ) {
                        PassStatCell(stringResource(Res.string.boarding_pass_gate), pass.gate ?: "—", Modifier.weight(1f))
                        PassStatCell(stringResource(Res.string.boarding_pass_board), pass.boardingTime ?: "—", Modifier.weight(1f))
                        PassStatCell(stringResource(Res.string.boarding_pass_group), pass.boardingGroup ?: "—", Modifier.weight(1f))
                        PassStatCell(stringResource(Res.string.boarding_pass_seat), pass.seat ?: "—", Modifier.weight(1f))
                    }

                    val barcode = pass.barcode
                    val qrMatrix = remember(barcode) { barcode?.let(::encodeQrMatrix) }
                    if (qrMatrix != null) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color.White)
                                .border(1.dp, PassBorder, RoundedCornerShape(10.dp))
                                .padding(16.dp),
                        ) {
                            QrMatrixCanvas(
                                matrix = qrMatrix,
                                description = "Boarding pass barcode for ${pass.passenger}",
                            )
                            Text(
                                stringResource(Res.string.boarding_pass_scan_hint),
                                style = MaterialTheme.typography.bodyLarge,
                                color = PassMuted,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                    } else {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(PassSurfaceTint)
                                .border(1.dp, PassBorder, RoundedCornerShape(10.dp))
                                .padding(16.dp),
                        ) {
                            Text(
                                stringResource(Res.string.boarding_pass_no_barcode),
                                style = MaterialTheme.typography.bodyLarge,
                                color = PassMuted,
                            )
                        }
                    }

                    HorizontalDivider(color = PassBorder)

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (footerMeta.isNotEmpty()) {
                            Text(footerMeta, style = MaterialTheme.typography.bodyLarge, color = PassMuted, modifier = Modifier.weight(1f))
                        } else {
                            Spacer(modifier = Modifier.weight(1f))
                        }
                        OutlinedButton(onClick = onDismiss) {
                            Text(stringResource(Res.string.boarding_pass_done), color = PassInk)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PassStatCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = modifier) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = PassMuted, textAlign = TextAlign.Center)
        Text(value, style = MaterialTheme.typography.titleMedium, color = PassInk, textAlign = TextAlign.Center)
    }
}
