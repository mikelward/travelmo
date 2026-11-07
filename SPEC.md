# Travelmo specification

## Goal

A travel planner in the TripIt mold: one account holds every trip, trips are
imported from booking emails rather than typed in, the trip list loads fast,
and a partner can see a trip you share. Website first, installable as a PWA
on Android; native apps later without a rewrite.

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind | Static shells with client-side Firestore reads load instantly; React code and schemas carry over to React Native later |
| Hosting | Firebase App Hosting | Same project as Auth, Firestore and the worker; managed Next.js SSR on Cloud Run; scales to zero. Cloud Run with `apps/parser`-style Dockerfile is the fallback; Vercel was considered and rejected to keep one cloud and one bill |
| Auth | Firebase Auth, Google sign-in | Free at this scale; verified email is what sharing keys on |
| Data | Firestore | Realtime listeners, offline cache for the future mobile app, per-document rules make sharing a field, not a service |
| Email | Gmail API, OAuth refresh token, Pub/Sub push | Near-realtime import with no polling |
| Worker | Cloud Run (Hono, Node 22) | Pay per request; also hosts the OAuth flow so the web app needs no secrets |
| Extraction | Gemini via `@google/genai`, JSON schema output | Cheapest model that reliably fills a strict schema; model name is configurable |
| Mobile | PWA now, React Native + Expo later | `packages/core` already holds the schemas and logic a native app needs |

## Data model

ISO 8601 strings throughout, never Firestore Timestamps, so every client
reads the same document. Segment instants carry the local UTC offset of the
place they happen in and are displayed as written, not converted to the
viewer's zone. Trip bounds are calendar dates.

- `trips/{tripId}` — `title, start, end, ownerUid, sharedWith[], deleting?,
  createdAt, updatedAt`. `sharedWith` holds lowercase email addresses;
  `deleting` marks a trip whose segments are being removed.
- `trips/{tripId}/segments/{segmentId}` — `type` (flight, train, bus, ferry,
  lodging, car_rental, activity, other), `title, provider, confirmation,
  start, end, origin, destination, notes, source, gmailMessageIds[], sources[],
  sender` (the booking email's domain), `rating` (one to five) and
  `favorite`, the traveler's own verdict. `source` is `gmail`, `manual`,
  `tripit` or `ics`: where the booking first came from. `sources` lists every
  email, TripIt item or calendar event it was read from (`kind, id, label,
  uid, at`), including later ones dropped as duplicates of it; the trip page
  shows them all, each email linking into Gmail for the user who imported
  it (`uid`; the trip's owner for sources recorded without one), wherever
  the booking has since moved.
  Imported segments use the id `<source id>-<index>` (the Gmail message id,
  or `tripit-<key>` for a TripIt trip) so a re-import overwrites rather than
  duplicates.
- `users/{uid}` — `email, displayName, photoURL, gmail {emailAddress,
  connectedAt, watchExpiration, historyId, backfill}, googleCalendar
  {emailAddress, connectedAt, calendars[]}, reminders {email, push}`. `gmail` and
  `googleCalendar` are server-written; `reminders` is the owner's choice; `backfill` is how far a reading of the whole mailbox has
  got (`cursor, scanned, imported, failed, done, updatedAt`); each calendar
  is `{id, summary, primary, selected, lastReadAt, lastResult, lastError}`.
- `users/{uid}/pushSubscriptions/{id}` — `endpoint, keys {p256dh, auth},
  createdAt`: one per browser that asked for notifications, written by that
  browser, read and pruned by the parser.
- `users/{uid}/settings/patterns` — `allow[], deny[]` sender domains.
- `users/{uid}/travelProfile/main` — `ownerUid, ownerEmail, trustedEmails[],
  travelers[], loyalty[], documents[], importedAt, updatedAt`: the traveler's
  own details from a TripIt export, each entry a `{title, fields[{label,
  value}]}`. The parser writes the sections; the owner sets `trustedEmails`.
- `users/{uid}/feeds/{feedId}` — `url, label, addedAt, lastFetchedAt,
  lastResult, lastError`: subscribed calendar feeds. The owner reads them;
  the parser alone writes them.
- `geocodes/{key}` — `query, status (ok | none), country, city, lat, lon,
  at`: the geocoder's answer for a normalized place query (`key` is its
  hash), shared by every user, so a name is looked up once ever;
  `geocodeBudget/{day}` — `calls`, the day's count against
  `GEOCODE_DAILY_LIMIT`; `geocodeRetries/{tripId__segmentId}` — `uid,
  tripId, segmentId, at`, a booking a spent budget left with a place to ask
  about another day. All three are the parser's alone.
- `users/{uid}/parsedMessages/{sourceId}` — `outcome` (processing,
  filtered, not_booking, imported, failed), `source` (absent for Gmail,
  `tripit` or `ics` otherwise), `reason, from, subject, segmentIds[],
  processedAt`, one per Gmail message, TripIt trip, unfiled TripIt item or
  calendar event. Claimed atomically as `processing` before any
  work, so a message delivered twice is imported once; a `processing` claim
  older than fifteen minutes is a dead worker's and may be taken over. Also
  the audit trail of what the LLM was shown, and the source of the review
  list in Settings.
- `users/{uid}/private/gmail` — the refresh token and watch state;
  `users/{uid}/private/googleCalendar` — the Calendar refresh token and the
  calendar list, `googleCalendarAliases-<hash>` per calendar the event ids
  of deleted events still need. Server only. `users/{uid}/private/import` is read and written by every import
  transaction, serializing trip assignment per user.
  `users/{uid}/private/examples` — `bookings[], others[]` of `{subject,
  vector}`, the embeddings the similarity pre-filter compares against.
- `gmailAccounts/{emailAddress}` → `{uid}`, one owner per mailbox, enforced in
  a transaction; `oauthStates/{nonce}` → `{uid, createdAt}`;
  `pendingConnections/{token}` → `{uid, refreshToken, createdAt}`, parked
  tokens awaiting an authenticated completion. Server only; each redeemed
  once, within ten minutes.

Schemas live in `packages/core/src/schema.ts`; paths in `paths.ts`.

## Testing

Pure logic lives in `packages/core` with unit tests. The parser's import
pipeline is tested with an in-memory store, and its Firestore store and
connection handling against the Firestore emulator. The rules have their own
emulator tests, and the web app's mutation workflows run against the
emulator with the real rules loaded. End-to-end Playwright tests drive a
production build of the web app in Chromium against the Auth and Firestore
emulators, including a reload with the network cut; when the app is pointed
at the Auth emulator it exposes `window.travelmoTestSignIn(email)`, which
signs in with the fake Google credential the emulator accepts, so the tests
need no popup.

## The trip list

Trips are grouped into now, upcoming and past by calendar date. Trips under
way also show what comes next — the soonest booking start still ahead, or
the end of one under way (check-out, arrival, car return) — read from their
segments with one listener each; the next three upcoming trips get a
listener too, so their document warnings know where they go, but their
cards say only the title and the dates, since what comes next is for a
trip under way; past trips and further-off ones get no listener, to keep
Firestore reads in check.
The same card says how soon that is when it is within a week ("in 25 min",
"in 3 h 20 min", "tomorrow", "on Sun"), counted in the place's own offset;
names the stay under way and when it ends; and, for the next flight, when
online check-in opens (a day before departure, which most airlines honor,
so the card says "usually") from a day before that, then that it is open,
with the booking reference at hand (`packages/core/src/status.ts`). The
clock behind these lines ticks once a minute.

`/calendar` shows the same trips month by month (`packages/core/src/calendar.ts`):
weeks run Monday to Sunday, padded with the neighboring months' days, and
each trip is a bar across the days it covers, clipped at the week's edges
with an ellipsis where it carries over, stacked into lanes so overlapping
trips never share a row, and linking to the trip; a trip shared with the
viewer is a different color. Previous, next and today move between months.
It reads the trip list it already has and nothing more: no bookings, so no
listener per trip.

## Reports

`/reports` counts, from the trips the viewer can see (their own and those
shared with them, each once), the trips begun each year, the days away, the
days spent in each country, and draws a world map with those countries
filled, the airports flown through marked, and a smaller dot for every other
place (a stay, a station, a restaurant) whose booking knows its coordinates.
A year picker narrows the
counts and the map to one year; the trips-per-year table always shows every
year. Trips still ahead are not counted, and a trip under way counts up to
today.

A place's country is the one its booking names, and its spot (`lat`, `lon`)
the one its booking carries. Imports fill both in when the source gave none:
a flight's from its airport code (`packages/core/src/airportPlaces.json`,
generated from the same OpenFlights data as the zone table, which also gives
the airport's coordinates for the map), anything else's from Google's
Geocoding API (`packages/core/src/geocode.ts` for what to ask and how to read
the answer, `apps/parser/src/geocode.ts` for the call), asked once per
distinct place name (with the country on the end when the source named one),
cached in `geocodes`, and capped per day; the city is filled too when the
source left it out. A place that has its country and lacks only its spot is
asked about as well, but may use only half the day's budget, so a backlog of
dots never crowds out the countries the reports need. A name Google cannot
place stays as it was, and a hand-entered booking is not geocoded (the
client writes it), though an address pick in the form sets the spot. A
place's own coordinates (TripIt's, or a pick's) are never overwritten.
A booking the spent budget put off is queued in `geocodeRetries` and asked
about again by the daily sweep (`/internal/geocode-sweep`, from Cloud
Scheduler early in the UTC day, `apps/parser/src/geocodeSweep.ts`): oldest
first, up to 200 a day, writing what it learns under the user's import lock
only if the booking has not been edited since, dropping an entry once it is
answered (a "none" included), its booking is gone, or it is thirty days old,
and stopping for the day when the budget runs out again.
Station and ferry codes are never read as airport codes. Each day of a trip counts for every country the
traveler was in that day: a booking's start and end say where they were,
and between bookings they stay where the last one (in time, not by local
date, which differ across the date line) left them. So a travel day
counts for both ends of the journey, an overnight flight's departure day
counts only where it left, and a day nothing places (before a trip's first
booking, or after one whose destination has no country) counts for no
country. Overlapping trips count a shared day once, and each airport is
marked in the year the traveler was at it. The page says how many
days and bookings it could not place, rather than leaving them out silently.

The page reads every trip's bookings once when it opens (one query per trip,
not a listener each) and computes everything in the browser
(`packages/core/src/reports.ts`). The map, Natural Earth's 1:110m countries
in the Equal Earth projection drawn to SVG paths by
`apps/web/scripts/worldmap.mjs` (`apps/web/src/lib/worldMap.json`, 27 KB
compressed), and the airport table load only on this page.

## Document reminders

A passport, visa or other document in a travel profile with an expiry date
the page can read (a field labeled like "Expiration date" or "Valid until",
written as an ISO date or with the month in words; all-number dates such as
06/05/2031 are skipped, since the US and Europe read them differently) is
checked against every trip still to come or under way. The trip page and its
card in the list say when one runs out before the trip ends, or, for a
passport, within six months after it, since many countries require that
much validity. The viewer's own documents count, and those of anyone who
shared their profile with the viewer and is on the trip (its owner, or
someone it is shared with). A passport is not mentioned for a trip whose
bookings all lie in the country that issued it, nor a visa for a trip known
not to go to its country; when a booking's country is unknown, the warning
shows anyway. Telling whether a flight crosses a border needs the airport
table, which loads only once some trip has a document worth checking, and
nothing shows until it has. The warning names the document's kind and date,
never its number. The list checks the trips it already reads bookings for
(under way and the next three) and shows what it finds once, in one card
at its top, each document for the earliest-ending trip it bears on, named
and linked, rather than on every card; every trip page checks its own and
says "this trip".

The trip page also says what each traveler's passport needs to enter the
trip's countries (`packages/core/src/visas.ts`): visa-free with the days
allowed, visa on arrival, an electronic travel authorization, an e-visa, a
visa, or no admission, for every country of the trip but the passport's own,
with the easiest of the traveler's valid passports chosen (more visa-free
days first) and a visa the profile holds for the country noted when it lasts
the trip. The rules are the Passport Index dataset
(https://github.com/imorte/passport-index-data, MIT, compiled from
passportindex.org), generated into `packages/core/src/visaRules.json` by
`packages/core/scripts/visas.mjs` as one character per passport and
destination (42 KB, loaded with the airport table only by a trip page that
needs it) and refreshed by hand: the file records the day it was fetched, the
box shows that month and says that rules change and depend on the stay, so
the embassy has the last word. Lines needing action (an authorization, an
e-visa, a visa, no admission) stand out; a visa the traveler holds covers
them.

Reminders by email carry the same lines. Whoever turns them on in Settings
(`reminders.email` on their user document) gets, from the parser's daily
`/internal/reminders` job, one plain-text email on any day something is new
for a trip under way or starting within thirty days: every document warning
and every entry requirement that needs action and no held visa covers,
worded as the trip page words them, with a link to the trip and to Settings.
A log per trip (`users/{uid}/reminders/{tripId}`, the parser's alone) holds
the lines already sent, so each goes once; a line that changes (a new date)
is a new line. Mail goes to the signed-in address when Google has verified
it, through SMTP (`SMTP_HOST` and friends; `apps/parser/src/mail.ts`, with
the trip title collapsed to one line before it becomes a subject), and the
job is off without a host. A failed send is logged and tried again the next
day, since nothing is marked sent until the mail went.

Reminders as notifications carry the same news to the browsers that asked.
The switch in Settings is per browser: it asks the browser's permission,
subscribes through the service worker with the app's VAPID public key
(`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) and writes the subscription under the user
(`users/{uid}/pushSubscriptions/{id}`, the id a hash of the endpoint), and
sets `reminders.push`, which the last browser to unsubscribe clears. The
same daily job sends one notification per trip (`reminderNotifications` in
core: the title, when the trip starts, the lines, the trip's URL as the tap
target, a tag per trip so a later one replaces it) to every subscription,
signed with the private key the parser holds (`VAPID_PRIVATE_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`; `apps/parser/src/push.ts`, the
`web-push` library) with a day to live; the worker (`src/sw.ts`) shows it
and opens the trip on a tap. An endpoint is whatever the browser wrote, so
it is held to the calendar-feed rule (https on the standard port, public
addresses only, checked at the connection) and one that fails is dropped
like one the push service reports gone. The switch reads as on only when
the browser's subscription is recorded under the signed-in account, so a
second account on the same browser starts off, and turning it off forgets
the browser for that account alone, leaving the browser's subscription to
any other account that recorded it. Lines are marked sent once every channel the person turned on
has taken them, so a failure on one keeps the day's news for tomorrow on
both, as does a day on which no browser was left to take them. A
notification is kept within the payload a push service guarantees to carry
(3993 bytes, RFC 8291): a trip with more news than fits says how many more
lines wait on its page. Each send has a socket timeout, so one quiet
endpoint cannot stall the run for everyone after it.

## Editing by hand

The owner and anyone the trip is shared with can add, edit and delete
segments on a trip page; only the owner renames, shares or deletes the trip.
The same people can rate a booking one to five stars and mark it a favorite
(`rating`, `favorite` on the segment; tapping the current star clears the
rating): an edit like any other, moving the booking's revision, so a calendar
change no longer replaces it and the verdict survives. Reports lists the
places rated or marked, favorites first with the best rating given, each
linking to the trips it was on (`packages/core/src/favorites.ts`: a place is
where a journey ends or where a stay is, by name and country).
A manual segment carries `source: "manual"` and the same
shape as an imported one; the form takes a local date, time and time zone
for each end and stores the instant with that zone's offset on that date, so
it reads back exactly as the traveler sees it. Typing a known airport code
into From or To preselects that end's zone from a generated table of IATA
codes (`packages/core/src/airports.json`, from the OpenFlights airport
database, loaded on demand); the picker still has the last word. An
imported instant carries only an offset, so editing one offers that offset
"as imported" alongside the zones, and keeps it unless the editor picks a
zone. With a Places API (New) key (`NEXT_PUBLIC_GOOGLE_MAPS_KEY`, a browser
key restricted to the app's origins), the From, To and Where fields offer
places as the user types (`apps/web/src/components/PlaceInput.tsx`): three
characters of a street, a hotel, a UK postcode or a US ZIP, debounced, under
one session token until the pick, which fetches the place's address
components, formatted address and location (all in the cheapest field mask)
and fills the place's name, city, country, `address` and spot; typing over
the name afterwards drops the city, address and spot again. Without a key the fields are plain inputs.
A place's country is an optional
picker, never required or prompted for, and not shown for a flight, whose
airport code says it; it only helps the reports place a booking. Fields the
form does not show (a place's city, a flight's place's country) survive an
edit. On a phone each time zone takes its own line, so no field pushes the
form wider than the screen. A
segment write widens the trip's bounds to include it, in a transaction so
concurrent saves both count; bounds never shrink on save, here or in the
parser, because a client transaction cannot read every segment. When the
bookings span less than the trip, the owner is offered "Fit dates to
bookings", which reads every segment and sets the bounds to their span,
re-reading if the trip's `updatedAt` (bumped by every segment write) moved in
between. Deleting a trip
first sets `deleting: true` on it, which every segment writer (the web
transaction, the parser's import transaction and the rules) refuses, then
deletes its segments and finally the trip, since Firestore does not cascade.
Each step is idempotent, so a deletion the browser interrupted shows in the
list as "Deleting" and the trip page offers to finish it.

A booking can be moved to another trip the viewer can edit: it keeps its id
under the new trip, the target widens to hold it and the source's dates stay.
The owner can merge a trip into another: every booking moves, the target
widens, the source is deleted, and the target keeps its own sharing list.
Both run as transactions; the merge reads the source's bookings first and
re-reads if the source's `updatedAt` moved in between.

## Offline

The app is installable, and a trip opened once stays readable with no
network. Two caches do that:

- Firestore's persistent local cache (IndexedDB, shared between tabs) keeps
  every document a listener has seen, so the trip list and any trip page
  opened before render from it; writes made offline queue until the
  connection returns (transactions, such as saving a booking, do not and
  fail with a message). The cache belongs to the browser, not the account,
  and the rules cannot reach it, so it is cleared when a different account
  signs in than the one whose documents it holds.
- A service worker (`apps/web/src/sw.ts`, built with Serwist into
  `public/sw.js` by `sw.build.mjs`, which runs before `next build`) keeps the
  pages the user has opened, their router payloads and the hashed build
  assets, network first with the saved copy as the fallback. Cache Components
  serve a page as a static shell whose runtime data the browser fetches
  separately, and a soft navigation requests no document at all, so each page
  asks the worker on mount (`useSaveForOffline`) to save its document, the
  runtime-data request it names, and the assets the page has loaded. A page
  never opened shows `/offline`, which the worker precaches.

Next's `experimental.useOffline` holds navigations and prefetches while the
network is down and retries them when it returns; the banner reads that hook
and `navigator.onLine`, so a page loaded while already offline shows it too.
The worker registers only in production builds, where assets are hashed, so
the end-to-end tests run against `next build && next start`.

Installing: the manifest (`app/manifest.ts`) gives a standalone window, the
SVG icon and PNGs at 192 and 512 px plus a maskable 512 px one for Android
launchers; iOS takes `app/apple-icon.png` (180 px, full bleed) and the
`appleWebApp` metadata, opening without Safari's bars. `scripts/icons.mjs`
renders the PNGs from the SVGs in `apps/web/icons` with Playwright's
Chromium; they are committed. Settings shows an Install button where the
browser offers its install prompt (`beforeinstallprompt`), and on iPhone and
iPad, where Safari has none, says how to add it to the Home Screen; neither
shows once Travelmo runs installed.

## Access rules

`firestore.rules`, tested in `packages/rules`:

- A trip is readable by its owner and by any signed-in user whose verified
  email is in `sharedWith`. The owner may change and delete it; a sharee may
  only widen its `start`/`end` (and touch `updatedAt`), which is what saving
  a booking needs. A missing trip reads as absent to any signed-in user, so a
  client can tell a deleted trip from one it may not see.
  Segments inherit the parent trip's access for reading and writing: owner
  and sharees alike may add, edit and delete them, and a written segment must
  have the documented shape (known keys, a valid type, ISO instants, ids that
  match its path).
- A user reads and edits their own profile except the `gmail` field, owns
  their sender patterns, can read but not write their parsed-message log,
  and can never read `private`.
- A travel profile is readable by its owner and by any signed-in user whose
  verified email is in its `trustedEmails` (a collection-group query on that
  field lists the profiles shared with someone). Only the owner writes, and
  only `trustedEmails` (at most 20) and `updatedAt`, or starts the document
  with those and their own uid and email; the imported sections are the
  parser's alone.
- `gmailAccounts` and `oauthStates` are closed to clients.
- The worker uses the Admin SDK and bypasses rules.

## Import pipeline

```
Gmail ─watch─▶ Pub/Sub ─push(OIDC)─▶ parser /internal/pubsub/gmail
                  │ 5 failures          │ history.list since stored historyId
                  ▼                     │
             gmail-dead-letter ─▶ alert │
                                        ▼
                               create parsedMessages/{id} as "processing"
                                        │ already exists ─▶ skip
                                        │ created
                                        ▼
                               pre-filter: user deny list → user/seed allow
                               list → subject keywords, minus promotional
                               noise                       ── drop ─▶ record "filtered"
                                        │ pass
                                        ▼
                               embed (Gemini); keyword passes only: nearer
                               to this user's past non-bookings than to
                               their bookings?              ── yes ──▶ record "filtered"
                                        │ no, or too few examples yet
                                        ▼
                               Gemini, JSON-schema output, validated by
                               ExtractedBooking                ── throw ─▶ record "failed"
                                        │
                               isBooking && segments?          ── no ────▶ record "not_booking"
                                        │              and save the embedding as a non-booking
                                        │ yes, and save it as a booking
                                        ▼
                               place each origin and destination lacking a
                               country or a spot: airport table, then the
                               geocoder (cache → day's budget → Google); a
                               miss or a failure leaves the place as it was,
                               a spent budget queues it for the daily sweep
                                        ▼
                               transaction, serialized per user:
                               drop bookings already on an overlapping
                               trip (same type, time and route);
                               trip within 2 days of the booking's dates?
                               extend its bounds only : create one titled by
                               destination; write segments
                                        ▼
                               record "imported"
```

Cost control is the pre-filter plus the parsed-message record: an email is
shown to the model at most once, and only when it carries a booking signal.
The seed sender list is in `apps/parser/src/prefilter.ts`; users extend it
from Settings, where an "Import review" list shows recent emails that did
not become bookings with three actions: always import that sender, never
import it, or import this one anyway (`POST /gmail/reimport`, which reclaims
the record of a message that did not become a booking — never an imported
one, whose bookings are edited on the trip page, nor one whose import is
live — and runs the import with the pre-filter skipped). Teaching a sender also
drops any pattern on the other list that covers it, so the newest decision
is the one the parser follows. A trip
page offers "Always import this sender" on imported bookings.

The similarity pre-filter (`apps/parser/src/similarity.ts`) learns from
the model's verdicts. Every email that reaches the model is embedded
(sender domain, subject and the first 600 characters, with Gemini's
embedding model truncated to 256 dimensions) and, once the model has
judged it, saved under `users/{uid}/private/examples` as a booking or a
non-booking, the newest 40 of each. An email that passed only on keywords
is compared with those examples first: when the user has at least five of
each kind, and the nearest non-booking is at least 0.85 similar and 0.1
more similar than the nearest booking, the email is recorded as filtered
with the subject it resembles, and the model call is saved. Emails from
allowed senders and emails the user asks for skip the comparison but are
still learned from, so an "import anyway" on a wrongly filtered email
teaches the filter. An embedding failure is logged and the email goes to
the model.

Everything below the model is source-agnostic (`fileBooking` in
`apps/parser/src/importer.ts`): a source hands over bookings and a stable
source id, and gets the same duplicate check, trip assignment, segment ids
and parsed-message record. Duplicates are matched across sources, since a
TripIt export has no confirmation numbers to match on (`sameBooking`): the
same type, the same local start minute for journeys and activities or the
same dates for stays and rentals, and then evidence of identity, since
dropping a real booking loses it: equal confirmation numbers when both have
one, otherwise agreeing codes at both ends of a journey, or a distinctive
word shared by the two titles or place names other than their city and,
unless it is all the name there is, their chain or provider. Known cities
and countries that differ rule a match out. In doubt, both are kept. A TripIt export or a calendar file is
checked only against other sources, since it is already one list: two alike reservations in it
are two. Matching is one to one: an existing booking matched once, in
the same email or the same export, stands in for no other, and each
TripIt item's or calendar event's record keeps what it matched so a retried
upload counts it. Since items are matched one at a time, a TripIt export
first sets each existing booking aside for the item whose confirmation number
it carries, so a lookalike item without one (trip objects have none) cannot
take it first; and a calendar upload reads its changed events before its new
ones, so a booking a changed event no longer describes is free before a new
event that does is matched. A booking that
matches one already on an overlapping trip is left out and counted in the
record's reason, and its source is added to the booking it matched, so a
false match (a second room after all) and anything the extraction missed
stay one click away; when all of an email's bookings are, the email is still
recorded as imported, with none. A booking part of which matched joins the
trip of that match, and otherwise its whole range, new and old legs
together, picks the trip.

### TripIt export

TripIt has no export button; its support sends a JSON file of the whole
account on request. `packages/core/src/tripit.ts` maps it: reservation kinds
are told apart by their fields (airline codes on legs make a flight, train
numbers a train, a carrier and pick-up place a transfer, which is a bus,
ferry by TripIt's code `F` and otherwise a bus, a ship name or port calls a cruise, a room
type a stay, a car type a rental, a cuisine a restaurant booking, which becomes
an activity), each flight, train or transfer leg is a segment, a cruise is one
ferry segment per sailing between consecutive port calls (so every port's
country counts for reports and document checks), and
TripIt's DateTimes (date, time, IANA zone, offset) become our instants
directly. A stay with no times takes 15:00 and 11:00, anything else noon; a
DateTime with neither an offset nor a zone keeps its time as written at
`+00:00` with a note saying so (the preview counts these), while a zone that is
named but unknown is not guessed at. A place's country comes from the end of
its one-line address when that names a country, and otherwise from the
geocoder like any import's. Notes get TripIt's `[[TripItALT…]]`
markers and pasted HTML stripped. Notes, empty trips, reservations TripIt kept
only the name of (an empty leg, no dates: common in an old account, and all
of its unfiled items), objects of no known kind and legs without a usable
date (even when the rest of their reservation imports) are listed as not
imported, grouped by reason.
The Settings page runs the same mapping in the browser to show what the file
holds before anything is sent; `POST /import/tripit` then imports it.

TripIt's grouping is kept: each TripIt trip becomes a trip with its name and
dates, under an id derived from the user and the trip's content, unless a
trip from another source already overlaps it, which it joins instead, so a
journey imported from Gmail and from TripIt is one trip. Trips created from
TripIt are never joined by overlap, so back-to-back TripIt trips stay apart.
Items TripIt never filed into a trip go into one "Unfiled from TripIt" trip,
which spans whatever years they do and so is never joined by date.
Each TripIt trip and unfiled item is recorded under a key derived from its
name, dates, legs and confirmation numbers (and, for unfiled items alike in
every field, which copy it is), so uploading the same file again changes nothing, and
one that failed is tried again. One TripIt upload runs at a time per user,
under a lease in `users/{uid}/private/upload-tripit`, renewed every five
minutes while it runs and expiring 15 minutes after the last renewal if its
worker dies, so two uploads at once (two tabs, a script) cannot each match
the same existing booking; the second is refused with a 409 to try again.
An upload checks its lease before each item and stops if it was lost (a
stalled worker whose lease another upload took over), keeping what it
finished.

The same upload brings in the traveler's own details
(`packages/core/src/travelProfile.ts`): the export's `TravelerProfile`, a
list of templates named by `template_name` (`TravelDocument*` become
documents titled by kind and holder, `TravelAccount*` loyalty accounts that
join a listed program of the same name, `UserProfilePublic` and the export's
root fields the traveler's own entry: name, home airport and location, emails;
a profile without template names is read generically, each nested record its
own entry), its loyalty programs (less their transaction logs), and everyone
named on its reservations (`Traveler`, `Guest`, `Driver`, `ReservationHolder`,
once each by name). TripIt does not document these shapes, so every value is
kept, labeled by the path it was found at, and only entry titles are guessed
from the usual names. The profile is one
document, so it is kept within a 700 KB budget, documents first, then loyalty
programs, then travelers, and the preview says when something was left out;
an export with a profile but no bookings can be imported for it alone. Each
upload replaces
these sections and leaves the owner's sharing list as it is; their contents
never reach the logs, only counts. The Profile page shows them, documents
folded until opened, and lets the owner name people they trust (a spouse,
say) by email, who then see the whole profile, read-only, under "Shared with
you" on their own Profile page. Loyalty programs come first as a table of
program, account number, balance and status (`packages/core/src/loyalty.ts`
reads them from the usual labels, whatever the import called them, and
groups a plain-number balance), with the full entries folded below. On a
trip page, a booking whose provider shares a distinctive word with one of the
viewer's own programs ("Example Air" and "Example Air Miles"; words like
"air", "hotels" and "rewards" count for nothing) shows that program's name,
number and status under the provider, so the number is at hand at check-in;
a fellow traveler's programs are theirs alone.

### Calendar files

An `.ics` file (`packages/core/src/ics.ts`) carries text, not structure, so
each event goes through the email path: its title is the subject, and its
title, times, location and description are the body. Times are resolved to
instants wherever the file names a zone (`TZID`, or UTC, or a zone the file
defines in a `VTIMEZONE`, through its `X-LIC-LOCATION` name or its one
offset; one with several offsets is named to the model with them), and a
`DURATION` becomes an end, so the model is told the offset rather than left to infer it. Repeating events (`RRULE`,
`RDATE`, overrides) and cancelled ones are skipped. With no sender to check,
the pre-filter passes a title with a booking word, a flight or train number
or an airport-to-airport route, and the similarity stage follows as for a
subject keyword; every event of a TripIt calendar (its `PRODID`) goes
straight to the model. Each event is recorded under a key from its `UID`,
with a hash of the text the model read (`revision`); one whose import failed
is read again on the next upload, one whose text changed (a new time, place
or note) is read again too, and any other is not. A changed event is
claimed against the record version that was read (`claimChange`), so two
overlapping polls read it once; the new read comes first, and only once it
has succeeded do the event's own bookings go and its new outcome replace
them. A failed read leaves the old record and bookings as they were, to be
tried again. If the user edited, moved or deleted one of those bookings, or
another source was matched to one, they stand as the user left them and the
change is only noted on the record. The hash is of the text, not the file's
`DTSTAMP`, `LAST-MODIFIED` or `SEQUENCE`, which some calendars bump on every
export; a record from before revisions takes the current text as its
baseline. A request reads at most 100 events with the model, so a large calendar
comes in over several uploads of the same file, each carrying on where the
last stopped. `POST /import/ics` takes the file's text; Settings previews
the event counts first.

### Calendar feeds

A user can subscribe to a calendar feed (TripIt's, or any calendar's
subscription link) from Settings; the parser reads it when it is added and
then daily (`/internal/poll-feeds`, from Cloud Scheduler), through the same
path as an uploaded file, at most 100 model reads per feed per day. A link
often carries a secret token, so feeds live under `users/{uid}/feeds`,
readable by their owner, written by the parser only, never logged (logs
carry the feed's id, a hash of its link). At most five per user.

Fetching a link a user typed in is fetching from inside our network, so
`apps/parser/src/safefetch.ts` accepts only https (webcal is read as https)
on the standard port with no credentials, refuses any host one of whose
addresses is private, loopback, link-local (the metadata server) or
otherwise reserved, connects to the address it checked so DNS cannot be
switched in between, re-checks every redirect (three at most), and stops at
15 seconds or 5 MB.

### Google Calendar

A second Google consent, `calendar.readonly`, separate from Gmail's: its own
refresh token, its own disconnect, the same OAuth client and callback (the
OAuth state records which consent it was, and the callback sends the browser
back with `calendar=` rather than `gmail=`). Once connected, Settings lists
the account's calendars, none chosen: the user ticks the ones that hold
travel, which are read at once, and all chosen calendars are read daily with
the feeds (`/internal/poll-feeds`), at most 100 model reads per calendar per
day. The calendar list is refreshed on each poll, new calendars unchosen.

Events go through the calendar-file path (`apps/parser/src/googleCalendar.ts`
turns them into the same events a file gives): keyed by their iCalendar UID,
so an event already read from a feed or a file is not read again; deleted
events (read with `showDeleted`) remove their unedited, unmatched bookings;
repeating events, out-of-office, focus-time, working-location and birthday
events are skipped, and so are events Gmail made from emails when Gmail is
connected to the same Google account (so its mailbox is the one imported). A timed event is given in its own zone when it names one, else
the calendar's. A calendar named like TripIt is read as a travel calendar.
Logs carry a hash of a calendar's id, which is often an email address. A
failure is shown on that calendar in Settings; a withdrawn grant says to
reconnect. Google may send a deleted event with its event id alone, so for
events whose UID is not Google's own (`<id>@google.com`: invited, imported
or subscribed ones) the id-to-UID mapping is kept per calendar in
`users/{uid}/private/googleCalendarAliases-<hash>` while Google lists them.

Revoking any one token withdraws the user's whole grant to the app, every
scope included, so a token is revoked only when no other connection of the
user rests on the same Google account; otherwise disconnecting just drops
it, and the grant goes when the last connection on that account does.

An event cancelled after it was imported, in a feed or a re-uploaded file,
removes its booking, unless the user edited the booking or another email or
import has since been matched to it; those stay. A feed that cannot be read
keeps its bookings and shows why in Settings.

Backfill (`POST /gmail/backfill`, `apps/parser/src/backfill.ts`) runs the
same path over a Gmail search for booking-like subjects across the whole
mailbox, in batches of 300 messages. Each batch carries on from Gmail's page
cursor, which is kept with its progress (`scanned`, `imported`, `done`) on the
connection, so Settings shows how far it has got and a stopped or closed
reading picks up where it left off. Settings calls batch after batch until
the mailbox is done or the user stops, or a batch has failed imports (the
model or Gmail may be down), which pauses it with the reason shown. A
finished reading can start over, and starting over tries failed emails again.
A cursor Gmail no longer accepts restarts the search; messages already read
are skipped by their claims, so only Gmail reads repeat.

Gmail watches expire after seven days; `/internal/renew-watches`, called
daily by Cloud Scheduler, renews those within two days of expiry. A history
id that has aged out logs a warning and resets to the notification's id; the
user can run a backfill to fill any gap.

## Calendar export

Settings offers a link that Google Calendar, Apple Calendar or Outlook
subscribes to: an iCalendar feed (`packages/core/src/calendarExport.ts`) of
the user's trips, their own and those shared with them, from a year back
on. Each trip is an all-day event across its dates, and each booking a
timed event, in UTC so every app places it alike, with the route or place
as its location, the provider, confirmation number and notes in its
description, and a link to the trip page. A stay or rental is marked free
time, a journey busy. The parser serves it at `GET /cal/{token}.ics`, with
no sign-in, since calendar apps send none: the random token (24 bytes) is
the credential. The owner reads it from `users/{uid}/calendarExport/main`;
the parser alone writes it, and keeps only the token's SHA-256 in
`calendarExports/{hash}` to find whose it is. Replacing the link retires
the old one in the same transaction; turning it off deletes both. Anyone
with the link sees the trips, which Settings says. Responses are
`Cache-Control: private` so no shared cache keeps them.

Every exported event's UID ends in `@export.travelmo`, and every import (a
file, a feed, Google Calendar) skips such events and counts them, so a
subscribed copy of the export never comes back in as new bookings.

## Delivery failures and alerts

The push handler answers 2xx once a notification is handled, including the
cases it deliberately ignores (unknown mailbox, disconnected user), and
anything else makes Pub/Sub redeliver with backoff. The push subscription
(`deploy/pubsub.sh`) has a dead-letter topic: after five failed attempts the
notification moves to `gmail-dead-letter`, where a pull subscription keeps it
for a week. Each failed attempt is logged as `notification_failed` with the
Pub/Sub message id and attempt number, so the dead-lettered message can be
matched to its errors. A dead-lettered notification loses nothing: the next
notification for that mailbox resumes from the stored history id.

Two alerting policies (`deploy/monitoring.sh`, `deploy/alerts/`) page the
operator: a `renew_watch_failed` log line, meaning a user's imports will stop
when their watch expires, and a message on the dead-letter subscription.

## Connecting Gmail

Google returns the browser to the parser with no Travelmo credentials, so the
callback alone cannot know who is completing the flow. The parser parks the
tokens under a one-time code and sends the browser to the web app, which, as
the signed-in user, redeems the code; the parser accepts only when that user
started the flow. A link forwarded to someone else therefore cannot attach
their mailbox to the sender's account. A mailbox connected to one user is
refused to any other until the first disconnects.

## HTTP surface of the parser

| Route | Auth | Purpose |
|---|---|---|
| `POST /gmail/connect` | Firebase ID token | Returns the Google OAuth URL; stores a nonce for 10 minutes |
| `GET /gmail/callback` | OAuth state | Exchanges the code, parks the refresh token under a one-time completion token, redirects to `/settings?gmail=pending&state=…` |
| `POST /gmail/complete` | Firebase ID token | Redeems the completion token; refuses (and revokes) if the caller is not the user who started the flow or the mailbox belongs to another user; starts the watch and stores the connection |
| `POST /gmail/backfill` | Firebase ID token | Reads the next batch of past emails (`restart: true` starts over); returns counts per outcome and the reading's progress |
| `POST /gmail/reimport` | Firebase ID token | Imports one message again, skipping the pre-filter; returns its outcome |
| `POST /gmail/disconnect` | Firebase ID token | Stops the watch, revokes the token, deletes the connection |
| `POST /feeds/add` | Firebase ID token | Subscribes to a calendar feed after checking its address and reading it once; returns counts as for `/import/ics` |
| `POST /feeds/remove` | Firebase ID token | Stops polling a feed; its bookings stay |
| `POST /calendar/connect` | Firebase ID token | Returns the Google OAuth URL for `calendar.readonly`; the callback is `/gmail/callback` |
| `POST /calendar/complete` | Firebase ID token | Redeems a Calendar consent for the user who started it; stores the token and the calendar list, none chosen |
| `POST /calendar/select` | Firebase ID token | Sets the chosen calendars (`ids`) and reads the newly chosen ones; returns how many were read and failed |
| `POST /calendar/disconnect` | Firebase ID token | Revokes the Calendar token and deletes the connection; bookings stay |
| `POST /internal/poll-feeds` | OIDC from `INTERNAL_CALLERS` | Cloud Scheduler target: reads every feed and every chosen Google calendar |
| `POST /import/ics` | Firebase ID token | Imports an `.ics` file's text (up to 10 MB), reading at most 100 events with the model; returns counts per outcome, repeating and cancelled events skipped, and events left for the next upload |
| `POST /import/tripit` | Firebase ID token | Imports a TripIt JSON export (up to 20 MB); returns counts of trips, bookings, duplicates, items imported before, failures and items not importable; 409 while another TripIt upload of the same user runs |
| `POST /internal/pubsub/gmail` | OIDC from `INTERNAL_CALLERS` | Pub/Sub push target |
| `POST /internal/renew-watches` | OIDC from `INTERNAL_CALLERS` | Cloud Scheduler target |
| `POST /export/calendar` | Firebase ID token | Issues the user's calendar export link, retiring any old one; returns its token |
| `POST /export/calendar/stop` | Firebase ID token | Turns the calendar export link off |
| `GET /cal/{token}.ics` | the token | The calendar export itself, for calendar apps; 404 for a link not in use |
| `GET /healthz` | none | Liveness |

## Costs

Firebase Auth, Pub/Sub, Secret Manager and the Gmail API are free at this
scale. App Hosting and Cloud Run bill per request and idle at zero. Firestore
is the term that grows: one listener per trip list and per open trip, one
read of every booking each time the reports page opens, and one read of the
last year's trips and bookings each time a subscribed calendar refreshes (a
few times a day per subscriber). Gemini
Flash-Lite costs a fraction of a cent per booking email, and an embedding
of a few hundred tokens a hundredth of that; a hundred users importing
fifty bookings a month is a few dollars. Geocoding is one call per place
name Travelmo has not seen before (a 20-year export needs a few hundred:
about 240 for countries and 170 more for spots alone, which the daily cap
spreads over two days), free up to the Geocoding API's monthly allowance and
about half a cent a call past it, and `GEOCODE_DAILY_LIMIT` bounds the worst
day. Address
autocomplete in the form is billed to the user's browser key per lookup
session, free up to the Places API's monthly allowance; a hand-entered
booking is a rare thing beside imports. Reminders by email ride the
operator's SMTP service, and by push the browsers' own push services, which
are free; the daily job is the fourth Cloud Scheduler job, about ten cents
a month. The rules tests and CI run
on GitHub-hosted runners.

## Android app

`apps/android` is a native Kotlin and Compose app, built the way the other
Android apps in this account are (AGP and Kotlin at the same versions, a
pure-Kotlin `:core` guarded by `verifyNoAndroid`, JUnit 5 with Kotest
assertions, the commit count as `versionCode`, Firebase dormant until
`google-services.json` is dropped in) rather than the React Native port once
pencilled in; `design/android/` is its reference, Material 3 in this palette,
and the strings follow the web app exactly. It reads the same Firestore
documents under the same rules, signed in as the same Google account through
Credential Manager and Firebase Auth, so a trip looks the same on both and
Firestore's own cache answers offline. `:core` re-implements, in Kotlin, what
the screens need of `packages/core` (grouping, the next event, the status
lines, date formatting); the two are kept in step by hand, with tests that
mirror each other. The first cut is the sign-in, the trip list with its
status lines, a read-only trip page and sign-out; editing, the calendar,
reports, the profile and the import settings stay on the web until each
comes over; a navigation bar switches between Trips and the Calendar (the
month view of `/calendar`, with the same weeks, bars and lanes from `:core`),
and gains Reports and Profile with them. Bookings are added, edited and
deleted on the trip page by the owner and sharees, with the web's form
(type, title, start and end as date, time and zone with a pinned "as
imported" offset, places with codes and countries, the reference, notes,
the same checks) and the web's save: one transaction writes the form's
fields over the stored document, so what the form does not edit (sources,
sender, rating, favorite, a place's city and spot while its name holds)
survives, and widens the trip's dates to hold the booking. A delete asks
first, since a phone has no undo. A known airport code sets its end's zone,
from the web's generated airport table read as a resource. The owner's
powers over a trip are the web page's, in its places: Rename and Fit dates
to bookings by the dates, and at the foot who it is shared with (each
removable, an address to add), Merge into another trip and Delete this trip
(asking first; an interrupted deletion offers to finish), each write the
web's transaction with the trip's `updatedAt` as a revision; anyone who may
edit can move a booking to another trip they see. Every write runs in the
ViewModel under a token, so a rotation keeps its outcome. The Profile tab
shows the travel profile as `/profile` does (documents and travelers folded,
the loyalty programs at a glance and in full, who it is shared with, and the
profiles shared with the viewer; sharing itself stays on the web), and the
same document warnings as the web stand in one card at the top of the trip
list and on trip pages, from the same logic in `:core` with the
airport-country table read as a resource; as on the web, an upcoming card is
its title and dates, and a booking row's sources and sender share a line; a
booking row carries the viewer's matching loyalty programs. CI builds it beside the web app
(`ci / android`).

## Later

Itinerary ideas,
other mail providers and forward-to-import. Further import
sources share the pipeline: Google Calendar; `IMPORT.md` compares them and maps their fields.
