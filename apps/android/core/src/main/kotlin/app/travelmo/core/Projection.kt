package app.travelmo.core

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

// The Equal Earth projection (Šavrič, Patterson and Jenny, 2018), as
// packages/core/src/projection.ts: countries keep their true relative
// sizes, and the web's map was drawn with the same formula, so a place
// projected here lands on it.

private const val A1 = 1.340264
private const val A2 = -0.081106
private const val A3 = 0.000893
private const val A4 = 0.003796
private val M = sqrt(3.0) / 2

/** Longitude and latitude in degrees to x (east) and y (south), in Earth radii: x within ±2.71, y within ±1.32. */
fun equalEarth(lon: Double, lat: Double): Pair<Double, Double> {
    val lambda = lon * PI / 180
    val theta = asin(M * sin(lat * PI / 180))
    val t2 = theta * theta
    val t6 = t2 * t2 * t2
    val x = lambda * cos(theta) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)))
    val y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
    return x to -y
}
