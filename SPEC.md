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
  sender` (the booking email's domain). `source` is `gmail`, `manual`,
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
  {emailAddress, connectedAt, calendars[]}`. `gmail` and `googleCalendar` are
  server-written; `backfill` is how far a reading of the whole mailbox has
  got (`cursor, scanned, imported, failed, done, updatedAt`); each calendar
  is `{id, summary, primary, selected, lastReadAt, lastResult, lastError}`.
- `users/{uid}/settings/patterns` — `allow[], deny[]` sender domains.
- `users/{uid}/feeds/{feedId}` — `url, label, addedAt, lastFetchedAt,
  lastResult, lastError`: subscribed calendar feeds. The owner reads them;
  the parser alone writes them.
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
way and the next three upcoming ones also show what comes next — the soonest
booking start still ahead, or the end of one under way (check-out, arrival,
car return) — read from their segments with one listener each; past trips
and further-off ones get no listener, to keep Firestore reads in check.

## Editing by hand

The owner and anyone the trip is shared with can add, edit and delete
segments on a trip page; only the owner renames, shares or deletes the trip.
A manual segment carries `source: "manual"` and the same
shape as an imported one; the form takes a local date, time and time zone
for each end and stores the instant with that zone's offset on that date, so
it reads back exactly as the traveler sees it. Typing a known airport code
into From or To preselects that end's zone from a generated table of IATA
codes (`packages/core/src/airports.json`, from the OpenFlights airport
database, loaded on demand); the picker still has the last word. An
imported instant carries only an offset, so editing one offers that offset
"as imported" alongside the zones, and keeps it unless the editor picks a
zone. Fields the form does
not show (a place's city and country) survive an edit. A
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
upload counts it. A booking that
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
numbers a train, a room type a stay, a car type a rental, a cuisine a
restaurant booking, which becomes an activity), each flight or train leg is a
segment, and TripIt's DateTimes (date, time, IANA zone, offset) become our
instants directly. A stay with no times takes 15:00 and 11:00, anything else
noon; a DateTime with neither an offset nor a known zone is not guessed at.
Notes, empty trips, objects of no known kind and legs without a usable
date (even when the rest of their reservation imports) are listed as not
imported.
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
one that failed is tried again.

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
| `POST /import/tripit` | Firebase ID token | Imports a TripIt JSON export (up to 20 MB); returns counts of trips, bookings, duplicates, items imported before, failures and items not importable |
| `POST /internal/pubsub/gmail` | OIDC from `INTERNAL_CALLERS` | Pub/Sub push target |
| `POST /internal/renew-watches` | OIDC from `INTERNAL_CALLERS` | Cloud Scheduler target |
| `GET /healthz` | none | Liveness |

## Costs

Firebase Auth, Pub/Sub, Secret Manager and the Gmail API are free at this
scale. App Hosting and Cloud Run bill per request and idle at zero. Firestore
is the term that grows: one listener per trip list and per open trip. Gemini
Flash-Lite costs a fraction of a cent per booking email, and an embedding
of a few hundred tokens a hundredth of that; a hundred users importing
fifty bookings a month is a few dollars. The rules tests and CI run
on GitHub-hosted runners.

## Later

Native apps (React Native + Expo in `apps/mobile`; the Android screens are
mocked up in `design/android/`, Material 3 with this palette, as the reference
for the port), reports (days out of
country, trips last year — via BigQuery export if Firestore aggregates get
clumsy), country map, calendar view and export, check-in/out surfacing,
ratings and favourites, itinerary ideas, loyalty balances, passport expiry
and visa reminders, other mail providers and forward-to-import. Further import
sources share the pipeline: Google Calendar; `IMPORT.md` compares them and maps their fields.
