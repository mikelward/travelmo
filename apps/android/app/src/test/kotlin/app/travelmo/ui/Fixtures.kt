package app.travelmo.ui

import app.travelmo.core.Place
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.Trip
import app.travelmo.data.TripStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

// The invented trips of design/android's boards, as the screenshot tests
// render them: the owner is "owner", today is 1 November 2026, and the
// Edinburgh trip is someone else's, shared with the owner.

const val OWNER = "owner"
const val OWNER_EMAIL = "owner@example.com"
const val FROZEN_NOW = "2026-11-01T12:00:00Z"

private fun trip(id: String, title: String, start: String, end: String, owner: String = OWNER, deleting: Boolean = false) =
    Trip(id, title, start, end, owner, sharedWith = if (owner == OWNER) emptyList() else listOf(OWNER_EMAIL), deleting = deleting)

val fixtureTrips = listOf(
    trip("edinburgh", "Edinburgh", "2026-10-31", "2026-11-03", owner = "partner"),
    trip("dublin", "Dublin", "2026-11-28", "2026-12-02"),
    trip("liverpool", "Liverpool", "2026-12-12", "2026-12-14"),
    trip("lisbon", "Lisbon", "2026-09-14", "2026-09-19"),
    trip("cornwall", "Cornwall", "2026-08-01", "2026-08-05", deleting = true),
    trip("paris", "Paris", "2026-03-20", "2026-03-22"),
)

val fixtureSegments: Map<String, List<Segment>> = mapOf(
    "edinburgh" to listOf(
        Segment("e-stay", "edinburgh", SegmentType.LODGING, "Grassmarket Hotel", "2026-10-31T15:00:00+00:00", "2026-11-03T11:00:00+00:00", provider = "Grassmarket", confirmation = "GM-2210"),
    ),
    "dublin" to listOf(
        Segment(
            "d-flight", "dublin", SegmentType.FLIGHT, "FR 123 MAN to DUB", "2026-11-28T07:10:00+00:00", "2026-11-28T08:15:00+00:00",
            provider = "Ryanair", confirmation = "ABC123", origin = Place("Manchester", code = "MAN", country = "GB"), destination = Place("Dublin", code = "DUB", country = "IE"),
        ),
    ),
    "liverpool" to listOf(
        Segment(
            "l-train", "liverpool", SegmentType.TRAIN, "Avanti to Liverpool", "2026-12-12T09:07:00+00:00", "2026-12-12T11:25:00+00:00",
            provider = "Avanti West Coast", confirmation = "ABC123", origin = Place("London Euston", code = "EUS"), destination = Place("Liverpool Lime Street", code = "LIV"),
            sender = "avantiwestcoast.example", sourceCount = 1,
        ),
        Segment(
            "l-stay", "liverpool", SegmentType.LODGING, "Cove Liverpool", "2026-12-12T15:00:00+00:00", "2026-12-13T11:00:00+00:00",
            provider = "Cove", confirmation = "CV-55120", notes = "Late check-in after 22:00: call reception", sender = "cove.example", sourceCount = 2, rating = 4, favorite = true,
        ),
        Segment("l-tour", "liverpool", SegmentType.ACTIVITY, "Anfield stadium tour", "2026-12-13T14:00:00+00:00", "2026-12-13T15:30:00+00:00", provider = "Liverpool FC", confirmation = "LFC-4471"),
    ),
)

class FakeTripStore(private val trips: List<Trip> = fixtureTrips, private val segments: Map<String, List<Segment>> = fixtureSegments) : TripStore {
    override fun trips(uid: String, email: String?): Flow<List<Trip>> = flowOf(trips)
    override fun segments(tripId: String): Flow<List<Segment>> = flowOf(segments[tripId].orEmpty())
}
