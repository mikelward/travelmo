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
| Email | Gmail API, OAuth refresh token, Pub/Sub push; Fastmail over JMAP with a read-only API token, polled every five minutes | Near-realtime import with no polling for Gmail; Fastmail offers no third-party OAuth for mail, and a push connection held open does not fit Cloud Run |
| Worker | Cloud Run (Hono, Node 22) | Pay per request; also hosts the OAuth flow so the web app needs no secrets |
| Extraction | Gemini via `@google/genai`, JSON schema output | Cheapest model that reliably fills a strict schema; model name is configurable |
| Mobile | PWA, a native Android app, and an iOS app sharing its Kotlin | Kotlin Multiplatform: the Android app's `:core` builds for iOS too, so the logic is not written a third time; a PWA on iOS gets no background refresh, no Time Sensitive notifications and no Live Activities |

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
  `favorite`, the traveler's own verdict, and `editedAt`, when someone last
  changed its details by hand (see "Editing by hand"). `source` is `gmail`, `manual`,
  `tripit`, `ics`, `forward` (an email forwarded to the user's forwarding
  address), `fastmail` (read from a connected Fastmail mailbox) or `imap`
  (read from a mailbox connected over IMAP): where the booking first came
  from. `sources` lists every
  email, TripIt item or calendar event it was read from (`kind, id, label,
  uid, at`), including later ones dropped as duplicates of it; the trip page
  shows them all, each email linking into Gmail for the user who imported
  it (`uid`; the trip's owner for sources recorded without one), in the
  mailbox it came from, wherever the booking has since moved. Fastmail
  and IMAP emails do not link.
  Imported segments use the id `<source id>-<index>` (for an email, its
  Gmail message id, behind its mailbox's `idPrefix`: see "Several
  mailboxes"; `fm-<JMAP email id>` for Fastmail; `imap-<record key>-<uidvalidity>-<uid>` for
  an IMAP mailbox, the record key a hash of the address with its server and
  port, so the same address reconnected to another server keeps its emails
  apart; `tripit-<key>` for a
  TripIt trip) so a re-import overwrites rather than duplicates.
- `users/{uid}` — `email, displayName, photoURL, gmails {<lowercased
  address>: {emailAddress, connectedAt, watchExpiration, historyId,
  idPrefix, backfill}}` (one entry per connected Gmail mailbox; `gmail`,
  the same for one connected before there could be several, stays until
  that mailbox is disconnected, frozen, for rules and apps from before),
  `fastmail {emailAddress, connectedAt, backfill}`, `imaps {<lowercased
  address>: {emailAddress, connectedAt, backfill, loginFailedAt}}` (one
  entry per mailbox connected over IMAP), `googleCalendar
  {emailAddress, connectedAt, calendars[]}, reminders {email, push}, forward
  {address, createdAt}, emails[], pendingEmails[{email, sentAt,
  expiresAt}]`. `gmail`, `gmails`, `fastmail`, `imaps`, `googleCalendar`, `forward`, `emails` (a copy,
  for the apps, of the addresses the user confirmed besides their sign-in,
  lowercase; never trusted, see below) and `pendingEmails` (those whose
  confirmation link is still out) are server-written ("Linked email addresses"); `reminders` is the owner's choice; `backfill` is how far a reading of the whole mailbox has
  got (`cursor, after, scanned, imported, failed, failedIds, retrying, done, updatedAt`, and the
  reading under way: `run, step, running, queued, leaseUntil, retryAfter, wake, handoff, failures, slowed`); `refresh`,
  server-written, is how far the last "Refresh from email" got (the same
  fields, `cursor` the last import record read, plus `total, updated,
  added, removed, merged, kept, missing` and the reset `generation` it ran
  under); each calendar
  is `{id, summary, primary, selected, lastReadAt, lastResult, lastError}`.
- `access/{email}` — `email, status (approved | declined), uid, invitedBy,
  invitedAt, approvedBy, approvedAt, declinedBy, declinedAt`: who may use the app, one per lowercased verified
  address ("Access"). `config/access` — `admins[]`, lowercase addresses,
  written by hand in the console.
- `users/{uid}/tripReminders/{slot}` — `id, text, amount, unit
  (days | weeks | months), createdAt`: one of the user's reminders before
  every international trip ("Before you go"), in a slot `s0` to `s19`.
  `users/{uid}/tripChecklists/{tripId}` — `done[], updatedAt`: the
  reminders the user ticked off on a trip, by id, at most forty; and under
  it `added/{slot}` — `id, text, createdAt` with `amount, unit` or `date`:
  a one-off for that trip alone, in a slot `a0` to `a9`. The owner's
  alone, whether the trip is theirs or shared with them.
- `users/{uid}/checkedIn/{tripId}` — `segmentIds[], updatedAt`: the
  flights the user marked "I've checked in" on a trip, by booking id, at
  most a hundred ("I've checked in"). The owner's alone, whether the trip
  is theirs or shared with them; the parser reads it.
- `checklistReminders/{uid__tripId__reminderId}` — `id, uid, tripId,
  reminderId, ends, attempts, done, at, claimUntil`: whether a reminder
  before a trip went to its user, `ends` the trip's last day for the
  sweep. The parser's alone.
- `users/{uid}/pushSubscriptions/{id}` — `endpoint, keys {p256dh, auth},
  createdAt`: one per browser that asked for notifications, written by that
  browser, read and pruned by the parser.
- `users/{uid}/devices/{id}` — `token, platform, createdAt`: one per phone
  that asked for notifications (the Android app; `platform` is `android`),
  written by the app with the id a hash of its Cloud Messaging token, read
  and pruned by the parser.
- `users/{uid}/settings/patterns` — `allow[], deny[]` sender domains.
- `users/{uid}/travelProfile/main` — `ownerUid, ownerEmail, trustedEmails[],
  travelers[], loyalty[], documents[], importedAt, updatedAt`: the traveler's
  own details from a TripIt export, each entry a `{title, fields[{label,
  value}]}`, and `foundLoyalty[]` (`program, number, holder, status,
  messageId, label, at`), loyalty numbers read from booking emails. The
  parser writes the sections and adds to `foundLoyalty`; the owner sets
  `trustedEmails` and may remove from `foundLoyalty`.
- `users/{uid}/feeds/{feedId}` — `url, label, addedAt, lastFetchedAt,
  lastResult, lastError`: subscribed calendar feeds. The owner reads them;
  the parser alone writes them.
- `geocodes/{key}` — `query, status (ok | none), country, city, lat, lon,
  at`: the geocoder's answer for a normalized place query (`key` is its
  hash), shared by every user, so a name is looked up once ever;
  `geocodeBudget/{day}` — `calls`, the day's count against
  `GEOCODE_DAILY_LIMIT`; `geocodeRetries/{tripId__segmentId}` — `uid,
  tripId, segmentId, at`, a booking a spent budget left with a place to ask
  about another day; `geocodeBackfill/state` — `cursor`, the last trip id
  the backfill of older bookings has read, or `done`. All four are the
  parser's alone.
- `flightStatus/{key}` — `ident, date, origin, found, departureGate,
  departureTerminal, arrivalGate, arrivalTerminal, baggageClaim,
  scheduledOut, estimatedOut, actualOut, scheduledIn, estimatedIn,
  actualIn, cancelled, diverted, divertedTo, noticedOut, checkedAt`: a
  flight's live gates, carousel, delay, cancellation and diversion, one
  per flight (`key` is its number, local departure date and airport,
  `QF1_2026-12-13_SYD`) and shared by everyone booked on it, times in UTC;
  `flightStatusBudget/{day}` — `calls`, the day's count against
  `FLIGHT_STATUS_DAILY_LIMIT`; `flightStatusClaims/{key}` — `until`, a
  look at the flight under way; `flightStatusNews/{key__uid}` — `uid, key,
  title, url, tag, attempts, at`, someone owed news of the flight. Any signed-in client may read a status by
  the key its booking names, never list them; the parser alone writes all
  four, and alone reads the other three.
- `checkInReminders/{ownerUid__segmentId}` — `id, tripId, segmentId, departs,
  sent[], attempts, done, at, claimUntil`: whom a booking's check-in
  reminder reached (uids), `departs` in UTC for the sweep, which moves it
  instead for a booking retimed later; each run moves a due booking's
  marker with it to its trip and departure ("Check-in reminders"). The parser's alone.
- `users/{uid}/parsedMessages/{sourceId}` (for an email, its source id:
  see "Several mailboxes") — `outcome` (processing,
  filtered, not_booking, imported, failed, cancellation), `source` (absent for Gmail,
  `tripit`, `ics`, `forward`, `fastmail` or `imap` otherwise), `reason, from, subject, segmentIds[],
  processedAt`, one per Gmail or Fastmail message, forwarded email, TripIt
  trip, unfiled TripIt item or calendar event. Claimed atomically as `processing` before any
  work, so a message delivered twice is imported once; a `processing` claim
  older than fifteen minutes is a dead worker's and may be taken over. Also
  the audit trail of what the LLM was shown, and the source of the review
  list in Settings.
- `users/{uid}/private/gmail-<key>` — one connected mailbox's refresh
  token and watch state, by its key (`mailboxKey`, a hash of the lowercased
  address); `users/{uid}/private/gmail` — the same for one connected before
  there could be several, until the parser moves it;
  `users/{uid}/private/gmailIds` — `first`, the mailbox whose emails keep
  Gmail's bare message ids;
  `users/{uid}/private/fastmail` — the Fastmail API token, the JMAP account
  id, the mailbox state new mail is read from (`emailState`), when it was
  last polled, and the backfill progress;
  `users/{uid}/private/imap-<key>` — one IMAP mailbox's app password, server
  (`host`, `port`), the inbox's UIDVALIDITY and last UID read
  (`mailboxState`, `<uidvalidity>:<uid>`), when it was last polled, when its
  server last refused the password (`loginFailedAt`) and the backfill
  progress;
  `users/{uid}/private/googleCalendar` — the Calendar refresh token and the
  calendar list, `googleCalendarAliases-<hash>` per calendar the event ids
  of deleted events still need. Server only. The refresh tokens and the
  Fastmail token and IMAP app passwords are `kms1:<ciphertext>` (see "Stored credentials" below). `users/{uid}/private/import` is read and written by every import
  transaction, serializing trip assignment per user.
  `users/{uid}/private/examples` — `bookings[], others[]` of `{subject,
  vector}`, the embeddings the similarity pre-filter compares against.
- `forwardAddresses/{tokenHash}` → `{uid, createdAt}`: whose a forwarding
  address is, by the hash of its token, as `calendarExports` does for export
  links; `users/{uid}/private/forwardBudget` → `{day, count}`, the day's
  forwarded emails. Server only.
- `bugReports/{id}` → `{id, uid, at, app, page?, version?, userAgent?,
  text, logChars, hasScreenshot, tripBookings?}`: a copy of each bug report
  a user sent ("Bug reports"), what they wrote and the sizes of the rest,
  never the log, screenshot or bookings; `users/{uid}/private/bugReportBudget`
  → `{day, count}`, the day's reports. Server only, not even the reporter's.
- `linkedEmails/{email}` → `{uid, linkedAt}`, the one account a confirmed
  address is linked to, made in the same transaction as `confirmed`;
  `users/{uid}/private/emails` → `{confirmed[], mailboxes[], pending[{email,
  tokenHash, sentAt, expiresAt}], day, sent}`, the confirmed addresses and
  the connected mailboxes' (lowercased; what the rules and access checks
  trust), the confirmation links out (by the hash of their token) and the
  day's count. Server only.
- `gmailAccounts/{emailAddress}` → `{uid}`, one owner per mailbox (an
  account may own several), enforced in a transaction; `oauthStates/{nonce}` → `{uid, createdAt}`;
  `pendingConnections/{token}` → `{uid, refreshToken, createdAt}`, parked
  tokens awaiting an authenticated completion, the token `kms1:` ciphertext
  too. Server only; each redeemed once, within ten minutes.

Schemas live in `packages/core/src/schema.ts`; paths in `paths.ts`.

### Stored credentials

Every mail credential the parser keeps (Gmail and Calendar refresh tokens,
tokens parked in `pendingConnections`, the Fastmail API token, IMAP app
passwords) is encrypted
with a Cloud KMS key (`CREDENTIALS_KMS_KEY`, made by `deploy/kms.sh`)
before it is written, and stored as `kms1:<base64 ciphertext>`, so a leak
or export of Firestore reveals nothing usable: only the parser's service
account may decrypt with the key (`apps/parser/src/sealing.ts`). Each is
encrypted with the document and field it belongs in as additional
authenticated data (a Gmail mailbox's by `private/gmail-<key>`, an IMAP
one's by `private/imap-<key>#password`, also while
it is still in `private/gmail`), so a ciphertext copied into another
user's document does not decrypt. The storage functions encrypt on write
and decrypt on read, outside Firestore transactions, which may run more
than once; everything else handles tokens as plaintext, and `revocable`
compares them unencrypted. A value without the prefix, stored before there
was a key, is read as it is; as the parser starts with a key it encrypts
every such value it finds (`sealStored.ts`, by collection-group queries
on `private` for values outside the `kms1:` range, and on
`pendingConnections`), logging counts and any document it could not,
which the next start tries again. Without a key (local runs) credentials
are stored as they are and the parser logs a warning as it starts. The
key rotates every 90 days; old versions are kept, since they still
decrypt what they sealed.

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

The Android app's writes (`FirestoreTrips`) are tested the same way, on an
Android emulator against the Firestore and Auth emulators on the host, as
instrumented tests the `android-emulator` CI job runs; the Firestore SDK
does not run under Robolectric.

## Light and dark

The web app has no theme setting: it follows the system's
`prefers-color-scheme`, live and without a reload, and declares
`color-scheme: light dark` so the browser draws native controls (dropdown
lists, date and time pickers, checkboxes, scrollbars) in the same scheme.
Colors that change between schemes are tokens in `globals.css`: `muted` for
secondary text, `danger` for destructive actions and errors, and `field`
for the outline of text fields and dropdowns, each chosen to meet WCAG AA in
both (4.5:1 for text, 3:1 for outlines); placeholders use `muted`, and a
keyboard focus ring in the text color stands off every control.
`e2e/contrast.spec.ts` runs axe-core's contrast check, and the outline,
placeholder and focus-ring checks axe lacks, on the main pages in both
schemes.

## The trip list

Trips are grouped into now, upcoming and past by calendar date. Trips under
way also show what comes next — the soonest booking start still ahead, or
the end of one under way (check-out, arrival, car return) — read from their
segments with one listener each; the next three upcoming trips get a
listener too, so their document warnings know where they go, but their
cards say only the title and the dates, since what comes next is for a
trip under way; past trips and further-off ones get no listener, to keep
Firestore reads in check.
Where trips are listed together (the trip list, the calendar, the trips a
favorite place was on, a document warning, the merge button), a title two
or more of the user's trips share, ignoring case and spacing, reads with
each one's dates: "Debutots Camp (11–15 Aug 2025)" and "Debutots Camp
(10–14 Aug 2026)", whichever came first and whether an import or the user
named them (`displayTitles` in `packages/core/src/format.ts`). The stored
title is unchanged, and a trip's own page shows it plain, its dates being
right under it; the pickers that move a booking or merge a trip already
show every trip's dates.
What comes next takes up to three lines (`tripNextUp` in
`packages/core/src/nextUp.ts`, mirrored in the Android app's core): the
booking's title; then, muted, the verb, how soon when it is within a week
("in 25 min", "in 3 h 20 min", "tomorrow"; a weekday is left to the date),
counted in the place's own offset, and the date and time as booked
("Departs in 2 h 1 min · Tue 24 Nov 17:20"; "Departs Tue 24 Nov 17:20"
further off); then, for a flight with live status ("Live flight status"),
the next step. Before takeoff that is how late it leaves, when it is late
("Leaves 35 min late, at 17:55"), else the terminal and gate it leaves
from ("Terminal 3 · Gate 12", or whichever is known); after takeoff (the
service says it left, or its estimated, else scheduled, departure has
passed) the card turns to the arrival ("Arrives in 6 h 10 min · Tue 24 Nov
20:30", counted to the landing estimate) and the step is where it arrives
and where the bags come out ("Terminal E · Gate B5 · Bags on carousel 7").
A cancelled or diverted flight says so instead, and nothing known means no
third line. A flight late leaving stays the next event past its booked
time, counted to its estimate. The list reads the status of each card
under way's next flight only, one listener each, while a trip page would
show it.
The same card names the stay under way and when it ends; and, for the next flight, when
online check-in opens from a day before that, then that it is open, with
the booking reference at hand (`packages/core/src/status.ts`). The window
is the airline's, read from the flight number ("Check-in reminders"); an
airline may change it, so the card says "usually". The clock behind these
lines ticks once a minute.

### Searching trips

A search box tops the trip list, on the web and Android, and narrows its
now, upcoming and past sections to the trips it finds
(`packages/core/src/tripSearch.ts`, `TripSearch.kt`). A query is words and
optionally a date. Every word must begin a word, ignoring case and
accents, of the trip's title as listed or of one of its bookings' title,
provider, reference, or a place's name, code, city, country code or
country name: "hilton", "lisb", "LIS", "BA" (but not inside "Lisboa").
A date picks trips under way at some point during it: a year ("2025"), a
month of any year ("march") or of one ("March 2025", "2025-03"), or a day
("12 Dec 2025", "2025-12-12"); a number beside a month is its day, else a
word ("VS 11"). Words and a date combine ("lisbon april"). The trip
documents hold only titles and dates, so the first search reads every
trip's bookings (the web once, as the reports page does; Android listens,
as its reports do) and keeps them while the list is open; until they
answer, trips are matched by title and dates, under "Searching bookings…".
A trip whose bookings couldn't be read is searched by title and dates
only, and the web says so. With no match the list says "No trips match."

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
today. Each country in the days table opens to the trips with days there,
latest first, each linking to its trip (web and Android), so a country
that looks wrong can be traced to the booking that put it there.

A place's country is the one its booking names, and its spot (`lat`, `lon`)
the one its booking carries. Imports fill both in when the source gave none:
a flight's from its airport code (`packages/core/src/airportPlaces.json`,
generated from the same OpenFlights and OurAirports data as the zone table,
9,342 codes, which also gives the airport's coordinates for the map); a
place whose city is unambiguous gets that city's country, with no call
(`packages/core/src/cityCountries.json`, from GeoNames' cities of 1,000
people or more: a name whose cities are all in one country, or whose
largest is ten times the largest elsewhere, so Boston is the US's and
Birmingham, shared with Alabama, is left out), as does a journey's end
named for its city ("Liverpool"), though never a venue's name (a restaurant
called Florence); anything else's from Google's
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
and stopping for the day when the budget runs out again. The airport and
city tables answer first, with no call, and with no geocoder configured
they alone answer: each queued booking gets what they know and leaves the
queue.
Bookings imported before geocoding began (7 November 2026) join the queue
too: each sweep first reads the next 100 trips in id order (where it got to
is kept in `geocodeBackfill/state`) and queues every booking, hand-entered
ones aside, that still lacks a country or a spot, until it has read them
all. It queues only while the queue has room for a day's sweep (200), a
whole trip at a time, and resumes after the last trip it queued, so no
booking can wait out the thirty days unasked. A booking with no country makes a day of its trip one the residence
report can't place.
Station and ferry codes are never read as airport codes. Changing planes
is no visit: a flight that lands where the next one leaves from (the same
airport code) within a day, with no stay booked in between, places the
traveler in no country on landing or takeoff, so a day changing planes in
Dubai counts no day in the UAE, while a stopover with a hotel does; such a
day is between countries, not unknown, and still a day away from home.
Each day of a trip counts for every country the
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

### Download trips

Reports, on the web and Android, downloads a CSV of where the user went, for
visa and residence forms (`tripsExport.ts`, mirrored in `TripsExport.kt`),
from the trips that start by a day the user picks ("Trips starting up to",
today by default, so a later day takes in planned trips), leaving out
trips wholly cancelled. It reads only journeys (where each
arrives, never where it leaves), stays and cars, so an event or a ticket
says nothing; places in the home town of their day are left out.

- **One row per trip** (`Trip,Start,End,Cities,Countries`): the trip's
  dates, and its towns and countries in order, several joined with "; ".
- **One row per place** (`City,Country,Start,End,Trip`): each town from the
  day someone got there until the day they moved on (the next town's first
  day), or for the last, the later of its stay's end and the trip's. Two
  towns of one name in different countries stay apart.

"Outside my home country only" keeps a trip with any place, or a place,
outside the home country of that place's own day (home can change
mid-trip); with home's country unknown, nothing
is left out. Countries are English names; fields are quoted as RFC 4180
says, and one starting `=`, `+`, `-`, `@` or a tab gets a leading `'` so a
spreadsheet doesn't run it as a formula. The web saves the file through the browser, Android through the
system's file picker.

### Residence and visa days

Below the counts, "Residence and visa days" checks the days in and out of
countries against the limits people ask about
(`packages/core/src/residence.ts`, mirrored in `:core`): UK settlement
(no more than 180 days outside the UK in any 12 months of the five years
before applying, or since moving to the UK when that is later: the first
day of the run of homes in the UK that reaches the date; a period shorter
than 12 months is counted on its own days), UK citizenship (450 days outside in the five years
before applying, 90 in the last 12 months), Schengen short stays (90 days
in any 180, in the 29 members since Bulgaria and Romania joined in full in
2025, Ireland and Cyprus not among them), US citizenship (913 days in the
US in the five years before applying, or 548 in three when married to a US
citizen, and no single absence of over six months, a year breaking
continuous residence; Puerto Rico, Guam, the US Virgin Islands and the
Northern Mariana Islands count as the US), the US green card (an absence
of over six months, or of a year or more), US tax (the substantial
presence test: 31 days this year, and 183 counting this year's days, a
third of last year's and a sixth of the year before's; the states and DC
only), Canada permanent residence (730 days in Canada in the last five
years) and citizenship (1,095 in the five years before applying), and
Australian citizenship (no more than a year away in the four years before
applying, and 90 days in the last 12 months). Each rule is data, with the
official page it comes from beside it; the page links to it.

Where the traveler was each day is worked out as the counts above work
it out, from the trips the page already read: a day counts for every
country they were in for any part of it, so the day of leaving and the day
of coming back are days in both countries. That gives both conventions the
rules use: the UK counts an absence only for a whole day away, so those
days are not absences; Schengen, the US, Canada and Australia count any
part of a day in the country, so they are days there. A day spent wholly
in the air (a flight across the date line can skip one) is in no country.
A day with no trip is at home, from home over time as the Profile works it
out (`effectiveHomes`); a day of a trip before its first booking is too,
and so is a day of a trip of outings alone (a class, a show) whose bookings
name no place and take the traveler nowhere: no journey or stay so far. A
booking that names no country moves the traveler only if it is a journey
or a stay; an outing leaves them where they were, so a show with no place
in Las Vegas keeps the days after the flight in the US. A
day nothing places (a booking naming no country, or home with no country)
counts against the traveler: as away for a limit on absences or a minimum
of days in, as in for a limit on days in, and the page says how many there
were, and lists them by run of days with the trips that have them, to
fix; with no country for home, it asks for one on the Profile.

The person picks a set of rules and a date ("Applying on" for an
application, "On" otherwise; today by default). Trips booked up to the date count, so a date ahead shows what
planned trips would leave. Each rule shows the days used of the limit,
what is left (or short, or to spare), the worst window and its dates
("Worst 12 months: …", and for a rolling limit the days in the window
ending on the date: "Last 12 months: 75 days"), the qualifying period
counted ("Since you moved to the UK on …", or its dates), whether it is
within the limit, within a tenth of it, or over, and the absences or stays
behind it with their countries and trips (every absence in a qualifying
period, else those in the worst window). A note says it is an estimate from the
bookings Travelmo knows about, not legal advice. It reads nothing new: no
lookups, no server, no cost.

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
sets `reminders.push`, which the last browser to unsubscribe clears, unless
a phone is still registered. The
same daily job sends one notification per trip (`reminderNotifications` in
core: the title, when the trip starts, the lines, the trip's URL as the tap
target, a tag per trip so a later one replaces it) to every subscription,
signed with the private key the parser holds (`VAPID_PRIVATE_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`; `apps/parser/src/push.ts`, the
`web-push` library) with a day to live; the worker (`src/sw.ts`) shows it
and opens the trip on a tap. The same notifications go to every phone the
Android app registered (`users/{uid}/devices/{id}`) through Firebase Cloud
Messaging with the parser's Admin credential (`apps/parser/src/fcm.ts`; no
key of its own, a day to live, the fields as a data message, which
Messaging queues one by one for an offline phone where it collapses
notification messages to the last, so the app draws each one itself: flight
news in its `flight_changes` channel, everything else in `reminders`), and a
token Messaging reports unregistered is dropped like a lost subscription.
The app's switch in Settings asks for the notification permission, then
writes the phone's token under the account and sets `reminders.push`; off
forgets the phone, and the flag clears only once no phone and no browser
is left. A refreshed token replaces the registration it had, so delivery
never lapses, and a tap opens the trip in the app. An endpoint is whatever the browser wrote, so
it is held to the calendar-feed rule (https on the standard port, public
addresses only, checked at the connection) and one that fails is dropped
like one the push service reports gone. The switch reads as on only when
the browser's subscription is recorded under the signed-in account, so a
second account on the same browser starts off, and turning it off forgets
the browser for that account alone, leaving the browser's subscription to
any other account that recorded it. Lines are marked sent once every channel the person turned on
has taken them, so a failure on one keeps the day's news for tomorrow on
all, as does a day on which no browser or phone was left to take them. A
notification is kept within the payload a push service guarantees to carry
(3993 bytes, RFC 8291): a trip with more news than fits says how many more
lines wait on its page. Each send has a socket timeout, so one quiet
endpoint cannot stall the run for everyone after it.

## Check-in reminders

When a flight's online check-in opens, whoever has the trip hears of it
once: "Check in for QF 1 to London", "Online check-in is open.", when it
departs (as written, in the place's offset) and the booking reference.

The window comes from a table of airlines by IATA code
(`packages/core/src/airlines.ts`, mirrored in the Android app's core), read
from the flight number in the booking's title as live flight status reads
it: hours before departure and the airline's site. It lists only airlines
whose window is well known (American, Air Canada, Alaska, JetBlue, British
Airways, Delta, Qantas, United, Virgin Australia and Southwest a day ahead;
Lufthansa and SWISS 23 hours; Air France and KLM 30; Finnair 36; Cathay
Pacific, Emirates and Singapore Airlines 48; easyJet 30 days); any other
airline, or a booking with no flight number, gets a day, what most
airlines do. The site is the airline's home page, not a deep link to its
check-in form, since those move often. The trip card's line uses the same
table.

The parser's every-minute flight-status job sends them first
(`apps/parser/src/checkIn.ts`), with or without `AEROAPI_KEY`: the daily
reminder run would send them up to a day late, and the flight job already
reads flight bookings by local start with an index for it. It reads the
flight bookings leaving from an hour to two days ahead (widened by every
offset a place can have), and a booking is due once its check-in has
opened, or two days before departure for an airline that opens earlier
(easyJet's month ahead is not worth a nudge yet), until an hour before
departure, when online check-in has usually closed. So a flight booked
after its check-in opened is reminded at once, and one already gone or
about to go is not, nor one that was cancelled.

It goes to the owner of the booking's trip and the people it is shared
with (by verified address), only those approved ("Access"), by the
reminder settings they chose: email when `reminders.email` is on (to the
address Google verified), and every browser and phone when
`reminders.push` is. There is no switch of its own: someone who wants
reminders gets this one too. The email carries the airline's site, where
the table knows it, and the trip; a notification's tap opens the airline's
site in a window of its own (web) or the browser (Android), or the trip
where the airline is not listed. A push service holds it until an hour
before departure, at most a day. Someone on two bookings of the same
flight (a couple's, each shared with the other) hears once, of the one on
their own trip.

A marker per booking (`checkInReminders/{ownerUid__segmentId}`, keyed so
it stays with a booking moved to another of its owner's trips; the
parser's alone) records whom it reached. A run first claims all of a
flight's bookings for ten minutes from when it takes them, all or none in
one transaction, so overlapping runs never both send or split a flight
(each email send is bounded to well under that); where to send is read
before anything is sent, so a failed read never repeats a sent one; a
person it reached is never told again, and a delivery that failed on
every channel of a person is tried again by the next runs, five in all.
Once nobody is left to try, the booking is done and later runs read only
its marker; someone added to the trip after that is not told. Markers go
once their flight has left, swept by the same job, and account deletion
takes the person's uid off them.

### I've checked in

Whoever has checked in says so, and hears no more of it: the card's
check-in line carries an "I've checked in" button while check-in is open,
and a flight on the trip page carries one from when check-in usually opens
until departure. Once marked, the card's check-in line is gone and the
flight says "Checked in" with an Undo, until departure. The mark is the
viewer's own, one document per trip (`users/{uid}/checkedIn/{tripId}` —
`segmentIds[]`, at most a hundred, `updatedAt`; `packages/core/src/checkedIn.ts`,
mirrored in the Android app's core), whoever's trip it is: on a shared trip
it marks only the person who tapped it. Each app writes it in a
transaction over the stored list.

The parser reads the mark of each person it is about to remind, for the
trips of their bookings of that flight, and skips someone who marked any
of them; a mark it can't read counts as none, so a reminder too many goes
rather than one missed. A person skipped is not recorded as reached, but
the booking is done all the same, so undoing the mark brings no reminder.

The reminder offers the action too. A web push notification carries the
booking (`checkedIn: {tripId, segmentId}` beside its title) and the service
worker shows an "I've checked in" action; the worker has no sign-in, so the
action opens the trip page with `?checkedIn=<segmentId>`, and the page,
signed in as the viewer, saves the mark for one of the trip's flights and
takes the query off the address (`apps/web/src/sw/checkedIn.ts`,
`apps/web/src/lib/checkedIn.ts`). On Android the data message carries
`checkedInTripId` and `checkedInSegmentId`, and the notification's action
is a broadcast the app's `CheckedInReceiver` handles: it saves the mark for
the signed-in user through the app's store, within the few seconds a
receiver has, and takes the notification away; a mark it couldn't save
leaves it up. The email has no action: it links to the trip.

## Before you go

Besides the warnings above, travelers keep their own reminders before a
trip (`packages/core/src/checklist.ts`, mirrored in the Android app's
core). Settings has "Before international trips": reminders such as
"Apply for a visa" or "Request prescriptions", each with how long before a
trip it is due, in days, weeks or months (30 days unless changed, at most
about a year), added, edited and removed there, at most twenty.

A trip is international when one of its bookings is in a country other
than home on the day it starts. Home is worked out as ride suggestions
work it out: this trip's own round trip, unless the person corrected home
on Profile, whose corrections then decide. Home's country is the one the
home names, or else that of a place of the trip in the home town (an
airport's, from the airport table, as the reports place flights). With no
home country known or no booking with a country, the trip is not
international, so a one-way trip says nothing until Profile says where
home is. Reading every trip to work out home, as Profile does, would cost
a read of each on every visit and in every daily run.

The trip page, on the web and in the Android app, has "Before you go" for
a trip not yet over: the person's standing reminders when the trip is
international, and the one-offs they added to it, whatever the trip (a
date, or how long before), soonest due first, each with its day ("By Thu
12 Nov", red once it is due and not done). Ticking one off, adding and
removing a one-off are the viewer's own: a trip shared with someone shows
them their own reminders, never the owner's, and ticking one off on one
trip leaves it on the others. Each reminder is a document in a numbered
slot, so the rules check every one in full and bound how many there are
(a list in one document would have to be checked entry by entry, which
the rules' limit of a thousand expressions does not allow for twenty);
each has an id of its own, so one that takes a freed slot is not ticked
off where the reminder before it was. The reminder's words are never
logged.

The daily `/internal/reminders` run sends each due reminder once, after
the document reminders: one due today or earlier (a trip booked after
the day goes at once), not ticked off, for a trip not yet started, by the
channels the person chose under Reminders (an email to the address Google
verified when `reminders.email` is on, every browser and phone when
`reminders.push` is), only to them and only once approved ("Access"). It
is "Apply for a visa — Lisbon trip in 30 days" by email, in plain words
with a link to the trip, and a notification with the reminder as its
title, tagged per trip and reminder, whose tap opens the trip. Someone
with nowhere to send is skipped before their trips are read, and a trip's
bookings are read only when something could be due. A marker per
person, trip and reminder (`checklistReminders`, the parser's alone,
`apps/parser/src/checklist.ts`) remembers it went, as check-in reminders
do: claimed for ten minutes in a transaction first, so overlapping runs
never both send; a delivery that every channel failed is tried by the
next runs, five in all; the deletion marker is read in each write. Markers
go once their trip is over or gone, swept by the same run; one whose trip
moved later goes with it. A trip deleted leaves its ticks under the user
until the account goes; nothing reads them.

## Live flight status

A flight's card on the trip page says, near departure, what matters at
its stage. Before takeoff: where it leaves from, how late it leaves and
the arrival terminal ("Departs from terminal 1, gate 8 · Arrives at
terminal 3"), but no arrival gate or carousel. After takeoff (the service
says it left, or its estimated, else scheduled, departure has passed;
`flightDeparted`): when it lands, where it arrives and where the bags come
out ("Lands 20 min early, at 15:10 · Arrives at terminal 3, gate D46 ·
Bags on carousel 16"), and no longer where it left from. Whoever has the
trip gets a notification when one of those is given or changes ("Now
departs from terminal 1, gate 9 (was terminal 1, gate 8)"), judged at the
stage of each look: an arrival gate or carousel known before takeoff is
news at the first look after it, never before. The card says how late the
flight leaves once five minutes or more off the schedule, and after
takeoff when it lands, on time or not, by the airports' clocks ("Leaves 40
min late, at 09:40"; "Lands on time, at 15:30"; the times are FlightAware's UTC estimates
written in the offset of the booking's start or end), whether it was
diverted ("Diverted to KUL", or just "Diverted" when the service gives
the booked airport or none), and of a flight the airline cancelled only
"Flight cancelled". News of these: a cancellation and a diversion once
each, and a departure whose estimate moved a quarter of an hour or more
from what the last news said, or from the schedule before any did
("Now leaves 55 min late, at 09:55", "Now leaves on time, at 09:00"):
the status keeps that time as `noticedOut`, so a delay creeping five
minutes a look is news once it adds up, and a departure is no news once
the flight has left. Once news of a delay was sent, the card keeps the
departure line even when it is back on time ("Leaves on time, at 09:00"),
so a retried notification of that says it too. A landing estimate is
shown, not sent: it moves
throughout the flight. A retried notification gives no clock time, since
it has only the flight's status, not the booking. Only a field
given a new value is news: nothing is said of one taken away, which is the
source losing it, nor of a departure gate once the flight has left (`packages/core/src/flightStatus.ts`,
mirrored in the Android app's core).

The flight is read from the booking's title, which imports write as the
airline code and number first ("BA 117 LHR to JFK"); a booking with no
number there gets no status, nor does a cancelled booking. The source is FlightAware AeroAPI
(`apps/parser/src/aeroapi.ts`), asked for the number around the booked
departure (twelve hours either side), taking the leg from the booking's
airport that leaves closest to the booked time; FlightAware's own
pushed alerts carry no gate or carousel, so the parser asks on a schedule.
Cloud Scheduler calls `/internal/flight-status` every minute
(`apps/parser/src/flightStatus.ts`), which finds the flight bookings near
now (one collection-group query on `segments` by type and local start,
widened by every offset a place can have), groups them by flight, and looks
at each flight once for everyone on it when it is due: every minute from
two hours before departure until it leaves (or half an hour after, if it
has not), and from half an hour before landing until 45 minutes after, by
the service's latest estimates; every quarter of an hour in between; a
flight the service does not know, every quarter of an hour until an hour
after it was due to leave; never for a cancelled one, or past 30 hours
after the booked departure. An open trip page (web or app) asks
`/flights/refresh` each minute while it is in front, which looks at its
flights the same way from six hours before departure, at most once a
minute each, so what is on screen at the airport is fresh between the
scheduled looks; what it learns is news for everyone on the flight.

A look first claims the flight for 30 seconds (in a transaction, only
while the status is still the one it read), so overlapping looks, the job's
and open trip pages', make one call between them; its answer replaces the
status only if no other look wrote one since, so news is sent once. A gate,
terminal or carousel the answer lacks is kept from the last one: the source
losing a field for a look and finding it again is news neither way, and
the card keeps saying where to go. A gate and its terminal go together: one
is kept only while the other is unchanged, so a new terminal never shows
with the old one's gate. The news
goes to the owner of every trip holding the flight and the people it is
shared with (by verified address), each once, on every browser and phone
they turned notifications on for, through the same channels as reminders,
titled with the booking and tagged per flight so a later one replaces it.
On Android flight news has a channel of its own, "Flight changes", which
the app picks by the `flight-` tag: high importance, so it shows on top of
the screen, with a chime of its own, a short falling two-note tone in the
manner of an airport announcement, synthesized for travelmo
(`apps/android/scripts/flight-chime.py`) so that "look now" sounds unlike
a day-before reminder, which keeps the system sound. Either channel can be
silenced or given another sound in the system settings. Browsers ignore a
push's sound, so the web has no chime. Android fixes a channel's sound when
the channel is made: a new chime needs a new channel id.
On Android the flight also has a Live Update while the parser watches it,
from two hours before departure until 45 minutes after landing: an ongoing,
silent notification (channel "Flight progress"), which Android 16 and later
promote to a chip in the status bar showing the most useful thing now: the
terminal and gate before it leaves ("T3 G28", whichever is known, a value
that names itself such as "B12" left bare, the departure time before either
is known), in the air a countdown to the landing estimate
that the phone runs itself, so it keeps going in flight mode ("2:10:00"),
and the carousel once landed ("Bags 16", "16A" when that does not fit,
else the arrival gate). A chip holds seven characters at most: the gate
alone when terminal and gate together do not fit, anything longer cut
short. Its line says the same in
words ("Leaves 40 min late, at 09:40 · Departs from terminal 3, gate 28"),
and a bar shows how far through the flight it is. After each scheduled or
page-driven look in that window, news or not, the parser sends every phone
of everyone on the flight a Cloud Messaging data message (`kind: "live"`)
with the status and the person's own booking, high priority so Doze lets it
through, collapsed per flight and held for a quarter of an hour, so a phone
that was off gets only the newest; it moves on from gate to landing to bags
without anything changing, and a failed send is not tried again, since the
next look sends a newer one. The look that ends the watch (a
cancellation, or a delay putting departure more than two hours off) sends
one more, taking the Live Update down; otherwise it times out 45 minutes
after landing. A swipe-away lasts until the flight is over, a delayed
landing moving that later.
The app draws it from the status (`liveFlight` in `:core`), and one swiped
away stays away for that flight. Delays, gate changes and the rest still
come as "Flight changes" alerts with the chime. The web has no equivalent.
Push services hold flight news for an offline browser or phone for half
an hour, not the day reminders get, since directions to a gate are no use
once the flight has gone. When every browser and phone of a person failed
to take the news (not one reported gone), who is owed it waits in
`flightStatusNews/{key__uid}` until news of the flight reaches them, and
each scheduled run tries again, for half an hour or five tries, saying where
the flight leaves from, arrives at and where the bags come out as its status
says then, so a retry never gives a gate a later look has replaced; a
retry changes or drops its entry only while it is the one it read, so it
never discards a newer one a later failure left.
The page shows a status from a day before departure until the looks stop,
with a listener per flight only for those flights. `AEROAPI_KEY` turns it
on; `FLIGHT_STATUS_DAILY_LIMIT` (default 1,000 calls) caps every user's
calls together, and a capped day logs `flight_status_capped` and looks no
more until the next.

## Editing by hand

The owner and anyone the trip is shared with can add, edit and delete
segments on a trip page; only the owner renames, shares or deletes the trip.
Each booking has a ⋮ menu, the same as the Android app's: "Copy reference"
(when it has one) and "Sources" (when it has sources or a sender) for
everyone who sees the trip, then Edit, "Move to another trip…" and Delete for
those who may edit. Sources opens a dialog listing each source's label and
kind (an email the viewer imported links to Gmail), then "From" the sender
with "Always import this sender" and "Never import this sender" for the owner
(each where it isn't already the rule); Move to another trip… opens a dialog of the
viewer's other trips. The row itself shows only the booking.
The same people can rate a booking one to five stars and mark it a favorite
(`rating`, `favorite` on the segment; tapping the current star clears the
rating): a write like any other, moving the booking's revision
(`updatedAt`), so a calendar change no longer replaces it and the verdict
survives. Saving the booking form (on the web and Android, a place picked
there included) is a hand edit, and also sets `editedAt`; a rating, a
favorite mark, a move between trips, a restore and every import leave it as
it is. The rules refuse a change to a booking's details (`type, title,
provider, confirmation, start, end, origin, destination, notes`) that does
not set `editedAt` too, so an app from before it cannot edit unrecorded.
"Refresh from email" leaves a hand-edited booking as the user left it,
judged by `handEdited` (`apps/parser/src/refresh.ts`): one with `editedAt`
is edited; one whose `updatedAt` is still its `createdAt` is not (imports
keep an unedited booking so); one touched since it was filed is edited when
created before `editedAtSince` (2026-12-15, when every client and the rules
record edits), since a rating, a move and an edit were not told apart before
then, unless its details already are what its email says now, which shows
nothing of the user's would be lost; one created since then was only rated,
marked or moved. Reports lists the
places rated or marked, favorites first with the best rating given, each
linking to the trips it was on (`packages/core/src/favorites.ts`: a place is
where a journey ends or where a stay is, by name and country).
A manual segment carries `source: "manual"` and the same
shape as an imported one; the form takes a local date, time and time zone
for each end and stores the instant with that zone's offset on that date, so
it reads back exactly as the traveler sees it. Typing a known airport code
into From or To preselects that end's zone from a generated table of IATA
codes (`packages/core/src/airports.json`, from the OpenFlights and
OurAirports airport databases, loaded on demand); the picker still has the last word. An
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

### Car and ride suggestions

Under a flight with nothing booked on the ground, the trip page suggests
booking it (`rideNeeds` in `packages/core/src/rides.ts`), for flights still
ahead and not cancelled:

- leaving home with no transfer to the airport: "Need a ride to London
  Heathrow?";
- landing at home with no transfer from it: "Need a ride home from London
  Heathrow?";
- landing away, as the last leg there (no journey onward from that airport
  within twelve hours), with no transfer from it and no car collected there
  (at the airport or in its town) from twelve hours before landing to two
  days after: "Need a car in Boston?".

A transfer counts only for the end of the flight it meets: one to the
airport (`rideToDeparture`) covers the ride there, one from it
(`rideFromArrival`) the way on, each as `connectionGap` in "Home" matches
them. Android's `:core` mirrors this in `Rides.kt`, and its trip page shows
the same cards under the same flights, reading the user document's
`rideCompanies`, `hiddenRideNeeds` and `homes` and hiding through the same
transaction; companies are added and removed in Settings on either, each
in a transaction over the stored list (`withRideCompany`, `withoutRideCompany`).
Home is where this trip's round trip starts (`homeTimeline` of its own
bookings), or the viewer's corrections on Profile when there are any; it is
not worked out from every trip, which would read them all on each visit.
Without a home, a landing is known to be away only when another journey
follows it, so a one-way trip's last flight gets nothing.

A car suggestion links to Avis, Enterprise, Hertz, Budget, Sixt, National
and Alamo at their own sites, plain links that carry nothing about the
trip, then the viewer's own companies for "Cars wherever I land". A ride at
home links only to the viewer's companies for "Rides to and from home",
such as a local minicab firm, and shows nothing until they add one.
Settings ("Car and ride companies") lists them: a name, an `https://`
booking link, which suggestions it joins, and optionally the countries it
works in (typed by name or code, "UK, France", `parseCountries`), at most
twenty (`users/{uid}.rideCompanies`; an entry that does not parse is left
out). A company with countries is offered only where the ride or car is: the
country of the airport a ride to it leaves for, else of the one the flight
lands at (`rideCountry`); where the booking doesn't say, every company is.
"Hide" removes one suggestion for good (`hiddenRideNeeds`, the newest two
hundred `segmentId/kind` keys). Both are the viewer's own, so a sharee sees
their own companies and hides their own suggestions.

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

`/privacy` is the privacy policy the Play listing and Google's OAuth
consent screen link to, readable signed out and linked from every page's
footer; it changes in the same pull request as any change to what is
collected or who receives it. `docs/PRIVACY.md` holds the same text for
GitHub Pages (published from `docs/`) and readers of the repository, as in
the sibling repos; an end-to-end test fails when the two differ.

Installing: the manifest (`app/manifest.ts`) gives a standalone window, the
SVG icon and PNGs at 192 and 512 px plus a maskable 512 px one for Android
launchers; iOS takes `app/apple-icon.png` (180 px, full bleed) and the
`appleWebApp` metadata, opening without Safari's bars. `scripts/icons.mjs`
renders the PNGs from the SVGs in `apps/web/icons` with Playwright's
Chromium; they are committed, as is the Play listing's 512 px icon
(`apps/android/play/icon.svg`). The rest of the Play listing (texts,
feature graphic, screenshots framed from the Android snapshots) lives
beside it in `apps/android/play/listings`, and `scripts/publish-play-listing.mjs`
sends it through the Play Developer API with no dependencies. Settings shows an Install button where the
browser offers its install prompt (`beforeinstallprompt`), and on iPhone and
iPad, where Safari has none, says how to add it to the Home Screen; neither
shows once Travelmo runs installed.

## Access

Only approved accounts use Travelmo. An account is approved when any of
these holds, unless an admin declined or revoked its address
(`accessStatus` in `packages/core/src/access.ts`; the rules and the parser
decide the same way):

- it is an admin's: its verified email, or an address it linked ("Linked
  email addresses"), is in `config/access`'s `admins`,
  which the operator writes by hand in the console (README "Deploy");
- it has a user document (`users/{uid}`): every account that used the web
  app before approvals has one, since the web app wrote it at each sign-in,
  and a new account may write it only once approved;
- its verified email's record (`access/{email}`) is approved by an admin,
  or names someone who invited it (`invitedBy`), or so is that of an
  address it linked. Only the sign-in's decline locks the account out: that
  is the address an admin revokes. The rules read no linked address's
  record: the list lives on the user document, whose existence already
  approves the account, so the parser (which does read them) and the rules
  agree.

Accounts from before approvals. An Android-only account never wrote a user
document, and someone shared with may never have signed in, so the parser
records them before the rules can ask (`grandfatherAccounts` in
`apps/parser/src/access.ts`): as it starts, before it serves, it writes
`access/{email}` as approved (`approvedBy: "migration"`, `grandfathered:
true`) for every owner of a trip or travel profile, and every address an
approved owner shared one with, that nothing else lets in yet. It skips an
account being deleted or gone from Auth, and never overwrites a decline, so
a revocation stands and running it again changes nothing. The first run
must succeed before the parser serves (a failure stops the start, so Cloud
Run keeps the previous revision); once it has (`config/accessGrandfathered`
records when), each later start runs it again in the background, logging a
failure, to catch a share an old client made meanwhile. CI deploys the
parser before the rules, and holds rules due while the parser is due but
cannot deploy (README "Continuous deployment"), so the rules never enforce
approval before this has run: in the push that brings approvals both
change, the parser's deploy waits for its revision to be ready, which is
after the first run, and a later rules-only deploy finds it done. No one
already using the app is locked out, and nothing is migrated by hand.

Sharing invites. Sharing a trip or a travel profile with an address (a
sign-in or a linked one alike) writes
`invitedBy` (the sharer) and `invitedAt` into its record in the same batch
as the share, so the person can open what was shared without asking. The
rules let any approved user write those two fields for any address, which
means any approved user can invite anyone; that is no more than sharing a
trip already allowed, and an admin's decline still wins. The client writes
it rather than the parser so the share and the invite land together, work
offline like any write, and need no new endpoint; a parser endpoint would
have checked that a share exists, which a user can make for any address
anyway.

Not approved. An account that is not approved sees "Travelmo is invite-only" on
every page but a confirmation link's (below) instead of the app, with "Ask
someone who uses Travelmo to share a trip with you.", "Sign out" and
"Delete account" (as in Settings, which it cannot open). Nobody can ask for
access: an admin's invite or someone sharing with the address lets an
account in. (Accounts once could ask; bots filled the list, so asking was
removed, and the parser deletes what it left once, on start:
`apps/parser/src/dropAccessRequests.ts`, marked done in
`config/accessRequestsDropped`.) The page calls the parser's
`POST /access/check` on opening, which lets in an account the rules cannot
tell is old: one that owns a trip (new accounts cannot make one; an
Android-only account never wrote a user document) as approved by itself, or
one someone approved shared a trip or a profile with before invites
existed, or from an app that writes no invite, as invited by them.

It answers where the account stands. The page follows the record live, so
an approval opens the app at once.

Invited at another address. Someone invited at one address (a work one,
say) who signs in with another sees "Invited at another address?" on the
same page, unless their sign-in was declined: an email field and "Send
link", which mails a confirmation link as Settings' Add does ("Linked
email addresses"), then "We sent a link to <address>. Open it here to
confirm." For an account not approved yet the parser sends one only to an
address that would let it in (`letsIn` in `packages/core/src/access.ts`:
an admin's, or one whose record is approved or invited and not declined),
refusing any other with "That address hasn't been invited to Travelmo."
(`notInvited`, 403) before it checks whether another account has the
address, so a waiting account can neither have Travelmo mail anyone nor
learn who signed up. Asking writes only the parser's private record, never
the user document, whose existence would approve the account. The link's
page, `/settings/email`, is the one page open to a waiting account (the
rest of Settings is not); confirming checks the address still lets it in
(an admin may have declined it meanwhile, which withdraws the link), links
it and writes the user document, which lets the account in: the app follows
that document live, so it opens without a reload.

Admins see Access in the menu (web and Android): everyone approved by a
record, each with Revoke (never
an admin's own address or another admin's, which the rules refuse too); and
Invite, which approves an address that never asked. An account from before
approvals records itself as approved the next time it opens either app, so
it is listed and can be revoked. Revoking writes `declined`, which outranks
the user document and any invite; approving again or inviting from the
Access page lets the person back in.

Enforced in three places:

- The rules: every read and write of app data needs an approved account.
  An account not approved may read its own user document (to tell it is
  missing) and its own access record; `config/access` is readable
  by admins alone (so the app can tell who is one) and writable by nobody.
- The parser: `requireUser`, which every user endpoint passes through,
  answers 403 for an account not approved (`gateUser` in
  `apps/parser/src/access.ts`). `/account/delete` and `/access/check` take
  any signed-in account, so anyone can still delete their account.
  `/emails/add` and `/emails/confirm` take one not approved yet too, but
  not one declined (`gateLinking`), and hold it to addresses that let it
  in (above).
- Background work: a Gmail notification or a mailbox reading's batch for an
  account no longer approved is acknowledged and dropped
  (`notification_for_unapproved_user`, `backfill_for_unapproved_user`;
  a mailbox reading is marked stopped where it got to, so Settings offers
  Continue once access is back, and the stored history id lets a later
  approval pick up from there); an email
  forwarded to its address is refused as an unknown address and bounced;
  its feeds, Google calendars and reminders are skipped (one whose
  approval cannot be looked up is skipped and logged, and the rest carry
  on); flight-status news and check-in reminders are not sent to it, and
  news it was owed is dropped; its calendar link answers 404 as an unknown link does. A new account
  cannot connect any of these, since connecting goes through `requireUser`.

The Android app decides the same way from the same documents (`accessStatus`
in `:core`, a mirror of `packages/core`'s), following them live, and takes an
approval from the phone's cache at once while "not approved" waits for the
server's word. Until that word comes it shows the app as before, so an
approved account never waits on it, offline included. It calls
`/access/check` once each time it opens signed in, so an account the rules
cannot tell is old is let in going forward and admins hear of a waiting
request; when that answers approved while the trip list is empty (a refused
query loads empty), or the account is approved while the app is open, it
asks again for the trips, the travel profile and the profiles shared with
it. An account the server says is not approved sees the web's invite-only
page in place of the app: "Ask someone who uses Travelmo to share a trip
with you.", "Invited at another address?" while it waits (the link
opens on the web, whose confirming writes the user document the app
follows), Sign out and Delete account. Sharing a trip or trusting an
address with the travel profile writes the invite in the same batch, as
the web does. An admin's ⋮ menu, on every screen, starts its own items
with Access, the web's Access page. An account from before approvals records
itself as the web does, so Android-only ones are listed too.

## Linked email addresses

A user signs in with one Google account but may own other addresses (a
work one, say). Each address they confirm counts as them wherever Travelmo
knows people by email: a trip or travel profile shared with it is theirs to
open and edit as a sharee's, shows in their trip list on the web and on
Android, and brings them the reminders, flight news and check-in reminders
a sharee gets; an approval, invite or admin listing of it lets them in
("Access"). Whoever shared keeps seeing the address they typed: nothing in
`sharedWith` or `trustedEmails` is rewritten. Reminder emails still go to
the sign-in address.

Settings (web and Android) lists "Email addresses": the sign-in (not
removable), those confirmed (Remove), the connected Gmail mailboxes, those waiting
for confirmation (Remove withdraws the link), and Add. Add calls the
parser's `/emails/add`, which refuses an address that is already the
user's, another account's (its sign-in, an address it linked, or a
mailbox it connected), or past ten linked and pending; at most five links a
day go out. It keeps a random token's hash (as `forwardAddresses` does) and
mails the link, `/settings/email?token=…`, through the reminders' SMTP
mailer; a link works for 24 hours and once. The page calls `/emails/confirm`
signed in: only the account that asked finds the link (as the Gmail
consent's `claimPending` checks), and in one transaction the claim
`linkedEmails/{email}` is made and the address joins `confirmed` (and the
profile's `emails` copy);
an address another account claimed meanwhile is refused ("That address
belongs to another Travelmo account."). Removing deletes the claim.
Without SMTP the endpoint answers 503. An account not approved yet may add
and confirm too, from the invite-only page, but only an address that lets
it in, and it gets no user document until it confirms one ("Access",
"Invited at another address"); removing needs an approved account.

Every Gmail mailbox connected for import counts as confirmed, since the
consent proved it is the user's, for as long as it stays connected:
disconnecting one drops it unless it was also confirmed by link. Connecting a
mailbox whose address another account linked is refused as connecting one
another account connected is. An address is linked to one account; an
account that signs up later with an address someone else linked is not
stopped, and both count it (the parser then names the account signing in
with it).

Where it is read: the rules check the verified sign-in first, at no cost,
then `get()` the private record's `confirmed` and `mailboxes` (one
document, so several mailboxes cost no extra read) and the user document's
`gmail.emailAddress` (one connected before there could be several, which
clients could never write). They never trust the user document's `emails`
or `gmails`: the rules before let a client write any other field of its
own user document, so a list planted there before they shipped would
otherwise have counted. The parser keeps `mailboxes` in the transaction
that connects, moves or disconnects a mailbox, and adds it again whenever
it renews the mailbox's watch, in case a parser from before `mailboxes`
replaced the record during a rollout. The parser's access checks read the
same. Every write of the
private record sets the profile's copy whole from it, which also wipes a
planted list; until then a planted copy only makes its own account's
queries fail. The apps read the user document and ask for shared trips and profiles with one
`array-contains-any` over every address; Firestore allows 30 values there,
which the ten-address limit (with the sign-in and five mailboxes) stays
well under.
The parser resolves an address to an account (flight news, check-in
reminders, admins' notifications) by sign-in, then claim, then connected
mailbox, and finds a user's shared trips and profiles (reminders, the
calendar export) by all their addresses. Deleting the account deletes its
claims and pending links; trips shared with a linked address keep it.
Pure logic is `packages/core/src/emails.ts`, mirrored in Android's
`Emails.kt`; the parser's side is `apps/parser/src/emails.ts`.

## Access rules

`firestore.rules`, tested in `packages/rules`. Everything below holds for
approved accounts only ("Access"):

- A trip is readable by its owner and by any signed-in user whose verified
  email, or an address they linked ("Linked email addresses"), is in
  `sharedWith`. The owner may change and delete it; a sharee may
  only widen its `start`/`end` (and touch `updatedAt`), which is what saving
  a booking needs. A missing trip reads as absent to any signed-in user, so a
  client can tell a deleted trip from one it may not see.
  Segments inherit the parent trip's access for reading and writing: owner
  and sharees alike may add, edit and delete them, and a written segment must
  have the documented shape (known keys, a valid type, ISO instants, ids that
  match its path).
- A user reads and edits their own profile except the `gmail` and `gmails`
  fields, owns
  their sender patterns, can read but not write their parsed-message log,
  and can never read `private`.
- A travel profile is readable by its owner and by any signed-in user whose
  verified email or a linked address is in its `trustedEmails` (a
  collection-group `array-contains-any` query on that field lists the
  profiles shared with someone). Only the owner writes, and
  only `trustedEmails` (at most 20) and `updatedAt`, or starts the document
  with those and their own uid and email; the imported sections are the
  parser's alone.
- A flight's status is readable by any signed-in user who names its key,
  never listed and never written by a client.
- A user's reminders before trips and their ticks and one-offs on a trip
  are theirs alone to read and write: each reminder whole (an id, words of
  at most 200 characters, a lead time within a year or, for a one-off, a
  date) in one of a bounded set of slots, at most forty ticks; whether one
  was sent is closed to clients.
- A user's `emails` and `pendingEmails` are never written by a client;
  `linkedEmails` and `private` are closed to clients.
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
                               cancels bookings, no segments?  ── yes ───▶ mark them cancelled,
                                        │                               record "cancellation"
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
from the Import review page (`/settings/review`, linked from Settings;
Android's Settings opens the same screen, reading the same records and
rules with `review.ts` and `senders.ts`'s Kotlin twins),
which lists recent emails and other imports that did
not become bookings: the 100 most recent, and with a search, every record
the user has (read in pages of a thousand, up to 20,000), since one import
reads thousands of emails. A search matches words in the subject, sender or
reason, and optionally dates: when the email was sent (`sentAt`, a forward's
original), or when it was read for a record without one (older records,
other sources). Each row shows that date ("Sent 23 May 2026", or "Read …"
when the email's is unknown), the sender and the outcome. It offers three actions: always import that sender, never
import it, or import this one anyway (`POST /gmail/reimport`, which reclaims
the record of a message that did not become a booking — never an imported
one, whose bookings are edited on the trip page, nor one whose import is
live — and runs the import with the pre-filter skipped). Teaching a sender also
drops any pattern on the other list that covers it, so the newest decision
is the one the parser follows. A booking's Sources dialog on the trip page
offers "Always import this sender" and "Never import this sender" on
imported bookings, to the trip's owner. Never also reads the owner's own
trips (`senderCleanup`) and offers to delete what the sender, or a subdomain
of it, already imported: each such booking, and whole the trips with
nothing else (a weekly class imported as a trip a week); shared trips are
left to their owners. Settings on the
web and Android also edits both lists directly ("Sender rules", one domain
a line, saved together; `cleanSenderList` trims, lowercases and drops blank
lines and repeats).

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

The model reads an email's plain-text part when the sender gives the whole
message there, and its HTML flattened to text otherwise: a plain part under
a third the length of the HTML's text is a stub (Virgin Atlantic's
e-tickets put only a footer there), and the HTML is read instead
(`bodyText`, for Gmail and forwarded mail alike), at most 24,000
characters. An email that passes the filters also has its PDF
attachments read (a rail ticket may carry the journey only there), from
every source: Gmail, Fastmail, IMAP and forwarded mail. Up to
three, each at most 5 MB and 10 MB in all (`withinAttachmentLimits`), fetched only then where the
source fetches them apart (Gmail's attachment API, Fastmail's blob download),
and handed to the model as documents beside the text, by every reader of
an email alike (an import, Refresh from email, a loyalty re-read:
`attachmentsOf`), so a refresh never drops what only the PDF gave. Nothing in the
parser parses a PDF, so a malformed or hostile one never runs through our
code; one that can't be fetched is logged and the email read without it.

What isn't a booking: a membership, an annual or season pass, a
subscription, a gift card or voucher, or a donation buys no visit, so the
prompt marks it not a booking, and the importer drops any the model still
returns as an untimed activity (below), recording the email as not a
booking when nothing else is left. A ticket is a booking only for a
specific date, and has a time only when the event has one: an activity
the email gives only a date for is extracted at local 00:00 with no end
(`isUntimed`), and the trip page shows it with no time. A journey's end is
its arrival, never a ticket's validity: an end at 23:59 on a later day, or
more than a week on, is dropped (`withoutValidityEnds`). A payment receipt
for something already booked is the same booking: an untimed activity
titled as a payment (`isPaymentReceipt`) matches one dated up to 31 days
away when both carry the same reference, or, without one on both, the same
provider and a distinctive title word (not "payment" or the like), with no
known city, country or code differing, and is added to it as a source. A
receipt filed first, and not edited since, takes the booking's date, time,
details and places when the booking arrives, keeping both sources: it is
written as a booking filed now would be (a fresh, unedited revision, queued
for the place sweep when lookups were put off), and its trip's dates are
worked out from every booking the trip ends up with. A booking an import fills out (another email's
reference or seats) is not edited: one unedited stays so, with a fresh
revision, so a receipt filled out by a second one still becomes its booking.
Without a shared reference, a receipt and the booking must not
disagree on the event or the venue as `sameEvent` tells them
(`eventIdentities`, `identitiesConflict`; Toy Story 4 is not 5, nor
Everyman Hampstead Everyman Muswell Hill, wherever the title or the place
names it), the words every receipt has aside. Two dated visits on
different days (day 1 and day 2 of a camp, often on one order) never
match.

Everything below the model is source-agnostic (`fileBooking` in
`apps/parser/src/importer.ts`): a source hands over bookings and a stable
source id, and gets the same duplicate check, trip assignment, segment ids
and parsed-message record. Duplicates are matched across sources, since a
TripIt export has no confirmation numbers to match on (`sameBooking`): the
same type, the same local start minute for journeys and activities (or,
for a journey moved by a schedule change, the same reference and service
number, "UA 122" being "UA122", that day within six hours; the newest
email by when it was sent sets the journey's times, unless the user edited
it: `mergeDetails`) or the same
dates for stays and rentals, and then evidence of identity, since
dropping a real booking loses it: equal confirmation numbers when both have
one, otherwise agreeing codes at both ends of a journey, or a distinctive
word shared by the two titles or place names other than their city and,
unless it is all the name there is, their chain or provider. Known cities
and countries that differ rule a match out, except for one stay told by two
emails (a booking request or receipt and its confirmation): the same
provider, the same listing title (case, accents and punctuation aside) and
the same check-in and check-out instants are one stay, whichever town or
suburb each names (letters of every script count, so "東京" and "大阪"
listings stay two), unless both carry references that differ or name
different countries. In doubt, both are kept. One
event confirmed by two emails under two references (a cinema's booking
confirmation and its reservation email) is one booking too (`sameEvent`):
two activities at the same local minute from the same seller, by a shared
word of the provider's name or the same sender domain, in the same town
where both give one, whose event names agree: the title before any
"at <venue>", less the venue's and the seller's words, one holding every
word of the other, short words and numbers counting (Toy Story 4 is not
Toy Story 5, nor Inside Out Inside Man; only "the", "a", "an", "at", "of"
and "and" are left out). A shared venue alone is not enough, so two films at one cinema
and time stay two, and venues both name (after "at" or as the place, less
the seller's and the city's words) must agree, one allowed to shorten the
other: "Everyman" is "Everyman Muswell Hill", Everyman Hampstead is not. A TripIt export or a calendar file is
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
stay one click away. What the new one adds is merged into the booking
kept (`mergeDetails`): fields it lacked, notes it does not already hold
(seats, a screen) and, when the references differ, "Other reference: …";
nothing else it already says is replaced, except a stay's place, which
gives way to a more specific one (an address, then coordinates, then a
city, or as much from the email with the reference the booking lacked),
keeping what only the old place said (its country, say), so
the confirmation's "St Kilda" and address replace the request's
"Melbourne"; a booking the user edited keeps its place. The kept booking's trip widens in the same
transaction when the booking now ends later (a checkout only the second
email gave), and a place it gains that the geocoding budget put off is
queued for the daily sweep like a new booking's, all under the reset
generation the import began with (below), so an import the user's "Delete
all trips" overtook adds nothing to a booking filed again since. When all of an email's bookings are, the email is still
recorded as imported, with none. A booking part of which matched joins the
trip of that match, and otherwise its whole range, new and old legs
together, picks the trip: the one within two days of it, except that
outings never chain by nearness of dates alone ("Home" below). A
journey's end more than eight days after it leaves (a ticket's expiry read
as its arrival) is not trusted for a trip's dates; its start stands for
both (`segmentDateRange`, also in the Android `:core`).

### Cancellations

An email that cancels a booking (Booking.com's "Booking cancelled for …",
an airline's cancellation; a subject saying "cancellation", "cancelled" or
"canceled" passes the prefilter and the mailbox backfill's query, whoever
sent it) comes back from the model with no segments and
a `cancellations` list: as much of each cancelled booking as the email
gives (type, provider, confirmation, the place as named, start and end).
The importer looks through the user's own trips, never one shared with
them, for bookings each names (`cancels` in `packages/core/src/trips.ts`):
a confirmation number decides which reservation when both have one, and
any leg the email names in it (a date, a time, a flight number, a
direction) which of its bookings, the reference alone cancelling them all
of those near the email (ended no more than a month before it was sent,
or starting within two years after: references are recycled);
otherwise the dates must
agree and the named place must share a distinctive word with the booking's
title, place or provider. When the email gives a time, anything but a stay
must start at that minute (a 14:00 cancellation leaves the 19:30
performance alone; a stay's check-in time is generic, so only its date
counts), and a flight, train, bus or ferry must also go the same way (the
email's origin and destination are the booking's, by code when the
booking has one and the email gives three capital letters, else by a word
of the name that isn't the city's: London Heathrow is not London Gatwick,
and "Luton" is a name, not a code): the same-day return is another booking.
A flight or train number tells legs apart: an operator's code and number
("BA 117", "ICE 578") or, for a journey, a number after the operator's full
name ("Eurostar 9014", the same train as "ES 9014"); when only one side
gives a number, the route's words alone don't match it. The bookings carry nothing else that tells them apart
(seats or rooms are only in free-text notes), and the provider rules one
out only when both name plainly different companies (no shared distinctive
word, neither the other's initials, as BA is British Airways, nor a code
too short to tell): a booking site or agency (Expedia, Trip.com,
Booking.com) sells others' bookings, so it can cancel any of them. A
booking a later email fills in (mergeDetails) is checked against waiting
cancellations too. Cancelling the wrong booking hides a real one, so
anything weaker matches nothing. A match gets `cancelledAt` and
`cancelledBy` (the email's id); it is not deleted. Marking is an import's
write, not an edit: an unedited booking (`updatedAt` still its
`createdAt`) stays unedited, so a calendar change or a booking upgrading a
receipt can still replace it, and a receipt upgraded into a booking is
checked against waiting cancellations like any other. Restore is the
user's edit, so a restored booking is no longer replaceable. The email is recorded
with outcome `cancellation` and a reason ("cancelled 1 booking", or "no
matching booking found"), so it shows in the Import review list either
way. Reading the email again changes nothing.

A mailbox is read newest first, so a cancellation usually arrives before
the booking it cancels, and another leg under the same reference may come
later still. So every cancellation also waits in
`users/{uid}/pendingCancellations/{messageId}` (`messageId, uid,
cancellations[], at, sentAt`; the parser's alone), and every booking filed after
is checked against it in the same transaction: a booking one names is
written already cancelled and the email's record is updated to say so.
Whichever order the emails arrive in, every leg it names ends up
cancelled. A booking from an email sent after the cancellation's is one
made again since, which it leaves alone, whichever is read first (each
email source records its `sentAt`); a cancelled booking such an email
confirms again comes back live. Each time an email touches a booking, its
state is weighed afresh from every cancellation read and every email that
confirmed it, by date (`standingCancellation`), so the order they are read
in never matters: a cancellation stands unless a confirmation was sent
after it (at the same time, it still stands), the latest that stands is
the one the booking records (with its date, `cancelledSentAt`, so
deleting a cancellation that stopped waiting changes nothing), and one of
unknown date always stands. A forward (by the forwarding address, or a
Gmail message whose subject starts "Fwd:") is dated by its original's
Date: or Sent: line in the forwarding block, never by the forward; when
that line is missing or unreadable, the email orders against nothing. A
receipt, invoice or refund books nothing, so it dates nothing either: one
sent after a cancellation neither revives the booking nor shields it. Each booking a cancellation names stops
waiting a month after it was read once that booking has ended, or after a
year if it gives no dates (`stillWaiting`), and only those still waiting
are matched; the cancellation stops waiting when all of them have
(`pendingCancellationExpired`), and the next import deletes it then. Deleting
all trips clears them too, and deleting the account removes them with
everything else under the user.

A cancelled booking stays on its trip, struck through under a "Cancelled"
label (web and Android), and counts for nothing else: the trip's dates,
Fit dates, what's next, the current stay, check-in, document reminders,
the calendar export, reports, favorite places and working out where home
is all leave it out. A trip whose every booking was cancelled
(`allCancelled`) isn't happening: it gets no document warnings or
reminders, no calendar event and no report counts, done or ahead, and
its card says "Every booking cancelled"; a trip with no bookings yet (planned by
hand) still gets all of them
(`liveSegments`). Two kinds of trip dates, kept apart:

- **Its own dates** (`start`, `end`) always cover every booking in it,
  cancelled ones too (`bookedDateRange`): they are how an import finds
  its bookings again (a cancelled stay weeks after the rest is still found,
  and revived, when it is booked again), and what editing works on (the
  trip's dates, Fit dates, a booking saved, moved or merged in, Restore).
  An import also finds a booking by its reference in any trip of the year
  either side, whatever the trip's dates.
- **When the person now travels** (`liveStart`, `liveEnd`, from
  `liveBounds`): an end only a cancelled booking reached moves in to what
  is still booked; an end set beyond the bookings (planned by hand) stays;
  absent when nothing is cancelled or nothing is left booked. Read through
  `displayBounds`, which falls back to its own dates, by everything that
  groups bookings into trips (an import choosing a trip, regrouping) or
  shows when the person travels (the trip list and card, the trip's
  header, upcoming or past, the calendar, reminders, document and visa
  checks, Android's screens), so a cancelled stay at a trip's end draws
  nothing else in.

The importer sets the second once it has written everything for an email
(and regrouping once per pass), whichever path cancelled or revived a
booking; the apps widen it with a booking still booked and keep it apart
when a cancelled one widens only the trip's own dates; Fit dates sets both
from the bookings. The calendar export's trip event and reports span what
is still booked (`reportBounds`). **Restore** on the booking takes the cancellation
back (adding the email's id to the booking's `restoredFrom`, and the time
to its `restoredAt`: no cancellation sent before then, or read before then
when it has no date, cancels it again, whichever one had won, while those
still apply to other legs; one sent later still does)
and widens the trip to include it again; **Delete** removes it. An
edit or a move to another trip keeps it cancelled and widens only the
trip's own dates. An import finds a
cancelled booking again (as a duplicate) only by its confirmation number
or its own source: a booking alike in all else, made again after
cancelling, is filed as a new, live one. Live first, wherever a trip is
chosen or named (an import, a receipt it upgrades, a duplicate it finds,
regrouping): what a booking still books decides, and its cancelled parts
only when nothing in it is live, so a cancelled stay never pulls a live
one into its trip. A
calendar's own cancelled events are handled apart, by removing what they
made (see "Calendar files").

### Home

Trips are travel away from home, so the app needs to know where home is,
and since people move it is a timeline, not one place (`homeTimeline` in
`packages/core/src/home.ts`, mirrored in the Android `:core`). Nobody types
it in: a round trip, a journey out and the first journey back into the town
it left, however many legs lie between, says where home was on its date.
Towns match on the city (or a place's name when it has no city), ignoring
case, and on the country when both give one. A round trip away for more
than 60 days says nothing: either they lived where it went for a while, or
its way out was never imported and it is really the way back from one visit
and the way out on the next (Boston to London in January, London to Boston
the next December), which would otherwise swallow a year of trips from
London; the round trips within it count instead. The first round trip's
base is home until another base holds for two round trips in a row, which
is a move dated from the first of them; one trip from somewhere else
(flying home from a relative's) is not, and nor are side trips from
somewhere when the next round trip after them is from home again (New York
and Maine from Boston on a family visit whose flight out is missing). Periods are calendar dates, inclusive, the first open
at its start and the last at its end. Corrections the person makes are
periods too, and once there are any they are the whole timeline: there is
no home before the earliest, since what was worked out is what they
corrected (`homeAt`).

The Profile, on the web and Android, shows home over time in a line ("Home: London since Mar 2021 ·
Boston 2018–2021", `describeHomes`), worked out from the user's own trips
with their corrections over it (`effectiveHomes`), and takes corrections
(`parseCorrection`, listed by `correctionText`; Android picks the date with
a date picker):
home is a town (and optionally a country: a code, or a name or short form
such as "UK", saved as its code) from a date. A correction saved before the
form took names ("UK") is read as its code. Towns are one when their
cities and countries are, however written: case, accents and a city's local
or English name don't count ("Göteborg" is "Gothenburg", `sameCity`), nor a
country's name or short form ("UK" is GB, `countryCode`). Two places that
both have coordinates are also one town within 20 km of each other
(`nearKm`), in no two countries: a hotel in Solna is in Stockholm, and a
car hired in Hounslow is at Heathrow. Home is a typed town with no point,
so it still matches by name. They live
as `homes` on the user's own document (`users/{uid}`, `HomeCorrection`, at
most fifty), which only the owner reads or writes; rules check it is a list
of at most fifty, and the parser parses it (`loadHomeOverrides` in
`apps/parser/src/homeOverrides.ts`), logging and ignoring a list that does
not parse. Each correction runs until the next one's date
(`homeCorrections`), and with any correction the worked-out home is dropped
altogether (`effectiveHomes`): corrections of London from 15 Jan 2022,
Mountain View from 25 Nov 2011 and Elsternwick from 1 Mar 2003 read "London
since Jan 2022 · Mountain View 2011–2022 · Elsternwick 2003–2011", with no
home before 2003. Imports and regrouping read them for every booking
filed (`ImportDeps.homeOverrides`).

Grouping uses it (`findTripForBooking`, also in `home.ts`). Each import
works out home from the bookings of the trips within a year either side of
the new one, plus the new one itself (a return ticket is a round trip on
its own), and corrections win as above. Bookings are outings (an activity,
a car hired and returned in one place, or another booking in one place) or
travel (journeys, stays, and transfers, such as a car to the airport, which
are never at home). Travel joins travel within two days, but never across a
journey home: once a trip's last journey has brought someone home, what
starts after it is another trip, however soon (`homeBetween`), so a flight
to Boston two days after the flight back from Sweden starts a trip of its
own. Outings never
join by nearness of dates alone, home known or not, since a town that is
not named as home (Muswell Hill, Bromley) or a home not yet worked out on a
fresh import would otherwise string a summer of outings and the trips
between them into one: each outing is a trip of its own, so a dinner at 6pm
and a show at 8pm at home are two days out. On the same or the next day, an
outing joins another that is one thing with it: tickets for one event (the
same title, or the same town, at the same time) or the days of one course
(the same title but for the day or date, in one town; below). One email's
outings on days more than a day apart (a weekly class booked for a term)
are filed run by run, each run of consecutive days on its own, keeping the
ids they have as one list (`outingRuns`). Within two days, an outing joins travel
when it happens where the travel has taken someone at the time, other than
the home of its day (or, with home unknown, where the travel sets off
from): before the first journey leaves, where it leaves from; between
journeys, where the last one arrived; after the last, where it arrived; or
the town of a stay (`onTheWay`). Abroad, the country is enough: a dinner at
a resort down the coast from the airport a flight lands at, while the trip
is in that country, joins it (a Crete holiday's restaurant bookings are one
trip, not seven); in the home country only the same town counts, so a show
in Hove is not part of a train from London to Brighton unless both say where
they are (Hove is next to Brighton). An outing with no time of its own
(`isUntimed`) is on all its day, so a ticket for the day a flight lands
comes after it, and one for the day a flight leaves before it. Direction and time matter: a ticket in
Stockholm joins the flight there before it and a return flight booked alone
after it, while a dinner in London two days before a train from Southampton
to London (the way back from a trip whose way out was never imported) does
not, nor does a day camp the day before the car to Stansted, or a course
while the family flies to Boston. With home known, outings away within two
days in one town join each other, as a weekend of tickets in Liverpool. So
a holiday club in London either side of a weekend in Liverpool comes in as
three trips, each club day named as a day out and the weekend "Liverpool":
a new trip is named after its first destination that is not home, or
failing that its first origin that is not (a return leg booked alone),
looking at journeys first, then stays and the rest, then a car or
transfer's drop-off, so a flight to Melbourne makes a Melbourne trip
whichever suburb the stays are in. A connection's stop is on the way, not
where the trip goes: a journey's destination the next journey leaves from
within twelve hours, from the same city or another of its airports or
stations within 80 km (`isConnection`), so Zagreb to New York via Paris
names nothing "Paris". Only a town names a trip: a place's city
(the geocoder's when the source gave none), or for a journey an airport or
station named without one. A place that is only its own name (a stay's
listing, "Designer Collingwood Terrace") names the trip only when nothing
else does. When a booking joins a trip still named as an import named it
(the name its bookings, or the bookings of any one email, give it, by the
current rules or the earlier ones that named a trip after a place with no
town, or the name of one of its bookings or their places), the trip is
named again from all its bookings, as it is when a booking found again
changes what its bookings say (a stay's confirmation giving the town its
request lacked); a trip the owner renamed keeps its name
(`importGaveTitle`). A day
out is named after what it is, and so is a course of several days at one
place: one ticket spanning them, or one a day with the same title or
titles that differ only in the day or date ("Holiday Camp East Finchley - Junior Group" for "... (Day
2)", "Debutots Camp" for "Debutots Camp - 11th Aug 2025", not the school it
runs at). A date there has a day and a month, in the forms bookings write
("- 11th Aug 2025", "(Mon 11 Aug)", ", 11/08/2025", "- 2025-08-11", "on 11
August"), so a number alone ("Toy Story 5") stays in the title. Titles are
reduced by pattern rather than to their longest common start, which would
name "London Eye" and "London Zoo" on two days "London", and "Toy Story 4"
and "Toy Story 5" "Toy Story".

A car or taxi booked from one place to another (`isTransfer`: a car or
"other" booking whose origin and destination differ by code, name and
address) is a ground transfer, such as a car home from Heathrow. Like a
journey it is never at home, but it is no round trip and says nothing about
where home is. Before any of the above, a transfer joins the trip of a
flight, train, bus or ferry it meets (`connects`): it leaves the airport or
station the journey arrives at up to 12 hours after it lands, or reaches
the one it leaves from up to 12 hours before it departs; of several, the
trip with the shortest wait wins (`connectionGap`). The place matches on the
same code, the code written in it in any case ("Heathrow Terminal 3 - LHR"),
or a word of the hub's name that is not its town's ("Heathrow" of London
Heathrow). Whichever is imported first, the other joins its trip. A trip of nothing but a transfer is named by its route
(`transferTitle`): "Heathrow to home" when it ends in the home of its day,
else "Heathrow to London"; when a journey later joins it and the owner has
not renamed it, it takes the name the whole trip would get ("New York"), as
above.

To start over instead, "Delete all trips" in Settings on the web and Android (`POST /trips/delete-all`,
`apps/parser/src/tripsReset.ts`) deletes every trip the user owns, its
bookings (with their ratings and favorites), every import record and every
cancellation still waiting for its booking, in
passes in the import's per-user transaction until none is left. Every pass
moves on a reset generation kept on the import lock; every import (an
email, a calendar event, a TripIt item, a calendar upload or a mailbox
reading as a whole) reads it before any state it acts on, and every write it
makes checks it in the write's own transaction: the claim, the booking and
its trip (and marking it cancelled as it's filed), a cancellation marking
bookings and waiting for more (written, kept or expired), removing the
bookings of a changed or cancelled event, the record and its revision (a
cancellation's included, when a booking filed later names it), a place
queued for another look, the mailbox reading's
position, and how far new mail has been read (a Gmail notification the
reset overtook fails, so Pub/Sub delivers it again). Each goes ahead only
while the generation is unchanged
(and the account not deleted), so an import that was running (reading the
email with the model, say) files and records nothing, and the email is read
again by the next import rather than recreating a trip or leaving a record
of bookings that are gone. In each of those transactions it also forgets
how far the last reading of the mailbox got, so "Import past bookings"
reads every email again and a reading can never pair the new generation
with the old place; a reading saves its place only while the generation it
read first is unchanged. Trips others share with the user, bookings the user added to
them, the travel profile, home corrections, connections and feeds stay.

To bring bookings imported before a fix to extraction or matching up to
date without deleting anything, "Refresh from email" in Settings on the web
and Android (`POST /trips/refresh`, `apps/parser/src/refresh.ts`) reads
again only the emails that made bookings: the user's import records with
outcome `imported` from a mailbox (Gmail, Fastmail, IMAP; not TripIt items,
calendar events or forwards, which cannot be fetched again), never a
mailbox search. Each email is fetched from the mailbox its record id names
(as `/gmail/reimport` does), read by the model with today's prompt, placed
from the airport and city tables and the geocoder, and filed by today's
matching, in place, in one transaction under the import's per-user lock
that checks the reset generation like every import write. Every booking the
email gives now is paired with the one it gave before, chosen for all of
them before any is filed so none takes another's (the one filed for that
very item while it still looks like it, else any of the email's that does
by `sameBooking`/`sameEvent`, else the one at its place in the email of
its type) and with any other the matching takes for the same reservation, an
older import's duplicate. One of them stays: one the user edited by hand
("Editing by hand"), else one they rated, else one they marked a favorite,
else the email's own. It keeps its id, trip, rating, favorite mark and
cancellation, gains the others' sources, rating and favorite mark and
what only they knew where it has none (a reference, a provider, a time),
is weighed again against the cancellations waiting for bookings once
corrected, as an import weighs one it finds again,
and the others are deleted, unless the user edited them or they are on a trip
shared with other people. As an import keeps them apart, only bookings
from emails merge (one from a calendar event, a TripIt item or the
booking form is its own reservation, two alike rooms say), never the
email's own bookings, which are its items', one each, never two
bookings any one email gave (each is its own reservation) or two under
different references, only within
trips shared as the email's own booking's is, and only one as cancelled
or live as it (a cancelled stay and the one booked again in its place
stay two). An unedited booking that stays takes the new
details: all of them when this email is its only source, else what it
lacked (`mergeDetails`, as an import fills a booking found again); an
edited one is left as it is. A booking the email gives now that matches
none is added beside the email's other bookings (else where an import
would file it), cancelled when a cancellation already waiting for a
booking covers it, as an import would file it. One the email gave before and no longer gives is deleted
when unedited and from this email alone, and kept otherwise. An email the
model finds no booking in now changes nothing, so a passing model failure
never empties a trip; a trip left with no bookings is deleted unless it is
shared. Trip ids, names the user gave, sharing and "Before you go" ticks
(by trip id) are never touched; the refresh ends by regrouping (below),
which renames only trips still named as an import named them. It runs on
the server as a mailbox reading does, on the same Pub/Sub chain
(`backfillChain.ts`, its messages marked `kind: "refresh"`), its progress
on the user document (`refresh`): batches of up to a hundred records in id
order, each stopping before Cloud Run's request limit, Gmail paced to the
same 4,000 units a minute, Gmail's rate limit waited out a minute with the
refresh going on by itself, while the model's rate limit, or an email the
model fails on (passed and counted), stops it for Settings to offer
Continue; Stop saves the place. Settings says how far it got ("120 of 340
emails read") and, once done, what changed (bookings updated, added,
duplicates merged, removed, bookings edited and so left alone, emails no
longer in a connected mailbox, emails that could not be read), in the
words of `tripActions.ts` and its Kotlin twin. Progress saved under an
older reset generation counts as none, so "Delete all trips" stops a
refresh, and drops its progress from Settings.

Trips filed before home was known are rebuilt on request ("Regroup trips"
in Settings on the web and Android, `POST /trips/regroup`,
`apps/parser/src/regroup.ts`; both say what it did in the words of
`tripActions.ts` and its Kotlin twin), in the
import's per-user transaction. It first gives every booking what the
airport and city tables know and it lacks, a country or a spot
(`apps/parser/src/placeBookings.ts`; hand-entered bookings aside, and no
geocoder call, nor any revision moved but the trip's), so a fix to the
tables reaches bookings already filed at once, and says how many it
placed. "Import past bookings" does the same once
it reaches the end of the mailbox, since it files bookings in the order
their emails are read: a car hire read before its flight would otherwise
start a trip of its own. A regroup that fails there is logged and leaves
the reading done; the bookings are all in. Each booking, the segments that share any
source kept together (an outbound from one email and the return a later
email filed beside it stay one), is filed again in the order they happen with the same
decision as an import. Each resulting trip keeps the existing trip holding
most of its bookings, with its id, sharing and dates; it keeps that trip's
title too while it still holds every booking the trip had, so a name the
user gave a trip only added to survives (otherwise it is named from all
its bookings, so a trip that starts with a car to the airport is named
after where the flight goes). A trip still titled as an import titled it
(`importGaveTitle`, above) is named afresh from its bookings: a course
titled with its venue's name, as imports named one before they read dates
in its titles ("Weston Park School"), is renamed after the course, and a
trip named after a stay with no town before a flight to Melbourne joined it
becomes "Melbourne". A trip whose bookings are
unchanged is not written at all. Bookings never move between trips shared
with different people (the maintainer's call: never mix them). Bookings are
regrouped only among trips with the same share list, compared as a set and
ignoring case, a private trip's being empty, and a trip they start is shared
as the trips they came from were. So nobody gains sight of a booking, as a
sharee could by filling a shared trip until it won the regroup, and nobody
loses it. A booking of nothing but journeys that ends one trip by landing
away from home where the next trip's first journey leaves from (the same
city or another of its airports or stations within 80 km, after it lands:
`opensTrip`) opens that next trip instead: the flights from Zagreb to New
York on 4 Apr join the week in New York that ends with the flight home
from Newark, rather than ending the Zagreb trip. Imports file it the same
way, in whichever order the emails come: the flights to New York join a
New York trip already holding the flight home, and a flight home read
afterwards takes the flights that lead to it from the trip before
(unless the user edited them, or either trip is shared). A trip left with
none of its bookings is deleted; one that never had any is left alone, and
a TripIt trip keeps its own grouping. Bookings are moved, never changed or
deleted, so ratings and favorites go with them, and two bookings an earlier
import failed to match (a stay requested and confirmed, filed twice) stay
two, for the owner to delete one; an import record still
names the trip a booking was first filed in, and a later calendar change
treats a regrouped booking as one the user moved, keeping it. Running it
again changes nothing. A plan too large for one transaction (Firestore's
500 writes) is applied over several, each planning afresh and finishing
what it moves: a trip it took bookings from is deleted when left empty or
has its revision moved, so a merge that read it before retries. Every pass
moves at least one booking: a move too large for one pass goes in parts,
and a trip already named and dated as planned is not written again. A trip
empty when regrouping began is never deleted.

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
number and status under the provider, one program a line, so the number is
at hand at check-in; a number that is someone else's (below) says whose.
A fellow traveler's own travel profile stays theirs alone.

#### Loyalty from emails

The same model call that reads a booking email lists the loyalty numbers it
shows (`memberships`: program, number, the member's name, status), never a
booking reference or card number. Once the email is imported as a booking,
the parser keeps them in `foundLoyalty` on the travel profile, starting the
profile if need be. A number under a generic label ("Frequent Flyer") is
filed under its airline's program (`namedProgram`): by the airline code
written before it ("UA-…" → United MileagePlus), else the one airline every
flight of the booking is with; the model is also asked to name the program
and, where an email lists travelers one after another, the traveler each
number is listed with. One whose name could not be the account's (it shares
no name with the Google profile's `displayName`, or its first name is
another, as family who share a surname) is someone the owner books
for, a partner or a child: it is kept as theirs (`person`, the name as a
person is called: "MR ALEX SAMPLE" and "SAMPLE/ALEX MR" become "Alex
Sample"). A number that is a balance read as one ("9,600 Points": a comma,
or points, miles, credits or nights) is never kept, and one already stored
is left out when read. A number seen again (ignoring spaces, dashes and
case, in a program sharing a distinctive word, or one whose name has none,
such as "Privilege Club") is refreshed rather than added, keeping whose it
was first seen to be. Every number is kept: the list is bounded only by
Firestore's 1 MiB document limit, sharing the profile document with
TripIt's details (up to 700,000 bytes): 300,000 bytes
(`foundLoyaltyBudgetBytes`) and at most 2,000 entries (`maxFoundLoyalty`,
which the rules check), which nobody reaches; past either a new number is refused
rather than an old one dropped, and the parser logs `found_loyalty_full`
(counts only). A TripIt upload replaces its own sections and leaves these alone.
Profile's table and a booking's loyalty line read both (`allLoyalty`): what
TripIt imported, then what emails showed that it did not have by number,
each noting the email it came from. "Found in your emails" on the owner's
own Profile lists them with Remove, since the extraction is sometimes
wrong; the Android Profile tab and booking rows show them the same way,
with the same Remove. Nothing is logged but counts.

When how numbers are read changes, those already kept are brought up to
it once (`foundLoyaltyRevision`, run in the background as the parser
starts and marked done in the server-only `config/foundLoyaltyRevision`
with its totals, `found_loyalty_revised`: users, entries fixed, emails read
again, skipped and failed). First, from what is stored: each entry's
program by `namedProgram` with the bookings its email made (its import
record's), and whose it is from its holder by the owner's name, filling or
correcting only the automatic `person`, never `loyaltyPeople`; entries that
now name one membership are merged. Then an entry still with no holder or
a program any could have ("Frequent Flyer") has its email read again from
its mailbox, once per email and only from a Gmail, Fastmail or IMAP
mailbox still connected, and the model's memberships replace that email's
entries (keeping a balance or status the new read lacks; a read that finds
none changes nothing). Trips, bookings and import records are never
touched. An email that is gone, forwarded, or in a mailbox no longer
connected is skipped, and a user that fails is logged and skipped, by
counts and kinds of error only. The first step costs only Firestore reads;
the second one model call per email that still needs it.

The loyalty table is grouped by person: the owner's ("You") first, then
each other person's under their name, the headings shown once any number is
someone else's. On the owner's own Profile each row's ⋮ asks "Whose is …?":
Mine, a person already named, or someone else by name. The answer goes in
`loyaltyPeople` on the travel profile (program, number, and the person or
nobody for the owner; the newest hundred, owner-writable only), which wins
over what the email said and covers TripIt's programs too.

Numbers are kept only from an email that books travel (a flight, train,
bus, ferry, stay or car): a ticket or an appointment that shows a member
number keeps nothing, and the model is told to list travel programs only,
never a shop's, a card's, or a medical, political, union or other
membership.

A travel program's statement ("Account notification: we're pleased to
present your Emerald Club eStatement", "November statement: …" from
MileagePlus) is read for the balance and status, though it is no booking:
the pre-filter passes a subject with a statement word ("statement",
"eStatement", "account summary", "points balance") only from a travel
company's own domain (`travelLoyaltyDomains`: airlines, hotel groups, car
rental companies) or a sender the user always imports, so a shop's,
supermarket's, bank's or insurer's statement never reaches the model. One
more than 60 days old is skipped, so reading a whole mailbox does not send
every old statement; that reading's Gmail search asks for those domains'
statements of the last 60 days beside its booking subjects. One forwarded,
or read again on request (both skip the pre-filter), is still known by its
original sender and subject (`isTravelStatement`). Its balance is kept as of the email's date
(`balanceAt`), and an older one never replaces a newer, with the status it
came with; the loyalty table shows it. A statement newer than the last
TripIt upload (`importedAt`) for a program TripIt imported brings its
balance and status to that program's row, noting the email.

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
subscription link) from Settings on the web or Android (each listed with
what its last read did, `describeCalendarResult` wording the first); the
parser reads it when it is added and
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

### Forwarded email

People whose confirmations are not in Gmail forward them to an address of
their own, `<token>@<FORWARD_DOMAIN>`, created from Settings on the web or
Android (offered where the build has the domain, `NEXT_PUBLIC_FORWARD_DOMAIN`
or Android's `travelmoForwardDomain`, or to someone who already has an
address; copied, replaced or turned off there): the token is
twenty lowercase base32 characters (100 bits), only its hash is stored
(`forwardAddresses`), and issuing again retires the old one. The domain is
on Cloudflare: Email Routing's catch-all rule hands every message for it to
the Email Worker in `apps/inbound`, which does no parsing of its own (the
free plan's CPU allowance is small) and relays the message as it arrived,
with the envelope recipient and a shared bearer secret, to the parser's
`/inbound/cloudflare`. The parser checks the secret in constant time,
refuses more than 16 MB (room for the PDFs the model is shown), parses the MIME
(`postal-mime`), reads the original sender and subject out of the forwarding
block Gmail, Apple Mail, Outlook and Thunderbird write (else the forwarder's
own, the `Fwd:` prefix stripped), and runs `importMessage` with
`source: "forward"` and the pre-filter skipped: forwarding is the user's
request, as "import anyway" is. The record id is a hash of the message's
`Message-ID` (its bytes when it has none), so a relay retry is one import.
A per-user daily cap (`FORWARD_DAILY_LIMIT`, default 50) bounds the model
spend should an address leak; a message past it, or to an unknown or
retired address, is answered 429 or 404 and the Worker bounces it to the
sender with the reason, so a mistake is seen rather than swallowed. A
message the model could not read (unavailable, rate-limited, an answer
that failed validation) is recorded `failed` and answered 503, not
acknowledged: the Worker fails, the sending server tries again later, and
the retry claims the failed record afresh, as a re-uploaded file does; a
redelivery while another delivery's claim is live is answered 503 too, and
the retry finds the outcome. Any other failure makes the Worker fail the
same way.

### Google Calendar

A second Google consent, `calendar.readonly`, separate from Gmail's: its own
refresh token, its own disconnect, the same OAuth client and callback (the
OAuth state records which consent it was, and the callback sends the browser
back with `calendar=` rather than `gmail=`; Android's Connect opens the same
consent page in the browser, which hands back to the web). Once connected,
Settings on the web or Android lists
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

Backfill (`apps/parser/src/backfill.ts`) runs the same path over a Gmail
search for booking-like subjects across the whole mailbox, each connected
mailbox on its own (its progress on its connection, its batches' messages
naming it by key, `mailbox`; one queued before there could be several
names none and reads the user's first), in batches of up
to 300 messages found by one search call, each stopping after three minutes.
Each batch carries on from Gmail's page cursor, which is kept with its
progress (`scanned`, `imported`, `failed`, `done`) on the connection, where
Settings shows how far it has got. A cursor Gmail no longer accepts restarts
the search; messages already read are skipped by their claims, so only Gmail
reads repeat.

Gmail charges each user's calls against a quota of 6,000 units a minute
("Total Query Cost"): a search costs 5 units, but fetching a full message
costs 60, so at most 100 messages a minute. Imports run one after another,
and one quick to turn down (most are) takes well under 0.6 s, so a reading
that fetched as fast as it could ran out of quota within its first minute.
A batch therefore spaces its calls to spend at most 4,000 units a minute
(about 66 messages), leaving the rest for new mail and for opening emails
from the app. If Gmail still answers with its rate limit (429, or 403 with
`rateLimitExceeded`, `userRateLimitExceeded` or "Quota exceeded"), the batch
waits, as long as Gmail asks or with exponential backoff from two seconds up
to a minute, and tries again, as long as its three minutes allow. Past that
it saves its place like a batch out of time, sets `retryAfter` a minute on,
and queues the next batch as usual: a rate limit is never a failed import
and never stops the reading. New mail waits out the rate limit for up to a
minute before its notification fails and Pub/Sub delivers it again.

The reading runs on the server, so closing the page does not stop it
(`apps/parser/src/backfillChain.ts`):

```
Settings ─POST /gmail/backfill─▶ new run id, step 0, running ─publish─▶ gmail-backfill
                                                                            │ push (OIDC)
         ┌──────────────────────────────────────────────────────────────────┘
         ▼
/internal/backfill {uid, run, step, wake?}
   │ run, step or wake not the stored ones, or stopped ─▶ 204, dropped
   │ read already, next never queued ─▶ publish {uid, run, step + 1}, 204
   │ a lease or retryAfter holds ─▶ wait up to a minute; still held ─▶
   │     store wake: new id and handoff, publish {uid, run, step, wake},
   │     clear handoff, 204
   │ handed on, maybe never published ─▶ publish {uid, run, step, wake}, 204
   ▼
take a sixteen-minute lease ─▶ read one batch ─▶ save place, step + 1, lease off
   │ failed ─▶ lease off, wait fifteen minutes (retryAfter), 5xx, Pub/Sub retries;
   │           three batches in a row ─▶ stopped
   │ rate limited ─▶ saved as above, retryAfter a minute on
   ▼
more to read, nothing failed, still running ─▶ publish {uid, run, step + 1}, mark queued
```

Pub/Sub delivers at least once and in any order, so a message only runs
when its run id and step are the ones stored: each start makes a new run
id, so an older reading's messages are dropped; a batch that saved moves
the step on, so a late copy of its message is dropped; and a copy that
arrives while its batch still reads finds the lease taken and waits.

A delivery that must wait (a lease, or `retryAfter`) never answers with an
error: Pub/Sub gives a message ten attempts, which in practice all come
within about five minutes, far less than a failed batch's fifteen-minute
wait, so failing them sent the reading to the dead-letter topic and lost
it. Instead the delivery waits inside its request, up to a minute (so the
batch after it still fits Cloud Run's five-minute request), and if the
batch is still held, stores a new `wake` id, publishes a fresh message for
the same step with it, and acknowledges. Only the message whose `wake`
matches the stored one (none, for the step's first message) may run or
hand on, so other copies are dropped and one message at a time carries the
reading. The id is stored before the message is published, so the fresh
one runs however soon it arrives, together with `handoff` (the old
message's `wake`), cleared once the publish returns or the fresh message
runs. While `handoff` is set, the old message, if delivered again because
publishing failed or its worker died, publishes the fresh one again rather
than being dropped; a second copy of the fresh one waits and is dropped. A
finished batch clears `wake` along with the step.

A batch saves `queued: false` with its
place and sets it once the next batch is published; if the worker dies or
publishing fails in between, the push fails, and the copy Pub/Sub delivers
again publishes the next batch instead of reading (a second copy of that
next batch, at worst, is dropped by its step). A batch that fails fails the
push, gives up its lease and sets `retryAfter` fifteen minutes on, at least
as long as the claim it may have left on the email it was importing
(`claimLeaseMs`) blocks that email: read sooner, the batch would skip the
email as another import's and pass it by, so no batch of any reading runs
before then. Each failure in a row doubles the wait, up to two hours
(`failedBatchPauseMs`). One whose process died frees its lease after
sixteen minutes for the same reason. Six failed batches in a row
(`failures`), about six hours of them, stop the reading, since the cause is
not passing (a revoked grant, say); Settings says it stopped after repeated
errors and offers Continue. A delivery that comes
while a lease holds is kept, not dropped, even if the reading was stopped
meanwhile, so a Continue that joins a dead worker's reading has a delivery
to carry it on; one for a stopped reading with no lease is dropped. Stop (`POST /gmail/backfill/stop`) clears `running`: the batch
under way saves its place and queues nothing. Pressing Import while a batch
reads joins that reading instead of starting another. A batch in which
emails failed to import (the model may be down) goes on all the same,
without anyone pressing Continue, but holds the next batch off five
minutes, doubling while batch after batch has failures, up to an hour
(`slowed`, `slowedPauseMs`); a batch without one ends the slowdown. The
failed emails' ids are kept with the place (`failedIds`, up to 1,000), and
once the mailbox has been read through they are tried again by id
(`retrying`, the ones still to try) before the reading is done; each that
works no longer counts as failed. Settings says what happens to them ("6
emails couldn't be read yet; they're tried again at the end", then "Trying
6 emails that failed again…") and, once done, how many failed both times,
which Read again from the start tries once more. "Refresh from email"
still pauses after a batch with failures (`lastFailed`), with Continue. "Delete all trips" removes the
progress and moves the reset generation on, so the batch under way cannot
save and every queued message is dropped. If queueing the first batch
fails, the reading stops, and a reading with no batch saved or reading for
half an hour past any pause it set itself (`retryAfter`; dead-lettered, say)
shows as stopped, so Settings offers to
continue it. A finished reading can start over, and starting over tries
failed emails again. The parser logs each start, batch, stop and end, and
each failure with the run and step.

Gmail watches expire after seven days; `/internal/renew-watches`, called
daily by Cloud Scheduler, renews those within two days of expiry. A history
id that has aged out logs a warning and resets to the notification's id; the
user can run a backfill to fill any gap.

## Calendar export

Settings, on the web and Android, offers a link that Google Calendar,
Apple Calendar or Outlook subscribes to (copied, added to Google Calendar,
opened in a calendar app, replaced or turned off there; `exportLinks`): an iCalendar feed (`packages/core/src/calendarExport.ts`) of
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
with the link sees the trips, which Settings says. Once the owner may no
longer use the app ("Access"), the link answers 404 as an unknown one
does, without saying why; it serves again if they are let back in. If
whether they may cannot be told, it answers 503, and the calendar app asks
again later. Responses are
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

The mailbox reading's push subscription (`gmail-backfill-parser`) works the
same way, with ten attempts, a ten-minute acknowledgement deadline (a batch
runs for up to five minutes), and the same dead-letter topic; each failed
attempt is logged as `backfill_batch_failed`. Only errors fail a delivery
(a batch that must wait hands on to a fresh message instead), so a batch
dead-letters only after ten errors in a row. That stalls the reading, which
Settings then offers to continue.

Two alerting policies (`deploy/monitoring.sh`, `deploy/alerts/`) page the
operator: a `renew_watch_failed` log line, meaning a user's imports will stop
when their watch expires, and a message on the dead-letter subscription,
either a Gmail notification (`emailAddress` and `historyId`, from
`gmail-parser`) or a batch of a mailbox reading (`uid`, `run` and `step`,
from `gmail-backfill-parser`).

### Connected Fastmail

A Fastmail mailbox is read as Gmail is, new mail and the whole history,
over JMAP (RFC 8620, 8621; `apps/parser/src/jmap.ts`). Fastmail gives
third-party apps no OAuth for mail, so the user makes an API token in
Fastmail's settings (Privacy & Security → Manage API tokens), read-only
with Email access, and pastes it into Settings; one Fastmail mailbox can be
connected beside the Gmail ones. `POST /fastmail/connect` reads the
token's JMAP session and refuses a token that can change mail (the
account's `isReadOnly`), one without mail access, or one Fastmail does not
take, then keeps it server-side (`users/{uid}/private/fastmail`) with the
mailbox's current state; the user document shows only the address and the
backfill progress. The token goes only to Fastmail's session URL and the
API URL that session names, which must be on fastmail.com. Disconnecting
stops any reading and deletes the token; Fastmail has no API to revoke it,
so Settings asks the user to delete it there.

New mail: Cloud Scheduler calls `/internal/poll-mail` every five
minutes, which for each approved user asks `Email/changes` what was created
since the stored state, keeps what is in the inbox (Gmail's watch covers
only the inbox too), and imports it as pushed Gmail mail is, with
`source: "fastmail"`. The state moves on only once that is done and the
user's trips were not reset meanwhile, so a failed or superseded poll is
read again by the next. A state the server can no longer calculate changes
from skips to now; the backfill finds what was missed. One user's failure
(a token deleted in Fastmail, say) is logged and the rest carry on.

Past mail: the backfill chain (`backfillChain.ts`) is the same for every
mailbox; a Fastmail batch's Pub/Sub message says so (`provider:
"fastmail"`, where a Gmail one names its mailbox by key), and the progress
is kept on that connection. All read
through `MailSource` (`mailSource.ts`): a page of the booking-like search
(`backfill.ts`'s subjects and statements, as a JMAP filter over mail in neither trash
nor junk (even with another label), newest first, each page anchored on the last email of the one
before so mail arriving meanwhile shifts nothing; a deleted anchor starts
the reading over, its claims skipping what was read), and one email by id
(`Email/get` with the text and HTML body values and the attachments'
blob ids, reduced as Gmail's are; its PDFs are downloaded from the
session's `downloadUrl`, on Fastmail's own hosts only, when the email is read). Record ids are `fm-<email id>`, kept apart from
Gmail's; "import anyway" routes them to Fastmail. A Fastmail booking links
to no message, as there is no stable URL for one; its sender is learnable
as any email's. Deleting all trips forgets every mailbox's reading
position.

Settings on the web and Android has a Fastmail section under Gmail: a
link to make the token, a password field for it, and once connected, the
same Import past bookings controls and Disconnect, with a reminder to
delete the token in Fastmail. The token is not kept in Android's saved
screen state.

### Connected IMAP mailboxes

Any other mailbox (iCloud, Yahoo, Infomaniak and the like, whose providers
offer apps like this one no OAuth for mail) is read over IMAP with an app
password the user makes with their provider (iCloud requires two-factor
authentication for one), through `MailSource` as Gmail's and Fastmail's
are (`apps/parser/src/imap.ts`, on the `imapflow` library). Like Gmail, an
account may connect up to five (`maxImapMailboxes` in
`packages/core/src/imap.ts`, mirrored in Android's `Imap.kt`), each in
`users/{uid}/private/imap-<key>` with its entry in the user document's
`imaps`; as with Fastmail, two users may connect the same mailbox, and a
connected IMAP address does not count as a confirmed one.

Connecting: `POST /imap/connect` takes the address, the app password and,
for a provider Travelmo does not know, the server (`host` or
`host:port`, 993 by default). Known providers' servers are filled in by
the address's domain: iCloud (`icloud.com`, `me.com`, `mac.com`:
`imap.mail.me.com`), Yahoo (`yahoo.*`, `ymail.com`, `rocketmail.com`:
`imap.mail.yahoo.com`), Infomaniak (`ik.me`, `ikmail.com`, `etik.com`:
`mail.infomaniak.com`), all on 993; the username is the address. A Gmail
or Fastmail address is refused with a pointer to its own section. The
parser connects with implicit TLS only, whatever the port (no STARTTLS,
no plaintext), certificates checked, only to public addresses (checked
where the connection is made, as calendar feeds are), signs in, opens the
inbox read-only (EXAMINE), and only then stores the password, sealed,
with the inbox's UIDVALIDITY and last UID as where new mail starts.
Nothing the parser does can change a mailbox: its client type
has no command that writes, flags or sends. Connecting a mailbox again
takes the new password and keeps its place and reading. Disconnecting
stops any reading and deletes the password; deleting the app password with
the provider revokes it.

New mail: the five-minute job (`/internal/poll-mail`, which the
`poll-fastmail` scheduler job calls; `/internal/poll-fastmail` still
answers) polls Fastmail and then each IMAP mailbox of each approved user
over one connection: the UIDs above the last one read are imported, oldest
first, up to 200 a poll, with `source: "imap"`, and the place moves on as
Fastmail's does (`newMailPoll.ts`, shared). A changed UIDVALIDITY means
the old UIDs name nothing, so reading starts from now (logged
`imap_uidvalidity_changed`); the backfill finds what was missed.

A refused password is logged as `imap_login_failed` (by mailbox key and
server, never the password) and recorded as `loginFailedAt`, which
Settings shows ("The server turned down the app password. Connect again
with a new one."); the poll and backfill batches leave that mailbox alone
for an hour (`imapLoginBackoffMs`) so the provider does not lock the
account after a stream of failed logins, while reads the user asks for
("Import anyway") still try. The next login that works clears it.

Past mail: the shared backfill chain, its Pub/Sub message `provider:
"imap"` with the mailbox's key. The search is IMAP SEARCH over the inbox
alone: any of `backfill.ts`'s subjects (IMAP matches substrings, so a
little more than Gmail's word search), or a statement-like subject in the
last 60 days (not narrowed to travel programs' senders, as one SEARCH
cannot AND two ORs without repeating one per term; the pre-filter does
it). Only the inbox is searched: other folders' UIDs would need their
own ids and cursor, and Trash and Junk are left out without knowing
each provider's names for them. Pages go down by UID, newest first, 300
at a time, the cursor `<uidvalidity>:<lowest uid read>`; a cursor whose
UIDVALIDITY is no longer current starts the reading over, claims skipping
what was read. Each message is downloaded whole up to 16 MB (a message cut
off there keeps its text but not its PDFs) and reduced as a forwarded one is
(`inbound.ts`'s `parseInbound`). "Import anyway" routes `imap-` ids to
their mailbox by key; "Delete all trips" forgets every IMAP mailbox's
reading position; deleting the account removes every IMAP connection with
the rest of `users/{uid}`.

Settings on the web and Android has "Other email (IMAP)" under Fastmail:
each connected mailbox as a Gmail one is shown (address, Import past
bookings, Disconnect, progress, and a refused password), then the
address, the app password (a password field, not kept in Android's saved
screen state), the server only for an unknown provider, one line on app
passwords with links to iCloud's and Yahoo's instructions, and Connect.
Sources read "Other email" and do not link.

## Connecting Gmail

### Several mailboxes

An account may connect up to five Gmail mailboxes (`maxGmailMailboxes` in
`packages/core/src/gmail.ts`, mirrored in Android's `Gmail.kt`), say a
personal and a work one. Each has its own refresh token, watch, history
cursor, reading of past emails ("Import past bookings") and Disconnect; a
notification names its mailbox (`emailAddress`), which `gmailAccounts`
maps to its one owner. Connecting a mailbox already connected replaces its
token; a sixth is refused ("You can connect up to 5 Gmail accounts.
Disconnect one first."), its new token released.

Gmail's message ids are unique only within a mailbox, so the emails of
every mailbox but the account's first are recorded (import record ids,
source ids, `gmailMessageIds`, segment ids) as `gmail-<key>-<message id>`
(`gmailIdPrefix`, the connection's `idPrefix`), which no bare Gmail id (all
hexadecimal) can equal. The first mailbox the account ever connected
(`private/gmailIds`'s `first`) keeps the bare ids it always had, so
connecting it again after a disconnect finds its emails as read. Imports
from every mailbox file into the same trips and dedupe as before: one
booking confirmed in two mailboxes is one booking with both sources. A
source opens in the mailbox its id names (`gmailSourceLink`), or the bare
id's first mailbox; once that mailbox is disconnected, in the browser's
or phone's default account. "Import anyway" in the review list reads the
email again from the mailbox its record names.

Requests from Settings name the mailbox (`emailAddress`); one that names
none, from a client from before, means the only one, and is refused while
there are several.

Mailboxes connected before there could be several move on their own, with
no manual step: as the parser starts (in the background, since every
reader reads both places meanwhile), and whenever a user's mailboxes are
loaded, `private/gmail` moves to `private/gmail-<key>` with `idPrefix` empty
(its emails keep their ids), `first` and `mailboxes` are recorded, and the
user document gains the `gmails` entry. Its `gmail` is left in place,
frozen, until that mailbox is disconnected, so the rules (deployed after
the parser) and apps from before keep counting and showing it; apps
prefer the `gmails` entry. A later change can drop the reading of `gmail`.

Google returns the browser to the parser with no Travelmo credentials, so the
callback alone cannot know who is completing the flow. The parser parks the
tokens under a one-time code and sends the browser to the web app, which, as
the signed-in user, redeems the code; the parser accepts only when that user
started the flow. A link forwarded to someone else therefore cannot attach
their mailbox to the sender's account. A mailbox connected to one user is
refused to any other until the first disconnects.

Settings on the web and Android lists each connected mailbox, oldest
first, worded by `backfillText.ts` and its Kotlin twin: the address, Import
past bookings (Continue, or Read again from the start once done), Stop
while it reads, Disconnect, and how far its reading got; then "Connect
another Gmail account", or, at five, that one must be disconnected first.
Android's Connect Gmail opens Google's consent page in the
phone's browser, and the flow finishes there on the web as above, so the
browser must be signed in to Travelmo as the same user.

## Bug reports

Report a bug sends a report to the maintainer from inside the apps, by
email, never anywhere public. On the web it is a link at the foot of every
page for an account that may use the app; on Android, the ⋮ menu's item,
signed in with a parser (signed out, or without one, it shares through the
share sheet as before, "Android app"). The dialog asks "What went wrong?"
(required on the web, which has no debug log; optional on Android) and
says, before Send, what the maintainer will see, in one sentence: on a
trip's page (the web's trip page; Android's trip screen and the booking
form under it) "We'll see this trip's bookings, including addresses,
confirmation numbers and names, plus" the page's address and the browser
(web) or the app's log and a screenshot of this screen (Android), "We use
them only to fix the problem."; elsewhere the same without the bookings.
The choice is Send or Cancel (Android adds Share instead, the share sheet
as before). Sending shows "Sending…", then "Sent. We'll reply by email."
or "Couldn't send the report." with the reason (`bugReportFailure`).

`POST /reports` takes `{text, log?, screenshot? (base64 PNG), page?, app
("web" | "android"), version?, userAgent? (web), trip? {id, title,
bookings[]}}` for an approved account (`requireUser`), checked by
`packages/core`'s `checkBugReport` (zod): 400 for the wrong shape, an empty
report or a screenshot that isn't a PNG; 413 past 5,000 characters typed,
200,000 of log, a 2 MB screenshot, 100 bookings or 200,000 characters of
trip JSON (and a request past about 3.7 MB). The bookings are the trip
page's as stored, each place in full (name, address, city, country, code,
spot), never another trip's. The web sends the build time as its version
and the browser's user agent; Android its version name and code, the
debug report's text and a screenshot of the window, halved until it fits
or left out. Each account may send five a day (UTC; 429 beyond), counted
in `users/{uid}/private/bugReportBudget` in the same transaction that
copies the report to `bugReports/{id}` (reads first; refused for a deleted
account). Then `apps/parser/src/bugReports.ts` emails it to `BUG_REPORT_TO`
through the reminders' SMTP: subject "Travelmo bug report from <the
reporter's verified sign-in address>" (else the account's uid), Reply-To
that address, a body of what they wrote, the page, the app and version, the
browser, the account and the report's id, then every booking as readable
lines (each place as "Destination: name, address · city, country · code ·
lat,lon"), then the log; the screenshot (`screenshot.png`) and the bookings
(`trip.json`) as attachments. A mail that fails answers 502 and keeps the
copy, logged by its id. 503 without SMTP or `BUG_REPORT_TO`. Logs carry
ids and sizes only, never what was written, the log or the bookings. The
copies go when the account is deleted ("Deleting an account").

## Deleting an account

Settings on the web and in the Android app ends with "Delete account" (on
the web, so does the invite-only page an account without access sees): one
sentence on what goes, a confirmation (in the page on the web, a dialog on
Android), then `POST /account/delete` to the parser, which does the work
with the Admin SDK (`apps/parser/src/account.ts`), since the rules let no
client touch other people's records of the user or the sign-in. For the
caller's uid, in this order:

0. A marker, `deletedAccounts/{uid}` (`uid` and when; Firebase never
   reuses a uid), kept for good. Every server write that could recreate
   the user's data reads it in its transaction and refuses once it exists
   (`apps/parser/src/deleted.ts`): an import's claim, record, trip filing
   and similarity examples, a Google consent's parking or connection
   (whose new token is revoked instead), a forwarding address, a
   calendar link, a TripIt profile, a calendar feed, an upload lease, a
   sign-in's OAuth state, and background bookkeeping (calendar event
   aliases, reminder logs and markers, geocode retries, the forwarding budget,
   a bug report and its daily count); a
   disconnect touches the user document only while it exists. Writes that only change a document that must already exist
   need no check: deletion removed it. Every user endpoint but `/account/delete` answers 410
   for the account from then on. The rules refuse every client create
   and update from the account too, since a sign-in token stays valid for up
   to an hour after deletion (deletes stay allowed). So nothing already under
   way, on the server or another device, recreates data behind the steps
   below; what committed before the marker is found by them.
1. Connections, while their tokens are still stored: every mailbox's Gmail
   watch is stopped, then every Gmail and the Calendar refresh token and any consent
   parked in `pendingConnections` are revoked (all of them, unlike a single
   disconnect, which keeps a grant another connection rests on), and every
   connection is removed. A failure to stop or revoke is logged and
   deletion goes on: Google may already have withdrawn the grant.
2. Lookups that name the user outside their own documents: `gmailAccounts`,
   `forwardAddresses` (the forwarding address bounces from then on),
   `calendarExports` (the export link stops working), `pendingConnections`,
   `oauthStates`, `geocodeRetries`, `checklistReminders` and `bugReports`, each by its
   `uid` field; and their uid comes off the `sent` list of
   `checkInReminders`.
3. Every trip they own: marked `deleting` first, as a trip deletion is, so
   no edit adds to it meanwhile, then its segments, and the trip document
   only once they are all gone, so a failure leaves the trip for a retry to
   find (`recursiveDelete` on the trip would delete it regardless). Looked
   for again until none is left.
4. Their verified email (from the ID token, so a retry after the sign-in is
   gone still finds it) comes off `sharedWith` on trips others shared with
   them and off `trustedEmails` on profiles others trusted them with, and
   their access record (`access/{email}`) goes. Those
   trips keep every booking, including ones the deleted user added: they
   belong to the trip.
5. `users/{uid}` and every subcollection under it, whatever it holds,
   including a Fastmail API token (Fastmail cannot revoke one from outside)
   and reminders before trips and what they ticked off.
6. The Firebase Auth user, last, so the user can retry until everything
   else is gone; one already deleted counts as done.

Every step works from what is still stored, so calling it again after an
interruption finishes the job. Writes are batched in pages of 200 (and
`recursiveDelete` for a trip's segments or the user tree). The parser logs the start,
the end with counts, and a failure with the step it stopped at, by uid
only. Afterwards the web app signs out, clears this browser's Firestore
cache, and says the account was deleted; the Android app signs out and its
sign-in screen says the same. Android builds call the parser at the
address given at build time (`travelmoParserUrl`, README "Android"); a
build without one points to the web instead.

A deletion can stop part way and leave the sign-in (the Auth user once
failed to delete, before the parser could). The parser's 410 for a deleted
account then says "Deleting your account didn't finish." once the marker
is over 15 minutes old (a deletion runs in one request, which Cloud Run
ends well before then) and the Auth user still exists; otherwise "This
account was deleted". On that answer, to any request (on Android, the
access check each launch makes), both apps show "Deleting your account
didn't finish" in place of every page, with "Finish deleting", which calls
`POST /account/delete` again without asking a second time, and Sign out.

## HTTP surface of the parser

| Route | Auth | Purpose |
|---|---|---|
| `POST /gmail/connect` | Firebase ID token | Returns the Google OAuth URL; stores a nonce for 10 minutes |
| `GET /gmail/callback` | OAuth state | Exchanges the code, parks the refresh token under a one-time completion token, redirects to `/settings?gmail=pending&state=…` |
| `POST /gmail/complete` | Firebase ID token | Redeems the completion token; refuses (and revokes) if the caller is not the user who started the flow, the mailbox belongs to another user, or five others are connected; starts the watch and stores the connection beside any others |
| `POST /gmail/backfill` | Firebase ID token | Starts reading the past emails of the mailbox `emailAddress` names on the server (`restart: true` from the beginning) and returns its progress at once; 409 when starting over while a batch reads |
| `POST /gmail/backfill/stop` | Firebase ID token | Stops that mailbox's reading after the batch under way |
| `POST /gmail/reimport` | Firebase ID token | Imports one message again from the mailbox its record id names, skipping the pre-filter; returns its outcome |
| `POST /gmail/disconnect` | Firebase ID token | Stops the watch of the mailbox `emailAddress` names, revokes its token (unless another connection rests on the grant), deletes its connection |
| `POST /imap/connect` | Firebase ID token | Signs in to an IMAP mailbox with an app password (`emailAddress`, `password`, `server` for an unknown provider), implicit TLS only, opens the inbox read-only, and stores the sealed password; 400 for a refused login, an unreachable server or a Gmail or Fastmail address, 409 past five |
| `POST /imap/disconnect` | Firebase ID token | Stops that mailbox's reading and deletes its password |
| `POST /imap/backfill` | Firebase ID token | As `/gmail/backfill`, for the IMAP mailbox `emailAddress` names |
| `POST /imap/backfill/stop` | Firebase ID token | Stops that mailbox's reading after the batch under way |
| `POST /trips/regroup` | Firebase ID token | Fills in bookings' countries and spots from the airport and city tables, then rebuilds the user's trips from their bookings with the current grouping ("Home"); returns how many trips changed, how many were merged away and how many bookings were placed |
| `POST /trips/refresh` | Firebase ID token | Starts "Refresh from email" on the server (`restart: true` from the first email again) and returns its progress at once; 409 when no mailbox is connected or a batch is still reading |
| `POST /trips/refresh/stop` | Firebase ID token | Stops the refresh after the batch under way |
| `POST /trips/delete-all` | Firebase ID token | Deletes every trip the user owns with its bookings, their import records, places waiting for a geocode on those bookings, and how far the last mailbox reading got; returns how many trips went. Trips shared with them, their profile and connections stay |
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
| `POST /internal/backfill` | OIDC from `INTERNAL_CALLERS` | Pub/Sub push target for the next batch of a mailbox reading or a "Refresh from email" |
| `POST /internal/poll-mail` | OIDC from `INTERNAL_CALLERS` | Cloud Scheduler target, every five minutes: new mail in Fastmail and IMAP mailboxes (`/internal/poll-fastmail` is the same) |
| `POST /internal/renew-watches` | OIDC from `INTERNAL_CALLERS` | Cloud Scheduler target |
| `POST /internal/flight-status` | OIDC from `INTERNAL_CALLERS` | Cloud Scheduler target, every minute: sends the check-in reminders due ("Check-in reminders"), then looks at the flights due a look and sends their news ("Live flight status"); `{enabled: false}` without `AEROAPI_KEY`, though check-in reminders still go |
| `POST /flights/refresh` | Firebase ID token | Looks at the flights of a trip the caller can see (`tripId`) that are due a refresh; 404 for a trip they cannot see |
| `POST /forward/issue` | Firebase ID token | Issues the user's forwarding address, retiring any old one; returns it; 503 without `FORWARD_DOMAIN` |
| `POST /forward/stop` | Firebase ID token | Retires the user's forwarding address |
| `POST /inbound/cloudflare` | Bearer `INBOUND_SECRET` | The Email Worker's relay of one message (raw MIME, up to 16 MB, `X-Envelope-To`); 204 accepted, 404 no such address, 429 over the day's limit, 413 too large, 503 the model could not read it (the sender's server retries) |
| `POST /export/calendar` | Firebase ID token | Issues the user's calendar export link, retiring any old one; returns its token |
| `POST /export/calendar/stop` | Firebase ID token | Turns the calendar export link off |
| `GET /cal/{token}.ics` | the token | The calendar export itself, for calendar apps; 404 for a link not in use or whose owner may no longer use the app |
| `POST /account/delete` | Firebase ID token | Deletes the caller's account and everything they own ("Deleting an account"); 204, and a retry finishes an interrupted run |
| `POST /emails/add` | Firebase ID token, approved or waiting | Mails a confirmation link for `email` ("Linked email addresses"); returns `{email}`; a refusal answers `{refusal}` (400 invalid, yours or full; 403 notInvited, for an account not approved yet; 409 taken; 429 the day's links spent); 503 without SMTP |
| `POST /emails/confirm` | Firebase ID token, approved or waiting | Links the address a link (`token`) was sent to, for the account that asked; returns `{email}`; 410 `{refusal: "expired"}` for a link unknown, used, expired or another account's; 403 notInvited, for an account not approved yet whose address no longer lets it in; 409 taken |
| `POST /emails/remove` | Firebase ID token | Unlinks `email` or withdraws its pending link |
| `POST /reports` | Firebase ID token | Emails a bug report to `BUG_REPORT_TO` and keeps a copy without its log, screenshot or bookings ("Bug reports"); returns `{id}`; 400 malformed or empty, 413 too large, 429 past five a day, 502 the email failed (the copy stays), 503 without SMTP or `BUG_REPORT_TO` |
| `POST /access/check` | Firebase ID token, approved or not | Settles the caller's access ("Access"): lets in an account from before approvals or one already shared with, otherwise tells the admins of a waiting request once; returns `{status}` (approved, requested, declined, none) |
| `GET /healthz` | none | Liveness |

## Costs

Firebase Auth, Pub/Sub, Secret Manager and the Gmail API are free at this
scale. App Hosting and Cloud Run bill per request and idle at zero; a
mailbox reading that waits out a failed batch holds a request open for a
minute at a time, about fifteen minutes of instance time, a small fraction
of a cent. Firestore
is the term that grows: one listener per trip list and per open trip, one
read of every booking each time the reports page opens, and one read of the
last year's trips and bookings each time a subscribed calendar refreshes (a
few times a day per subscriber). Checking approval ("Access") reads up to
three more documents (the user document, the access record, the admins'
list) wherever the rules or the parser decide, which Firestore bills as
reads: a few per page opened or write made, and per background import. Gemini
Flash-Lite costs a fraction of a cent per booking email, and an embedding
of a few hundred tokens a hundredth of that; a hundred users importing
fifty bookings a month is a few dollars. Bringing stored loyalty numbers up to a new way of reading them
(`foundLoyaltyRevision`) costs Firestore reads, plus one such model call per
email that still needs reading again, once. "Refresh from email" costs one
model call per email that made bookings (a user with five hundred such
emails spends well under a dollar, and nothing for an email whose mailbox
is gone), 60 Gmail units per email fetched (paced at 4,000 a minute,
about 66 emails a minute, within each user's 6,000), one read of the
user's bookings per batch and the trips around each email. Geocoding is one call per place
name Travelmo has not seen before (a 20-year export needs a few hundred:
about 240 for countries and 170 more for spots alone, which the daily cap
spreads over two days), free up to the Geocoding API's monthly allowance and
about half a cent a call past it, and `GEOCODE_DAILY_LIMIT` bounds the worst
day. Address
autocomplete in the form is billed to the user's browser key per lookup
session, free up to the Places API's monthly allowance; a hand-entered
booking is a rare thing beside imports. Reminders by email and bug
reports (at most five a user a day) ride the operator's SMTP service, by push the browsers' own push services and
Firebase Cloud Messaging for phones (free), which
are free; the daily job is the fourth Cloud Scheduler job, about ten cents
a month. Live flight status is about 200 AeroAPI queries a flight at
about half a US cent each (roughly $1 a flight, more for a long delay),
shared by everyone on it; AeroAPI's Personal tier has no monthly minimum
and its first $5 a month free, and covers personal and household use only
(Standard, for anything wider, is $100 a month). Its Cloud Scheduler job
runs every minute, still about ten cents a month, and each run is one
small Firestore query. Check-in reminders add a second query to each run,
reading the flight bookings leaving within about three days (two days
plus the widest offsets) and a marker for each whose check-in is open, and
a sweep query, usually empty (billed as one read each): about 3,000 reads
a day with no flights near, and a few thousand more a day per flight in
the two days before it leaves, within Firestore's free daily allowance
(50,000) for a household, growing with the flights booked across all
users (past it, about six cents per 100,000 reads). Forwarding addresses ride Cloudflare Email Routing (free, unlimited
inbound) and one Email Worker (free plan: 100,000 requests a day), with
the model cost of a Gmail import per forwarded email. Cloud KMS costs about $0.06 a month per key version (four
a year with rotation, all kept) and about $0.03 per 10,000 calls: one
decryption per Gmail notification, Fastmail poll, Calendar read and batch
of a mailbox reading, one encryption per connection. An IMAP mailbox is
polled as often as a Fastmail one and costs the same. IMAP itself costs
nothing beyond Cloud Run time: a poll is a few seconds of a connection per
mailbox. A Fastmail mailbox,
polled every five minutes, is about 8,600 decryptions a month, under three
cents; a Gmail mailbox's follow its mail; a hundred users is a dollar or
two a month. The rules tests and CI run
on GitHub-hosted runners; CI's deploys of the parser build on Cloud Build
within its monthly free build-minutes.

## Android app

`apps/android` is a native Kotlin and Compose app, built the way the other
Android apps in this account are (AGP and Kotlin at the same versions, a
pure-Kotlin `:core` guarded by `verifyNoAndroid`, JUnit 5 with Kotest
assertions, the commit count as `versionCode`, Firebase dormant until
`google-services.json` is dropped in) rather than the React Native port once
pencilled in; `design/android/` is its reference, Material 3 in this palette,
and the strings follow the web app exactly. The "Travelmo" wordmark (the trip
list's app bar, the sign-in screen, the web's header and sign-in card) is Fira
Sans Medium, bundled under the SIL Open Font License; all other text keeps the
system font on Android and Geist on the web. On the web the app icon
(`components/Logo.tsx`, inline, in step with `app/icon.svg`) stands beside it in
the header and above it on the sign-in card. The header links Trips (the
trip list), Calendar, Reports, Profile and Settings, in the Android bar's
order; Sign out is at the foot of Settings. It reads the same Firestore
documents under the same rules, signed in as the same Google account through
Credential Manager and Firebase Auth, so a trip looks the same on both and
Firestore's own cache answers offline. `:core` re-implements, in Kotlin, what
the screens need of `packages/core` (grouping, the next event, the status
lines, date formatting); the two are kept in step by hand, with tests that
mirror each other. `:core` is Kotlin Multiplatform: the same code and the
same tests build for the JVM (the Android app) and for iOS ("iOS app"), so
it uses kotlinx-datetime rather than `java.time`, writes en-GB's month and
day names itself rather than asking a platform, and has the airport tables
and the world map compiled in as strings, iOS having no class-path
resources; only the list of countries and their names in a language come
from the platform (`java.util.Locale`, `NSLocale`). The first cut is the sign-in, the trip list with its
status lines, a read-only trip page and sign-out; Settings also turns
reminders by email on or off (`reminders.email`, as the web's does) and
reminders as notifications on the phone (the phone's Cloud Messaging token
under `users/{uid}/devices`, see "Document reminders"), keeps
the on-device debug log (the fleet's shared `androidlog`: logcat and a
rotated file, a privacy floor over every line, a switch to stop recording
and a report shared through the share sheet, also offered on the sign-in
screen when Google refuses a sign-in or it fails, since Settings is behind
sign-in; after a crash in an earlier run, a banner at the top of the trip
list, or of the sign-in screen when signed out, offers that report (without
a screenshot: the crash was in an earlier run) or Dismiss, and comes down
when the report's clipboard copy lands or on Dismiss, the crashed run
staying on the phone; every screen's top bar, and the sign-in screen's corner, ends
with the same ⋮ menu, as in the sibling apps: Report a bug, signed in
with a parser, sends that report with a screenshot of the screen it was
opened from (and on a trip's screens the trip's bookings) to the
maintainer ("Bug reports"), with Share instead for the share sheet;
signed out, or without a parser, it shares that report with the
screenshot, after a dialog
that says what goes (the log, never bookings or addresses, and a
screenshot that can show trips and names) and where (the clipboard and an
app the user picks), with Continue, Cancel and "Don't show again" (kept
on the phone), as in the sibling apps; the screenshot is served to the
chosen app alone through the app's FileProvider (the screenshot is an
extra: the text is the whole report, and a capture that fails shares the
text alone; Settings' and the sign-in screen's "Share the debug log" send
the text alone, as the screen they show is not the one the bug is on),
and About names the version and opens the open-source licenses:
every component the release APK bundles, Fira Sans included, by name, each
tapping through to its version, authors and a link to its license text,
from an export committed with the app so the list needs no network) and
deletes the account
through the parser ("Deleting an account"), the app's one call to it,
while the import settings stay on the web; a navigation bar switches between Trips,
the Calendar (the month view of `/calendar`, with the same weeks, bars and
lanes from `:core`), Reports and Profile. Reports counts what `/reports`
does, from `:core`'s port of the same logic with the same tests: the trips
begun, days away and days in each country, on the web's world map
(`worldMap.json` read as a resource, spots placed by the same Equal Earth
projection) with visited countries filled and airports and placed bookings
marked; the rated and favorite places, each trip opening; residence and
visa days, counted to today; trips per year,
a row or the year picker narrowing the rest to a year. Bookings are added, edited and
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
profiles shared with the viewer, and shares it as the web does), and the
same document warnings as the web stand in one card at the top of the trip
list and on trip pages, from the same logic in `:core` with the
airport-country table read as a resource; as on the web, an upcoming card is
its title and dates; a booking row carries the viewer's matching loyalty
programs. A booking's ⋮ menu, for anyone who sees the trip, starts with
"Copy reference" (when it has one) and "Sources" (when it has sources or a
sender), then Edit, Move to and Delete for those who may edit, as on the web. Copy
reference puts the reference alone on the clipboard, with no toast since
Android (13 and later, all the app runs on) confirms a copy itself; a long
press on the reference line does the same (TalkBack offers it as the
long-click action). Sources opens a dialog listing them as the web's does (each source's label and kind, then "From" the sender), the same
`segmentSources` in `:core`; an email the viewer imported, by the source's
`uid` or as the trip's owner for one without, opens in Gmail. The Gmail
app takes no link to a message, and a browser sends one to Gmail's
mobile site, which drops the message id; so with the Gmail app installed
the tap puts a search for the email on the clipboard (`sourceSearch`:
`subject:"…"`; `from:` the booking's sender only when this is its one
email, as a merged booking keeps the first email's sender; and
`after:`/`before:` the days around when it was sent, when that is known;
a forward, `Fwd: …`, by its subject alone, as it keeps its original's
sender and date),
says "Search copied. Paste it in Gmail's
search." and opens Gmail. Without the app it opens the message's link, in
the Gmail mailbox it came from (`gmailSourceLink`, as the web's links),
else the phone's default account. On the web the link opens the message
in Gmail; on a touch screen the tap also copies the same search and says
so, for Gmail's mobile site. CI builds it beside the web app
(`ci / android`). An account not approved sees the web's invite-only page in place of
the app, and admins have the Access page, from the ⋮ menu or an "Access
request" notification ("Access").

When Google Play has a newer version, the ⋮ menu's icon carries a small red
dot and the menu ends with "Update available", last so the other items keep
their places, which opens the app's Play listing (the Play Store, else the
web); Play does the download and install, as in stopdash. The app asks Play
on each foreground, in the background (the Play In-App Update library, free),
in release builds only, since a debug build's `.debug` package isn't on
Play. A check that fails shows no dot and logs the exception's class only;
Play still updates the app on its own schedule. The check sends nothing of
the user's, only what Play already knows as the app's distributor (its
package and installed version), so the Play data safety answers are
unchanged.

### Light and dark

The app follows the phone's dark theme, with no setting of its own, and
switches as soon as the phone does; the status and navigation bars' icons
switch with it. Both palettes are fixed, not the wallpaper's dynamic colors,
and meet WCAG AA: text is at least 4.5:1 against what it sits on, and the
edges of text fields and switches 3:1. A trip being deleted keeps readable
text: its card is not faded, and its calendar bar is gray rather than a
faded color.

### Text size

The app's text can be made larger or smaller than the rest of the phone, as
in the sibling apps, through the fleet's shared `androidzoom` library. The
size is a factor on top of the system's font scale, not a replacement for
it, so an accessibility setting made in Android still holds; only text
grows, while paddings, icons and touch targets keep their layout. The range
is 80% to 160% and it starts at 100%, the phone's own size: there is no
dense board to protect, so travelmo skips stopdash's 105% default. Settings
has a "Text size" section showing the percentage, a slider that resizes the
app as it moves and saves on release, and a − and a + either side that move
it one whole percent of the shown percentage a tap, saved at once, each off
at its end of the range. A two-finger pinch anywhere in the app, dropdown
menus, dialogs and the date picker included, resizes the app live and saves
once when the fingers lift; it takes over only once the fingers have spread
past androidzoom's slop, so a two-finger scroll still scrolls, and a
"Pinch to resize" switch turns it off. A long press (only a booking's
reference line has one) ignores a gesture with two fingers down
(`longPressUnlessPinch`, after stopdash's `unlessPinch`), so a pinch can't
trigger it. A menu's popup inherits
the size and hosts the pinch itself; a dialog, a window of its own,
re-applies both (`AppAlertDialog`). The value is one number and one
boolean in a SharedPreferences file on the phone, not synced to Firestore
and nothing of the user's, read into memory off the main thread at startup
so the first frame is normally at the chosen size (a screen drawn before
the read lands resizes a frame later rather than waiting on the disk). A
save storage refuses stays in force until a restart, and Settings says it
wasn't saved.

### Back

A page opens over the one it was opened from (a trip, a booking's form,
Settings, the licenses) with a short slide, an eighth of the screen's width,
as it fades in, in a quarter of a second, and closes the same way in 200 ms,
as in stopdash: Navigation 3's 700 ms default fade felt like waiting. The back
gesture is predictive: swiping back draws the closing transition under the
finger, and letting go without going back settles the page where it was.

### Scroll cue

A scrolling screen marks its top or bottom edge while there is more to
scroll past that edge, and marks nothing where the content ends, so a list
that stops near the bottom of the screen doesn't read the same as one cut
off mid-content. The mark is a short fade into the background with an up or
down chevron on a gray plate centered over it, as in stopdash (whose code
this ports; no shared library carries it yet). A tap on the chevron scrolls
a page that way. Only the chevron's own 48dp target takes the tap; a drag
starting there still scrolls, the rest of the row stays the row's, and a
second finger or a pinch makes it no tap. Screen readers skip it, since
their users already scroll by gesture. It covers every scrolling screen:
the trip list, a trip's page, the calendar, Reports, Profile, Settings, the
booking form, Licenses and Sign in. Dialogs and menus are left as the
platform draws them.

## Later

Itinerary ideas and
other mail providers. Further import
sources share the pipeline, as Google Calendar and forward-to-import do;
`IMPORT.md` compares them and maps their fields.

## iOS app

Planned, and built the way the Android app is, sharing its Kotlin through
Kotlin Multiplatform rather than written again in Swift. So far
`apps/android/core` builds for iOS (`iosArm64`, `iosSimulatorArm64`) and
CI's `ios-core` job runs its tests on the iOS Simulator on a macOS runner;
Linux compiles the iOS targets but cannot run them. The screens' text is
in `apps/android/shared`, a Compose Multiplatform module both apps build
(`Res.string.*`), except what only Android shows outside the screens: the
launcher label, notification channels, toasts and the debug log's notes.
The data the screens read and the actions they take are interfaces in
`:shared` (`TripStore`, `TripActions`, the mailbox and calendar actions,
`PushDevice` and the rest), with the documents' readers and the no-op
versions beside them; Android implements them with Firestore, Cloud
Messaging and the parser (`FirestoreTrips`, `Parser*`), and iOS will
implement the same ones. Shared code logs through `SharedLog`, each value
marked safe or sensitive as androidlog asks, and the Android app records
those lines in its own debug log. The screens' view model,
`TripsViewModel`, is in `:shared` too, on the multiplatform lifecycle
library (androidx.lifecycle's own on Android), reading the time from a
`kotlin.time.Instant` clock. The palette and brand (`TravelmoPalette`, the
logo and the Fira Sans wordmark as Compose resources) and most screens are
in `:shared` too, the trip page, Reports, Access and Settings among
them; the sign-in and licenses screens stay each app's own; what only
an app can do reaches them through `AppChrome` (the ⋮ menu, the crash
report banner, opening a link, the clipboard, saving a file where the user
picks, the app's version, and Settings' device sections: reminders as
notifications, then the text size and the debug log), which Android supplies from its own menu, banner, Intents,
clipboard and file picker, and signing out through `SignedInAccount`,
Android's Google sign-in, and the text size the
Android user picks reaches menus and dialogs through `pinchFontSizeHost`
and `FontSizeWindow`, which do nothing on iOS. Navigation is shared too: the
pages as Navigation 3 keys and `SignedInNavigation`, the home tabs and
what each page opens; each app makes the back stack (Android's survives
the activity's recreation) and opens a trip a notification asks for.
Firestore is shared as well: `FirestoreTrips`, the `TripStore` both apps
use, is in `apps/android/firestore`, written against GitLive's Firebase
Kotlin SDK, which offers Google's own Firestore API on Android and iOS
alike and calls Google's Android and iOS SDKs underneath; writes go
through its `setData` and `updateData`, which map plain maps on every
platform. It is a module apart from `:shared` so that `:shared`'s tests
link no Firebase; it is compiled for iOS in CI, and Android's instrumented
tests run it against the Firestore emulator. Next: the iOS app itself
(Firebase Auth, Google sign-in and Sign in with Apple, which
App Store review asks of an app offering Google's, notifications through
Cloud Messaging), then a TestFlight build from CI.

Anyone can sign up from an iPhone, as on Android and the web. Sign in with
Apple may give Apple's private relay address rather than a real one; such
a user adds their real address under Settings' "Email addresses"
("Linked email addresses"), which then counts for sharing and access as
any linked address does.

Left to Android for now, as costly for a speculative app: the text size
and pinch to zoom (iOS has Dynamic Type), the debug log with its crash
banner and Report a bug, and the Play update check.
