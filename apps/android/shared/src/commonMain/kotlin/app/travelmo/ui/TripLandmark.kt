package app.travelmo.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp
import app.travelmo.core.Landmark
import app.travelmo.core.tripBookingType
import app.travelmo.core.tripPicture
import org.jetbrains.compose.resources.painterResource

/**
 * A trip's picture: for a trip that is just an event, its booking's own icon ([tripBookingType]: a dinner's fork and
 * knife, a show's ticket); else ([tripPicture]) the outline of the landmark of the city [title] names, else of the kind
 * of place it goes to ([setting]), else a suitcase. Decoration, since the title says where.
 */
@Composable
fun TripLandmark(title: String, setting: String?, modifier: Modifier = Modifier) {
    val tint = MaterialTheme.colorScheme.onSurfaceVariant
    val booking = tripBookingType(setting)
    if (booking != null) {
        Box(modifier.size(40.dp), contentAlignment = Alignment.Center) {
            Icon(painterResource(segmentIcon(booking)), contentDescription = null, tint = tint, modifier = Modifier.size(28.dp))
        }
        return
    }
    val picture = remember(title, setting) { tripPicture(title, setting) }
    if (picture.dashed != null) {
        val paths = remember(picture.id) { landmarkDashedPaths(picture) }
        Canvas(modifier = modifier.size(40.dp)) {
            val scale = minOf(size.width, size.height) / 48f
            val dx = (size.width - 48f * scale) / 2f
            val dy = (size.height - 48f * scale) / 2f
            withTransform({
                translate(left = dx, top = dy)
                scale(scale, scale, pivot = Offset.Zero)
            }) {
                drawPath(paths.solid, color = tint, style = SOLID_STROKE)
                drawPath(paths.dashed, color = tint.copy(alpha = 0.7f), style = DASHED_STROKE)
            }
        }
        return
    }
    val vector = remember(picture.id) { landmarkVector(picture) }
    Icon(vector, contentDescription = null, tint = tint, modifier = modifier.size(40.dp))
}

private val SOLID_STROKE = Stroke(width = 1.5f, cap = StrokeCap.Round, join = StrokeJoin.Round)
private val DASHED_STROKE = Stroke(
    width = 1.5f,
    cap = StrokeCap.Round,
    join = StrokeJoin.Round,
    pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.4f, 2.2f)),
)

private class DashedPaths(val solid: Path, val dashed: Path)

// Built caches keyed by landmark id (Compose UI runs on the main thread), so scrolling through
// repeated city, country or setting landmarks avoids re-parsing SVG path strings on every row.
private val landmarkVectors = mutableMapOf<String, ImageVector>()
private val landmarkDashed = mutableMapOf<String, DashedPaths>()

/** [landmark]'s drawing: a 48-unit square stroked 1.5 units wide with round ends, as the web draws it. */
private fun landmarkVector(landmark: Landmark): ImageVector =
    landmarkVectors.getOrPut(landmark.id) {
        ImageVector.Builder(name = landmark.id, defaultWidth = 48.dp, defaultHeight = 48.dp, viewportWidth = 48f, viewportHeight = 48f)
            .addPath(
                pathData = addPathNodes(landmark.d),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.5f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
            .build()
    }

private fun landmarkDashedPaths(landmark: Landmark): DashedPaths =
    landmarkDashed.getOrPut(landmark.id) {
        DashedPaths(
            solid = PathParser().parsePathString(landmark.d).toPath(),
            dashed = PathParser().parsePathString(checkNotNull(landmark.dashed)).toPath(),
        )
    }
