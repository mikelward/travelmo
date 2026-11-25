package app.travelmo.core

/**
 * Where a booking's directions lead, as packages/core's directionsPlace: a
 * journey's or a car rental's start (the airport, station or desk you head
 * to), anything else's place (the stay, the venue). Null for a cancelled
 * booking or one with no place.
 */
fun directionsPlace(segment: Segment): Place? {
    if (segment.isCancelled) return null
    val fromStart = segment.type in setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY, SegmentType.CAR_RENTAL)
    return if (fromStart) segment.origin ?: segment.destination else segment.destination ?: segment.origin
}

/**
 * What Maps is asked to find, as packages/core's directionsQuery: the place's name with its address, else its
 * name with its town (Maps finds a hotel by name better than a geocoded spot, which may be only the town's
 * middle), else its spot on the map, else its name.
 */
fun directionsQuery(place: Place): String {
    val address = place.address
    if (address != null) return if (address.contains(place.name, ignoreCase = true)) address else "${place.name}, $address"
    val city = place.city
    if (city != null) return if (place.name.contains(city, ignoreCase = true)) place.name else "${place.name}, $city"
    if (place.lat != null && place.lon != null) return "${formatCoordinate(place.lat)},${formatCoordinate(place.lon)}"
    return place.name
}

/** Google Maps' directions to a booking's place, which phones open in the Maps app; null when it has none. */
fun directionsUrl(segment: Segment): String? =
    directionsPlace(segment)?.let { "https://www.google.com/maps/dir/?api=1&destination=${encodeUriComponent(directionsQuery(it))}" }

// As JavaScript prints a number: 36.17, not 36.17000; -115, not -115.0.
private fun formatCoordinate(value: Double): String = if (value == kotlin.math.floor(value)) value.toLong().toString() else value.toString()
