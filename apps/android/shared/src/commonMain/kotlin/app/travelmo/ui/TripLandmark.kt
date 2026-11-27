package app.travelmo.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp
import app.travelmo.core.Landmark
import app.travelmo.core.tripBookingType
import app.travelmo.core.tripPicture
import org.jetbrains.compose.resources.painterResource

/**
 * A trip's picture: for a trip that is just an event, its booking's own icon ([tripBookingType]: a dinner's calendar,
 * a show's ticket); else ([tripPicture]) the outline of the landmark of the city [title] names, else of the kind of
 * place it goes to ([setting]), else a suitcase. Decoration, since the title says where.
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
    val vector = remember(title, setting) { landmarkVector(tripPicture(title, setting)) }
    Icon(vector, contentDescription = null, tint = tint, modifier = modifier.size(40.dp))
}

// Built vector cache keyed by landmark id (Compose UI runs on the main thread), so scrolling through
// repeated city or setting landmarks avoids re-parsing SVG path strings on every row.
private val landmarkVectors = mutableMapOf<String, ImageVector>()

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
