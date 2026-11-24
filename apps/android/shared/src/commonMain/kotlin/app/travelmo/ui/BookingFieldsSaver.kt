package app.travelmo.ui

import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import app.travelmo.core.BookingFields
import app.travelmo.core.SegmentType

/** The form's fields across a configuration change, as a list of strings. */
val BookingFieldsSaver: Saver<BookingFields, Any> = listSaver(
    save = { f ->
        listOf(
            f.type.wire, f.title, f.provider, f.confirmation, f.startDate, f.startTime, f.startZone, f.endDate, f.endTime, f.endZone,
            f.originName, f.originCode, f.destinationName, f.destinationCode, f.originCountry, f.destinationCountry, f.notes,
        )
    },
    restore = { l ->
        BookingFields(
            type = SegmentType.fromWire(l[0]) ?: SegmentType.FLIGHT, title = l[1], provider = l[2], confirmation = l[3],
            startDate = l[4], startTime = l[5], startZone = l[6], endDate = l[7], endTime = l[8], endZone = l[9],
            originName = l[10], originCode = l[11], destinationName = l[12], destinationCode = l[13], originCountry = l[14], destinationCountry = l[15], notes = l[16],
        )
    },
)
