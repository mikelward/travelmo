# Android prototype

Clickable mockups of the Android app in Material Design 3 idioms with Travelmo's
palette, published as a Design canvas: https://claude.ai/artifact/UEt8EjMDgyCUh3Lr1AUS5f
(private until shared from its Share menu). The files here are the canvas's own
files, so the two stay in step: `project/canvas.json` lays the boards out and holds
the notes, `project/*.dc.html` is one board each, `project/styles/travelmo.css` the
shared theme and components.

Strings, states and who-sees-what follow the web app (`apps/web`) exactly; the boards
show the product as it is, rough edges included (see the orange note on the canvas).
Sample data is fictional; the signed-in address is a placeholder.

## Boards

| File | Screen |
|---|---|
| `Main.dc.html` | 01 Sign-in (the entry) |
| `SignInError.dc.html` | 01b Sign-in with the raw auth error |
| `TripList.dc.html` | 02 Trip list: Now / Upcoming / Past, next-up lines |
| `TripListMenu.dc.html` | 02b Overflow menu: Sign out |
| `TripListEmpty.dc.html` | 03 Empty list |
| `TripListDark.dc.html` | 14 Trip list in the dark theme |
| `TripDetail.dc.html` | 04 Trip detail as the owner (Liverpool) |
| `TripDetailShared.dc.html` | 05 Trip detail as a sharee (Edinburgh) |
| `BookingActions.dc.html` | 06 Booking actions sheet: Edit, Move to…, Delete |
| `DeleteTrip.dc.html` | 09 Delete trip dialog |
| `AddBooking.dc.html` | 07 Add a booking (flight) |
| `EditBooking.dc.html` | 08 Edit booking (stay) with a validation error |
| `SettingsNew.dc.html` | 10 Settings before Gmail is connected |
| `SettingsConnected.dc.html` | 11 Settings connected, with import results and review list |
| `Offline.dc.html` | 15 Trip list with the offline banner |
| `OfflinePage.dc.html` | 16 The offline page the service worker serves |
| `Loading.dc.html` | 17 Trip detail while loading |
| `NotFound.dc.html` | 18 Trip not found (or not shared with you) |
| `DeletingTrip.dc.html` | 19 Trip whose deletion was interrupted |
| `RenameTrip.dc.html` | 20 Rename dialog with its validation error |
| `Reports.dc.html` | 21 Reports: summary, map, days per country, trips per year |
| `Profile.dc.html` | 22 Travel profile: documents, loyalty, travelers, sharing |
| `TripDetailWarning.dc.html` | 23 Trip detail with passport reminders (red and amber) |
| `TripListWarning.dc.html` | 24 Trip list with a reminder on a card |
| `SettingsImports.dc.html` | 25 Settings: TripIt preview, calendar files, feeds, Google Calendar, calendar link |
| `TripDetailDark.dc.html` | 26 Trip detail, dark |
| `AddBookingDark.dc.html` | 27 Add a booking, dark, with address suggestions open |
| `SettingsDark.dc.html` | 28 Settings, dark |
| `ReportsDark.dc.html` | 29 Reports, dark |
| `Calendar.dc.html` | 30 Calendar: a month of trips as bars |
| `CalendarDark.dc.html` | 31 Calendar, dark |

## Tap map

Sign in → trip list. The navigation bar (Trips, Calendar, Reports, Profile) switches
between 02, 30, 21 and 22; gear → Settings; ⋮ → Sign out. On 30 a bar opens its trip. Edinburgh (shared) → 05, any
other card → 04. On 24 the Lisbon card → 23. On a trip: back → list, FAB → 07, a row's ⋮ → 06 (Edit → 08, a
target under Move to… or Delete → 04), Delete this trip → 09 (Keep → 04, Delete → 02).
Forms close with X. Settings: Connect Gmail → 11 (stands in for the OAuth round trip),
Disconnect → 10. Overlays dismiss through the scrim.

## Editing

Each board is a self-contained `.dc.html` page in the canvas's authoring format: keep
the `support.js` head line, the `<x-dc>` wrapper and the `data-dc-script` block; link
boards with `<a href="Other.dc.html">`; use only `var(--…)` colors from the stylesheet
so the dark theme keeps working. Republish changed files to the canvas URL above with
the Artifact tool, `root` = this folder, paths under `project/`.

Round two (boards 15–29) added the states round one left out and the features the web
app has since grown: Reports, the travel profile, passport and visa reminders, the import
and calendar sections of Settings, and address suggestions in the booking form. Round
two also introduced a Material 3 navigation bar with three destinations (Trips, Reports,
Profile), since the app now has them; Settings stays behind the gear. Still not
boarded: Gmail return notices, Google Calendar's calendar picker, the merge-trip sheet.
The map on 21 is a sketch, not the real world map.

Round three (boards 30–31, and changes to 04, 21, 22, 26, 29) caught up with the web
app again: the calendar as a fourth destination in the navigation bar (a month of
weeks, Monday first, each trip a bar across its days, shared trips violet, a
carried-over bar starting with an ellipsis, today ringed); the loyalty table at the
top of Profile with the full entries folded below; the viewer's matching loyalty
program under a booking's provider line; and smaller dots on the Reports map for
places whose booking knows its spot.
