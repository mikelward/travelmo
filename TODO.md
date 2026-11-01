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
- [ ] Offer a timezone picker instead of a raw UTC offset when adding a
      booking by hand; derive it from the airport code where possible.
- [ ] "Fit dates to bookings" on a trip: bounds only ever widen today, so
      deleting the last booking of a trip leaves its dates where they were.
- [ ] Embedding pre-filter: score candidate emails against bookings the
      user confirmed, between the keyword check and the model call.
- [ ] "Learn this sender" from a trip page, feeding the allow list; a
      review queue for `not_booking` and `failed` outcomes.
- [ ] Merge trips and move segments between them.
- [ ] Surface check-in/check-out and boarding times on the trip list.
- [ ] Dead-letter topic on the Pub/Sub push subscription and an alert on
      `renew_watch_failed`.
- [ ] Service worker for offline trip pages (Serwist); `useOffline`.
- [ ] End-to-end test: emulator-backed sign-in, seeded trips, share with
      a second user (Playwright).

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
