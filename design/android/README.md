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

## Tap map

Sign in → trip list. Gear → Settings; ⋮ → Sign out. Edinburgh (shared) → 05, any
other card → 04. On a trip: back → list, FAB → 07, a row's ⋮ → 06 (Edit → 08, a
target under Move to… or Delete → 04), Delete this trip → 09 (Keep → 04, Delete → 02).
Forms close with X. Settings: Connect Gmail → 11 (stands in for the OAuth round trip),
Disconnect → 10. Overlays dismiss through the scrim.

## Editing

Each board is a self-contained `.dc.html` page in the canvas's authoring format: keep
the `support.js` head line, the `<x-dc>` wrapper and the `data-dc-script` block; link
boards with `<a href="Other.dc.html">`; use only `var(--…)` colors from the stylesheet
so the dark theme keeps working. Republish changed files to the canvas URL above with
the Artifact tool, `root` = this folder, paths under `project/`.

Not boarded in round one: offline states, the interrupted-deletion trip, loading and
not-found texts, the rename dialog, Gmail return notices (all noted on the canvas), and
the future features from the brief.
