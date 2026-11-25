package app.travelmo.ui

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp
import app.travelmo.core.Landmark
import app.travelmo.core.tripLandmark

/** The outline of the landmark of the city [title] names (tripLandmark), else a suitcase; decoration, since the title says where. */
@Composable
fun TripLandmark(title: String, modifier: Modifier = Modifier) {
    val vector = remember(title) { landmarkVector(tripLandmark(title)) }
    Icon(vector, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier.size(40.dp))
}

/** [landmark]'s drawing: a 48-unit square stroked 1.5 units wide with round ends, as the web draws it. */
private fun landmarkVector(landmark: Landmark): ImageVector =
    ImageVector.Builder(name = landmark.id, defaultWidth = 48.dp, defaultHeight = 48.dp, viewportWidth = 48f, viewportHeight = 48f)
        .addPath(
            pathData = addPathNodes(landmark.d),
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.5f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
        .build()
