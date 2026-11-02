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
  - [ ] TripIt travelers, `LoyaltyPrograms` and `TravelerProfile`: seed data
        for the later loyalty and passport features; not imported yet.
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
- [ ] One-to-one matching holds within one upload, not across two
      uploads of the same export running at once (each keeps its own
      `consumed` set), which can drop a room. Settings disables Import while
      one runs, so it takes two tabs or a scripted client. Serialize TripIt
      uploads per user (a lease in `users/{uid}/private`). The dropped
      room's source still shows on the booking it matched.
- [ ] Android mockups, round two: offline banner and page, interrupted
      deletion, loading and not-found states, the full dark set, and the
      future features from the brief (calendar, map, reports, loyalty,
      passport reminders) as concept screens.

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
  Past headers rather than tabs (empty groups hide); no bottom navigation
  (two destinations: Settings behind a gear, Sign out in the overflow
  menu); the booking form as a full-screen dialog; a row's actions in a
  bottom sheet; delete trip as a dialog; pill buttons and an extended FAB
  "Add a booking". The product's missing confirmations and the "Car" /
  "Car rental" label mismatch are shown as they are, not fixed.
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
  the city) leans toward keeping a duplicate over losing a booking. Notes, empty TripIt trips and unknown
  objects are listed and skipped, not imported as "other"; a date-only
  activity takes noon. The mapping follows the documented shape with
  invented fixtures; it has not been run against a real export.
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
