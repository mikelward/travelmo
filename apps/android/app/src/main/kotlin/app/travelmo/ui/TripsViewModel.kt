package app.travelmo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.travelmo.core.Segment
import app.travelmo.core.Trip
import app.travelmo.core.TripGroups
import app.travelmo.core.groupTrips
import app.travelmo.data.TripStore
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/** The trip list as the screen draws it; null groups while the first answer is on its way. */
data class TripListState(val groups: TripGroups?, val segmentsByTrip: Map<String, List<Segment>>, val now: String)

/** How many upcoming trips get a segment listener for their "next up" line, as on the web. */
const val UPCOMING_WITH_DETAILS = 3

@OptIn(ExperimentalCoroutinesApi::class)
class TripsViewModel(private val store: TripStore, private val uid: String, private val email: String?) : ViewModel() {
    /** The current instant, refreshed each minute so "next up" lines move on as events pass. */
    private val now: Flow<String> = flow {
        while (true) {
            emit(Instant.now().toString())
            delay(60_000)
        }
    }

    private val trips: Flow<List<Trip>?> = store.trips(uid, email).map<List<Trip>, List<Trip>?> { it }

    private val groups: Flow<TripGroups?> = combine(trips, now) { trips, _ -> trips?.let { groupTrips(it, LocalDate.now().toString()) } }

    private val details: Flow<Map<String, List<Segment>>> = groups.flatMapLatest { groups ->
        val wanted = groups?.let { it.current + it.upcoming.take(UPCOMING_WITH_DETAILS) }.orEmpty()
        if (wanted.isEmpty()) {
            flowOf(emptyMap())
        } else {
            combine(wanted.map { trip -> store.segments(trip.id).map { trip.id to it } }) { it.toMap() }
        }
    }

    val state: StateFlow<TripListState> = combine(groups, details, now) { groups, details, now -> TripListState(groups, details, now) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TripListState(null, emptyMap(), Instant.now().toString()))

    /** One trip, or null once the list has answered without it. */
    fun trip(id: String): Flow<Trip?> = trips.map { trips -> trips?.firstOrNull { it.id == id } }

    fun segments(tripId: String): Flow<List<Segment>> = store.segments(tripId)
}
