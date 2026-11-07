package app.travelmo.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.Trip
import app.travelmo.core.TripGroups
import app.travelmo.core.groupTrips
import app.travelmo.data.TripStore
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The trip list as the screen draws it; null groups while the first answer is on its way. */
data class TripListState(val groups: TripGroups?, val segmentsByTrip: Map<String, List<Segment>>, val now: String)

/** A booking save as the form that asked for it sees it. */
sealed interface BookingSave {
    data object Busy : BookingSave

    data object Done : BookingSave

    data class Failed(val message: String) : BookingSave
}

/** How many upcoming trips get a segment listener for their "next up" line, as on the web. */
const val UPCOMING_WITH_DETAILS = 3

@OptIn(ExperimentalCoroutinesApi::class)
class TripsViewModel(
    private val store: TripStore,
    private val uid: String,
    private val email: String?,
    /** The clock, replaceable so a test renders a fixed moment. */
    private val clock: () -> Instant = { Instant.now() },
) : ViewModel() {
    /** Today's date on this device, as grouping and the calendar read it. */
    fun today(): String = LocalDate.ofInstant(clock(), ZoneId.systemDefault()).toString()

    /** The current instant, refreshed each minute so "next up" lines move on as events pass. */
    private val now: Flow<String> = flow {
        while (true) {
            emit(clock().toString())
            delay(60_000)
        }
    }

    /** Every trip of the user's, own and shared; null until the first answer. */
    val trips: StateFlow<List<Trip>?> = store.trips(uid, email).map<List<Trip>, List<Trip>?> { it }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val groups: Flow<TripGroups?> = combine(trips, now) { trips, _ -> trips?.let { groupTrips(it, today()) } }

    private val details: Flow<Map<String, List<Segment>>> = groups.flatMapLatest { groups ->
        val wanted = groups?.let { it.current + it.upcoming.take(UPCOMING_WITH_DETAILS) }.orEmpty()
        if (wanted.isEmpty()) {
            flowOf(emptyMap())
        } else {
            combine(wanted.map { trip -> store.segments(trip.id).map { trip.id to it } }) { it.toMap() }
        }
    }

    val state: StateFlow<TripListState> = combine(groups, details, now) { groups, details, now -> TripListState(groups, details, now) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), TripListState(null, emptyMap(), clock().toString()))

    /** One trip, or null once the list has answered without it. */
    fun trip(id: String): Flow<Trip?> = trips.map { trips -> trips?.firstOrNull { it.id == id } }

    fun segments(tripId: String): Flow<List<Segment>> = store.segments(tripId)

    private val _bookingSaves = MutableStateFlow<Map<String, BookingSave>>(emptyMap())

    /** Each form's booking save, by the form's token, until that form has seen its outcome. */
    val bookingSaves: StateFlow<Map<String, BookingSave>> = _bookingSaves.asStateFlow()

    /**
     * Saves a booking for the form with `token`, in this scope rather than
     * the form's: a rotation mid-save recreates the form but not this, so the
     * outcome still reaches it, and a second tap on that form while its save
     * is in flight does nothing rather than write a second booking. Saves are
     * kept per form, so one form's pending save never swallows another's.
     */
    fun saveSegment(token: String, tripId: String, draft: SegmentDraft, existingId: String?) {
        if (_bookingSaves.value[token] is BookingSave.Busy) return
        _bookingSaves.update { it + (token to BookingSave.Busy) }
        viewModelScope.launch {
            val outcome = try {
                store.saveSegment(tripId, draft, existingId)
                BookingSave.Done
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                BookingSave.Failed(e.message ?: e.javaClass.simpleName)
            }
            _bookingSaves.update { it + (token to outcome) }
        }
    }

    /** The form with `token` has acted on its save's outcome. */
    fun bookingSaveSeen(token: String) {
        _bookingSaves.update { it - token }
    }

    suspend fun deleteSegment(tripId: String, segmentId: String) = store.deleteSegment(tripId, segmentId)
}
