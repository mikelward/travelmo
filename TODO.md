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
  - [ ] TripIt JSON export (what customer service sends on request). Shape:
        `Trips[]` of `TripData {display_name, start_date, end_date,
        is_private}` and `Objects[]`; an object's kind is implied by its
        fields, not declared: air has `Segment[]` with
        `marketing_airline_code`, `marketing_flight_number`,
        `start_airport_code`/`end_airport_code`, city and country, seats,
        terminals; rail has `train_number` and station names; lodging has
        `room_type`/`number_rooms`; car has `car_type` and `Driver`;
        restaurant has `cuisine`/`number_patrons`; activity has `DateTime`
        and `detail_type_code`; notes have `text`. Every `DateTime` carries
        `date`, `time`, `timezone` (IANA) and `utc_offset`, which map
        straight onto our instants; `Address.address` is a single string;
        `booking_site_name` and `supplier_name` give the provider. Trip
        objects carry no confirmation numbers (only `UnfiledItems` do), so
        deduplicate against Gmail imports by type, dates and route rather
        than by reference. Also import `UnfiledItems` into a holding trip,
        and keep TripIt's trip grouping instead of re-grouping by dates.
        `LoyaltyPrograms` and `TravelerProfile` are the later loyalty and
        passport features' seed data. Upload from Settings, dry-run summary
        first, then import; mark segments `source: "tripit"`.
  - [ ] `.ics` files and feeds: per-trip TripIt exports, calendar exports,
        and a subscribed URL polled daily (the TripIt feed covers the last
        90 days and the future). `UID` is the source id; event text goes
        through extraction like an email.
  - [ ] Google Calendar through the existing OAuth flow with
        `calendar.readonly` and a calendar picker.
  - [ ] Backfill without the three-year cap, batched with a cursor, so a
        mailbox's whole history comes in.
  - [ ] Forward-to-import address for people without Gmail.
- [ ] Android mockups, round two: offline banner and page, interrupted
      deletion, loading and not-found states, the full dark set, and the
      future features from the brief (calendar, map, reports, loyalty,
      passport reminders) as concept screens.

## Decisions needing review

Guesses made on autopilot; change any of them freely.

- Partner sharing is per trip, by email. A sharee edits bookings; only the
  owner renames, shares or deletes the trip. Not whole-account sharing.
- Backfill at MVP: on demand from Settings, last three years, 300
  messages per call; nothing automatic at connect time.
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
