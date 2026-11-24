package app.travelmo.data

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// A feed with no label of its own is named by its link's host, as java.net.URI read it.
class CalendarFeedTest {
    @Test
    fun `names a feed by its label else its host else its link`() {
        CalendarFeedShown("f1", "https://www.tripit.com/feed/ical/private/abc/tripit.ics").name shouldBe "www.tripit.com"
        CalendarFeedShown("f2", "webcal://cal.example:8443/a.ics", label = "Work").name shouldBe "Work"
        CalendarFeedShown("f3", "not a link").name shouldBe "not a link"
    }

    @Test
    fun `reads the host past a user and a port`() {
        urlHost("https://user:pw@calendar.example:443/x.ics?k=v") shouldBe "calendar.example"
        urlHost("webcal://cal.example") shouldBe "cal.example"
        urlHost("https:///nothing").shouldBeNull()
        urlHost("calendar.example/x.ics").shouldBeNull()
    }
}
