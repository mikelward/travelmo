package app.travelmo.log

import com.mikelward.androidlog.DebugLog

/**
 * The app's debug log: the fleet's shared recorder (mikelward/androidlog),
 * whose privacy floor decides what a line may carry. A call site passes a
 * string only as `safe(...)` (fixed vocabulary) or `sensitive(...)` (the
 * user's own), and the sinks decide the rest.
 */
object TravelmoLog : DebugLog()
