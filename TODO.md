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
- [ ] Embedding pre-filter: score candidate emails against bookings the
      user confirmed (the review list's decisions), between the keyword
      check and the model call. Weigh the model dependency's size on the
      Cloud Run image first.
- [x] Merge trips and move bookings between them.
- [x] Surface the next check-in, check-out, departure or arrival on the
      trip list for trips under way and the next three upcoming.
- [x] Dead-letter topic on the Pub/Sub push subscription and an alert on
      `renew_watch_failed`.
- [x] Service worker for offline trip pages (Serwist); `useOffline`.
- [x] End-to-end test: emulator-backed sign-in, seeded trips, share with
      a second user who adds a booking (Playwright).

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
- Offline: the service worker is Serwist's runtime caching bundled by
  esbuild (`@serwist/next` needs webpack; this app builds with Turbopack),
  caching pages, router payloads and build assets as they are used rather
  than precaching the app; the runtime-data request of a saved page is read
  out of Next's inline `__NEXT_CLIENT_RESUME` script, a Next internal the
  offline end-to-end test guards. Firestore's persistent cache holds the
  data. The end-to-end tests moved from `next dev` to a production build, so
  CI builds the web app twice.
