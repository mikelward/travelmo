# TODO

## Review and merge gates

- [x] Add the codex-review set (`codex-review.yml`,
      `codex-review-listener.yml`, `codex-review-check.yml`), copied
      byte for byte from mikelward/codex-review `templates/`.
- [x] A CI gate (`ci.yml`: typecheck, lint, tests including the rules
      tests, build).
- [ ] Repository settings (not expressible in files; see
      mikelward/codex-review `docs/CONSUMER.md`): a ruleset on `main`
      requiring the `codex` status, the
      `codex-review-check / codex-review-check` check (appears in the
      required-checks search only after its first run), `ci / check`,
      conversation resolution and up-to-date branches; enable the
      auto-merge setting.

## Product

- [x] Add and edit segments by hand; delete a trip; rename a trip.
- [x] Let sharees add, edit and delete segments.
- [x] Offer a timezone picker instead of a raw UTC offset when adding a
      booking by hand.
- [x] Preselect the time zone from the airport code typed into From/To.
      Station codes are not covered: no comparable open dataset.
- [x] "Fit dates to bookings" on a trip, offered when its bookings span
      less than its dates.
- [x] "Learn this sender" from a trip page and from an import review list
      in Settings, with "import anyway".
- [x] Embedding pre-filter: score candidate emails against bookings the
      user confirmed (the review list's decisions), between the keyword
      check and the model call.
- [x] Merge trips and move bookings between them.
- [x] Surface the next check-in, check-out, departure or arrival on the
      trip list for trips under way and the next three upcoming.
- [x] Say how soon that is, name the stay under way, and show when the next
      flight's online check-in opens and that it is open, with the booking
      reference, on the same card.
- [x] Dead-letter topic on the Pub/Sub push subscription and an alert on
      `renew_watch_failed`.
- [x] Service worker for offline trip pages (Serwist); `useOffline`.
- [x] End-to-end test: emulator-backed sign-in, seeded trips, share with
      a second user who adds a booking (Playwright).
- [x] Android mockups, round one: clickable Material 3 prototype of sign-in,
      trip list, trip detail, booking form and settings (`design/android/`).
- [ ] Deploy for real: run `deploy/pubsub.sh` and `deploy/monitoring.sh`,
      publish the OAuth consent screen (Gmail read scope: testing mode for
      up to 100 users, or Google verification), deploy the parser and the
      web app, then tune the pre-filter thresholds on real mail.
- [ ] Import sources beyond Gmail, one pipeline: generalize
      `importMessage` so any source hands over candidate text or a ready
      `ExtractedBooking` plus a stable source id for idempotency, and the
      same trip assignment and parsed-message record apply.
  - [x] Generalize the pipeline (`fileBooking`): duplicate check across
        sources, trip assignment, segment ids and the parsed-message record.
  - [x] TripIt JSON export: upload from Settings, dry-run summary in the
        browser, then import; TripIt's trips kept, unfiled items in a
        holding trip, `source: "tripit"`.
  - [x] Keep dropping duplicates (maintainer, 2026-11-02), but list every
        source of a booking on the trip page, emails linked to Gmail, so a
        false match or a missed detail is one click away.
  - [x] TripIt travelers, `LoyaltyPrograms` and `TravelerProfile` imported
        into a travel profile the owner can share with people they trust.
  - [x] `.ics` files: per-trip TripIt exports and calendar exports, read
        like email, `UID` as the source id, recurring and cancelled events
        skipped, 100 model reads per upload.
  - [x] `.ics` feeds: subscribe from Settings, read at once and daily
        (`deploy/scheduler.sh`), links fetched only from public addresses;
        a cancelled event removes its unedited, unmatched booking.
  - [x] A feed event whose details change after import (a new time) is read
        again, replacing its unedited, unmatched bookings.
  - [x] Google Calendar through the existing OAuth flow with
        `calendar.readonly` and a calendar picker.
  - [x] Backfill without the three-year cap, batched with a cursor, so a
        mailbox's whole history comes in.
  - [ ] Forward-to-import address for people without Gmail.
- [x] Duplicate matching no longer depends on item order: a TripIt export
      reserves existing bookings for the item whose confirmation number they
      carry, and a calendar upload reads changed events before new ones.
- [x] One-to-one matching holds across TripIt uploads too: one runs at a
      time per user (a lease in `users/{uid}/private/upload-tripit`), and a
      second gets a 409.
- [x] Reports: days in each country, trips per year, and a map of the
      countries visited and airports flown through (`/reports`).
- [x] Passport and visa reminders: a trip warns when a document in the
      travel profile expires before it ends, or a passport within six months
      after.
- [x] Calendar export: a subscribable .ics link for your trips (Settings).
- [x] Let the booking form set a place's country, optional and never asked
      for, so a booking the reports can't place can be fixed by hand.
- [x] Fill in a place's country at import when its source gave none:
      airports from the bundled table, everything else from Google's
      Geocoding API behind a shared cache and a daily cap.
- [x] Address autocomplete in the booking form (Places API (New) from the
      browser with a referrer-restricted key): a street start, a UK postcode
      or a US ZIP+4 offers places; picking one fills name, city, country and
      address.
- [x] Android mockups, round two: offline banner and page, interrupted
      deletion, loading and not-found states, a dark set, and the features
      built since round one (reports and map, travel profile, passport
      reminders, import and calendar settings, address suggestions) as
      screens matching the web app (`design/android/`, boards 15–29).
- [x] Places on the reports map: a stay, station or activity whose booking
      knows its coordinates (TripIt's, a geocoder answer, or an address pick
      in the form) is a dot, beside the airports and the filled countries.
- [x] Loyalty programs at a glance: a table of account, balance and status
      on the profile page, and a booking's matching program (number and
      status) under its provider on the trip page.
- [x] Calendar view: trips as bars on a month grid (`/calendar`), linking
      to the trip, with previous, next and today.
- [x] Entry requirements on a trip page: what each traveler's passport needs
      in each country of the trip, from the Passport Index dataset
      (`packages/core/scripts/visas.mjs`, rerun by hand to refresh).
- [x] Reminders by email: an opt-in in Settings and a daily job that mails
      the document and entry warnings for trips within a month, each once.
- [x] Reminders by web push: a switch per browser in Settings, the same
      news as notifications, one per trip, from the same daily job.
- [x] Ratings and favorites: one to five stars and a heart on a booking,
      and a "Favorite places" list on Reports linking back to the trips.
- [x] Android mockups, round three: the calendar as a fourth navigation
      destination, the loyalty table and booking line, and place dots on the
      map (`design/android/`, boards 30–31 and changes to 04, 21, 22, 26, 29).
- [x] Android app, first cut (`apps/android`): sign in with Google, the trip
      list with its status lines, a read-only trip page, sign out; CI job.
- [x] Android app: the navigation bar (Trips, Calendar) and the calendar's
      month view, from the same weeks, bars and lanes as the web.
- [x] Android app: every screen rendered to a PNG under Robolectric
      (`app/snapshots/`, Roborazzi), verified in CI so a UI change carries
      its screenshot diff.
- [x] Android app: add, edit and delete a booking, with the web's form and
      save; a delete asks first.
- [x] Android app: the Profile tab (documents, loyalty table and details,
      travelers, sharing lists), document warnings once at the top of the
      list and on trip pages, upcoming cards kept to their dates, sources and
      sender on one line, loyalty lines on bookings.
- [x] Android app: the owner's trip edits (rename, fit dates, share, merge,
      delete and finish an interrupted deletion) and moving a booking to
      another trip.
- [ ] Android app: tests of `FirestoreTrips`' writes against the Firestore
      emulator (the booking save, fit, move, merge, delete and an interrupted
      deletion), as `apps/web/src/lib/edits.test.ts` has for their web twins.
      The Firestore Android SDK does not run under Robolectric (its
      completion listeners post to a looper the test owns), so these are
      instrumented tests that need a device or an Android emulator, which CI
      does not have yet.
- [x] Android app: the Reports tab (summary, world map, days per country,
      favorite places, trips per year, year picker).
- [x] Android app: share the travel profile from the Profile tab.
- [ ] Android app, next: reminders settings; the shared `androidlog` and
      `androidzoom` libraries; release signing,
      the Play internal track and `scripts/publish-github-release.sh`
      (byte-identical across the Android apps); the weekly Gradle batch
      (`mikelward/gradle-update` with `catalog: apps/android/gradle/libs.versions.toml`).
- [ ] Android app, maintainer steps: register the Android app in the Firebase
      project (package `app.travelmo` and `app.travelmo.debug`, the signing
      SHA-1, Google sign-in enabled) and keep `google-services.json` out of
      git; add `ci / android` to the ruleset's required checks; add the
      sibling apps' `.claude/settings.json` SessionStart hook (the sandbox
      refuses an agent writing that file) so web sessions seed the SDK.
- [x] A second chance for places an exhausted daily geocoding budget left
      without a country or a spot: the import queues the booking and a daily
      sweep (`/internal/geocode-sweep`, the third scheduler job) asks again.

## Decisions needing review

Guesses made on autopilot; change any of them freely.

- Partner sharing is per trip, by email. A sharee edits bookings; only the
  owner renames, shares or deletes the trip. Not whole-account sharing.
- Backfill: on demand from Settings, the whole mailbox in batches of 300
  that the page keeps requesting until done (the user can stop and
  continue later); nothing automatic at connect time, and no background job
  driving it server-side.
- Gemini is the extraction model (`gemini-flash-lite-latest` by default,
  configurable); Claude Haiku was the alternative.
- Refresh tokens are stored in Firestore under `users/{uid}/private`,
  sealed by rules and encrypted at rest, not in Secret Manager per user.
- Firestore documents store ISO strings, not Timestamps, so every
  client parses the same thing.
- The parser is one Cloud Run service that also hosts the Gmail OAuth
  flow, so the web app holds no secrets and needs no server code.
- The web app is built on the same branch and PR as the review gates
  because this session was limited to one branch.
- Infrastructure is gcloud scripts in `deploy/` (rerunnable), not Terraform:
  five delivery attempts before dead-lettering, a week of retention there,
  and two alert policies (watch renewal failed, dead letter present). The
  scripts have not been run against a project from this session.
- Similarity pre-filter: Gemini's embedding API (`gemini-embedding-001`,
  256 dimensions) rather than a local model, which would have added some
  100 MB of ONNX runtime and weights to the Cloud Run image and slowed
  cold starts; an embedding costs about a hundredth of an extraction.
  Thresholds (five examples of each kind, 0.85 similarity, 0.1 margin,
  40 examples kept per kind) are guesses to tune against real mail.
  Examples are the model's own verdicts, not only the user's review
  decisions, since those are rare; a review decision still teaches it.
- Android idioms in the mockups: one scrolling list with Now / Upcoming /
  Past headers rather than tabs (empty groups hide); round two added a
  Material 3 navigation bar with three destinations (Trips, Reports,
  Profile) now that the app has them, with Settings still behind a gear and
  Sign out in the overflow menu; the booking form as a full-screen dialog;
  a row's actions in a bottom sheet; delete trip as a dialog; pill buttons
  and an extended FAB "Add a booking". The product's missing confirmations
  and the "Car" / "Car rental" label mismatch are shown as they are, not
  fixed. The reports map is a sketch; the real one would be the web app's
  world map data.
- Airport zones come from the OpenFlights database (ODbL) via the
  `airport-data` package, filled from coordinates with `tz-lookup` where
  it has none; generated and committed, not fetched at build time.
- Offline: the service worker is Serwist's runtime caching bundled by
  esbuild (`@serwist/next` needs webpack; this app builds with Turbopack),
  caching pages, router payloads and build assets as they are used rather
  than precaching the app; the runtime-data request of a saved page is read
  out of Next's inline `__NEXT_CLIENT_RESUME` script, a Next internal the
  offline end-to-end test guards. Firestore's persistent cache holds the
  data. The end-to-end tests moved from `next dev` to a production build, so
  CI builds the web app twice.
- TripIt import: a TripIt trip overlapping a trip from another source joins
  it rather than standing beside it, so Gmail and TripIt copies of one
  journey make one trip; trips from TripIt never absorb each other by
  overlap. The alternative was always keeping TripIt's grouping. Duplicate
  detection (`sameBooking`) applies to Gmail too: two confirmation emails for
  one flight now make one booking. Its identity evidence (confirmation
  numbers, codes at both ends, or a shared distinctive name word other than
  the city) leans toward keeping a duplicate over losing a booking. Notes,
  empty TripIt trips and unknown objects are listed and skipped, not imported
  as "other"; a date-only activity takes noon. The mapping was tuned against
  one real 20-year export (never committed; tests use invented fixtures of
  the same shapes), which settled these: a time with no zone at all is kept
  as written at `+00:00` with a note rather than dropped (it cost a trip
  each); a cruise is a ferry booking per sailing between port calls, like a
  flight's legs, rather than a new segment type (one booking spanning the
  voyage would hide the ports between from the reports); a transfer with TripIt's code
  `F` is a ferry and any other, `G` (ground transportation) or none, a bus,
  since the reports read "other" as a stay at its destination;
  a place's country is read off the last part of its one-line address when
  that names a country or is a US state and ZIP, nothing otherwise; a
  loyalty program's `Activity` list (every points transaction) is left out
  of the profile; the export's `TravelAccount*` templates are loyalty
  accounts, `TravelDocument*` documents, `UserProfilePublic` and the root
  fields the traveler's own entry, and a photo URL or SMS number is dropped.
- Calendar files: an event's title is its only booking signal, so the
  pre-filter passes booking words, flight and train numbers and airport
  routes; a TripIt calendar (by `PRODID`) skips it. Reads per upload are
  capped at 100, and the user uploads again to continue, rather than a
  background job. Calendar events teach the similarity filter alongside
  emails.
- Google Calendar was built before forward-to-import, which needs a paid
  inbound mail service. It is a separate consent with its own token rather
  than an extra scope on Gmail's, so either disconnects alone; calendars
  start unchosen (a busy work calendar costs model reads); it rides the
  daily feed poll rather than a Calendar push watch or its own scheduler
  job, so no redeploy of `deploy/scheduler.sh` is needed.
- A changed calendar event is detected by a hash of the text the model reads,
  not by `LAST-MODIFIED` or `SEQUENCE` as first planned: some calendars bump
  those on every export, which would re-read every event daily at a model
  call each, and the hash also covers Google Calendar. A change to an edited
  or matched booking leaves it as it is rather than replacing the user's
  version.
- Travel profile sharing is one list of trusted people per account, by
  verified email, who can read the whole profile, documents included, and
  change nothing; not per document, and not linked to trip sharing. Each
  TripIt upload replaces the imported sections wholesale. Every value is
  kept as a labeled string, since TripIt's profile shapes are undocumented;
  the template names a real export turned out to use are read, and anything
  else falls back to the generic reading. Documents are shown folded until
  opened.
- Reports count every trip the viewer can see, shared ones included (a
  partner's shared trip is usually one they were on too), and a travel day
  for both countries, as day-counting rules for residence usually do. Home
  days between trips aren't counted: Travelmo doesn't know where home is.
- The reports page computes in the browser from one read of every booking,
  not from a server-side aggregate or BigQuery export; fine for hundreds of
  trips, and the first thing to change if it gets slow.
- Geocoding: Google's Geocoding API rather than a bundled city table, since
  the project is on Google Cloud and the parser already holds secrets; the
  volume (a few hundred distinct names for a 20-year export, then a handful
  a month) sits inside the free allowance. Negative answers are cached for
  good, the daily cap defaults to 300 calls across all users, flights never
  cost a call (the airport table), a hand-entered booking is not geocoded,
  and `locality` (then `postal_town`, then the county) is the city.
- Address autocomplete calls the Places API (New) from the browser with a
  public key restricted by HTTP referrer and API, as the Firebase config is,
  rather than through the parser (which would put the parser on every
  keystroke); no type filter, so one request serves streets, postcodes and
  ZIPs; the pick's name is the suggestion's main text, not the paid
  `displayName`.
- Places on the map: `Place` carries `lat` and `lon` (both or neither), from
  TripIt's own coordinates (a `0, 0` pair read as blank), the airport table,
  the geocoder's answer, or the form's address pick (`location` is in the
  same Places field-mask SKU as the address components, so it costs nothing
  more). A place that already has a country is now geocoded too, for its
  spot alone, with the country on the query, but such a lookup may use only
  half the daily budget so the countries the reports need come first; on the
  real export that is about 170 extra queries over 240, spread by the cap
  over two days. A place the cap left without a spot is queued for the
  daily sweep. Dots within about a hundred meters are one, under
  the first booking's name. Bookings imported before this change have no
  coordinates and stay off the map until re-imported.
- Loyalty at a glance reads an entry's labeled fields by their usual names
  (account number, balance or points, elite status or tier) rather than
  changing what the import stores, so older profiles work and odd labels
  stay visible in the folded entry. A booking is matched to a program by a
  shared distinctive word of the provider's name (TripIt's `supplier_code`
  is a vendor slug, not an airline code, and Gmail bookings carry only a
  name), which matched every program in the real export to some provider;
  only the viewer's own programs show on a booking, not a fellow
  traveler's. Balances are shown as imported, not fetched: TripIt's are a
  snapshot from its last sync.
- The geocoding sweep is a queue the import writes to (one small document
  per put-off booking), not a scan of every booking for missing fields,
  which Firestore cannot query for and which would read everything daily.
  It writes under the user's import lock and only when the booking's
  revision is the one it read, so a hand edit is never overwritten; an entry
  older than thirty days is dropped unasked, and a lookup error keeps the
  entry for another day. The job takes the third free Cloud Scheduler slot.
- Reminders by email reuse the SMTP service the operator already has (as
  readmo's sign-up notice does) through nodemailer, rather than a mail API
  with its own account; the parser holds the credentials. They are opt-in
  and go to the Google-verified sign-in address only. One email a day at
  most, with everything new across the coming month's trips; a line is sent
  once ever per trip, keyed by its text, so a changed date reads as new. The
  entry lines mailed are only those needing action, while the trip page
  shows every country. The job is the fourth Cloud Scheduler job (about ten
  cents a month beyond the free three) rather than a fold into another.
- The Android app is native Kotlin and Compose in `apps/android` of this
  repository, not the React Native port SPEC once pencilled in for
  `apps/mobile` and not a repository of its own: native is what every other
  Android app in the account is, so their build, test, CI and release
  conventions carry over, and a subdirectory keeps the web app, the rules and
  the data model beside it (a `git subtree split` can still move it out). Its
  `:core` re-implements the shared logic in Kotlin rather than sharing code
  with `packages/core`: the surface is small and pure, and the two test
  suites mirror each other. `minSdk` 34, the sibling apps' floor. Navigation
  3, as stopdash chose, so the back stack is a list the app owns.
- The Android booking form has no address suggestions (the Places key is
  the web app's browser key, restricted to its origins) and so no picked
  city, address or spot: a place keeps those while its name holds and loses
  them when it is renamed, as the web's form does when a name is typed over
  a pick. Deleting a booking asks first on Android, unlike the web, since
  a tap in an overflow menu is easier to slip on than a text button.
- The trip card's online check-in line assumes the common window, a day
  before departure until departure, since airlines differ (some open 48 or
  30 hours ahead, most close 45 to 60 minutes before) and the booking
  carries no airline rule; the line says "usually" and is a nudge, not a
  promise. The countdown stops a week out, where a date says more than a
  count of days. The stay line names lodging only; a rental car under way
  is not a place one is at.
- Reminders by push use the Web Push standard (VAPID keys the parser holds,
  the browsers' own push services, which charge nothing) through the
  `web-push` library (MPL-2.0, file-level copyleft, used unmodified) rather
  than Firebase Cloud Messaging, which would add an SDK and a project key to
  the client for the same delivery. A subscription is per browser, written
  by that browser under the user, and the switch in Settings is per browser
  too; `reminders.push` on the user document follows the last browser out.
  Both channels send the same lines, a line is marked sent only once every
  channel that day took it, so a failed push after a sent email repeats the
  email tomorrow rather than losing the notification; a subscription the
  push service calls gone is dropped on the spot. One notification per trip,
  tagged by trip so a later one replaces it, with a day to live.
- Entry requirements come from the Passport Index dataset on GitHub
  (imorte/passport-index-data, MIT; it is compiled from passportindex.org,
  whose own terms the dataset does not state), the only open table found
  that covers every passport and destination; the datahub.io set (CC BY) was
  not checked. It is fetched into a committed 42 KB table rather than read
  live, so the page works offline and never calls out, and refreshed by hand
  with `pnpm --filter @travelmo/core visas` (the upstream updates about
  monthly; a quarterly rerun is enough, and the box shows the month). The
  easiest of a traveler's passports is chosen; a held visa that lasts the
  trip counts as covering the country; the purpose and length of stay are
  not modeled, which the box says.
- Ratings and favorites live on the booking (the stay, the tour, the
  flight), not on a separate place record: there is no place entity, and
  the booking is where the traveler was. Anyone who can edit the trip can
  rate, as with every other edit, and the last tap wins. The reports page
  gathers them by place name and country rather than by coordinates, since
  a name is what the traveler looks for. No rating comes from an import.
- The mockups' navigation bar grew a fourth destination, Calendar, between
  Trips and Reports, in the web nav's order; Material 3 allows three to
  five. Own trips use the primary color and shared ones a violet token added
  to the theme, matching the web app's two bar colors.
- The calendar shows trips, not bookings (a month of bars is readable; a
  month of flights and check-ins is not, and bookings would need a listener
  per trip), with weeks starting on Monday (the app's dates are en-GB) and
  the month kept in page state rather than the URL. Lanes are laid out per
  week, so a long trip may change lane from one week to the next.
- The trip list's cards say what comes next only for a trip under way; an
  upcoming trip's card is its title and dates (maintainer, 2026-11-07).
  The list's document warnings sit in one card at the top, one line per
  document for the earliest trip it bears on, rather than on every card;
  a booking's sources and sender share one line.
- Document reminders show in the app (trip page and trip card), not by
  email or push, which would need a scheduled job and a mail service. Six
  months is the margin for every passport, rather than a per-country table
  of entry rules; visas are checked only for lasting the trip. A shared
  profile's documents count on trips its owner is on.
- The calendar export includes trips shared with the user, and only trips
  ending within the last year (a calendar keeps what it already showed;
  years of history would slow every refresh). Bookings carry their
  confirmation numbers and notes, as TripIt's export does; the link is
  the secret, so Settings warns, and replacing it kills the old one. It is
  served by the parser, which already holds the Admin credential, rather
  than by the web app, which holds none.
- The booking form's country picker is hidden for flights (the airport code
  already says the country, and an imported one is kept); stays, activities
  and other journeys get one per place, defaulting to none.
