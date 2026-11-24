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
      `ci / android` and `ci / android-emulator` (without them a PR can
      auto-merge while an Android job is red, as #68 did), conversation
      resolution and up-to-date branches; enable the auto-merge setting.

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
- [x] Import sources beyond Gmail, one pipeline: generalize
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
  - [x] Forward-to-import address for people without Gmail:
        `<token>@travelmo.app` from Settings, Cloudflare Email Routing's
        catch-all to the `apps/inbound` Worker, which relays each message
        to the parser's `/inbound/cloudflare` for the usual import.
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
- [x] Android app: tests of `FirestoreTrips`' writes against the Firestore
      emulator (the booking save, fit, move, merge, delete and an interrupted
      deletion), as `apps/web/src/lib/edits.test.ts` has for their web twins:
      instrumented tests in `app/src/androidTest`, run by CI's
      `android-emulator` job on a hosted runner's emulator
      (`scripts/connected-tests.sh` seeds the users and runs them).
- [x] Android app: the Reports tab (summary, world map, days per country,
      favorite places, trips per year, year picker).
- [x] Android app: share the travel profile from the Profile tab.
- [x] Android app: the reminders-by-email switch in Settings.
- [x] Android app: the shared `androidlog` debug log, with the recording
      switch and the report share in Settings.
- [x] Android app: reminders as notifications over Firebase Cloud
      Messaging (the phone's token under `users/{uid}/devices`, the parser's
      `fcm.ts` sender beside web push, the switch in Settings). The shared
      `androidzoom` library is for apps that zoom a picture; nothing here
      does.
- [x] Android app: a "Flight changes" notification channel with its own
      chime, so gate changes, delays, cancellations and diversions sound
      unlike reminders.
- [x] The weekly Gradle batch: `.github/workflows/gradle-update.yml` calls
      `mikelward/gradle-update` with the catalog under `apps/android`, the
      CI checks as its checks, androidlog's Maven branch as an extra
      repository and its two coordinates off the cooldown.
- [x] The weekly npm batch for the pnpm workspace:
      `.github/workflows/npm-update.yml` calls `mikelward/npm-update` in
      its pnpm mode (taught there for this workspace: `pnpm update -r`,
      the workspace manifests, a pnpm-lock.yaml reader for its checker).
- [x] Android app: release signing from the four `RELEASE_KEYSTORE_*`
      variables, the `Publish` job on main (signed bundle as an artifact, a
      GitHub prerelease per versionCode through the shared
      `scripts/publish-github-release.sh`, the Play internal track once a
      service account exists).
- [x] App icon: a white paper plane with a dotted trail on orange, on the
      web, the Android launcher and notification, and a 512 px Play icon.
- [x] Play store listing in the repo (`apps/android/play`): texts, feature
      graphic and six screenshots framed from the snapshots, checked on
      every pull request and published by the `Publish` job when it changes.
- [x] Privacy policy page on the web app (`/privacy`), for the Play listing
      and Google's OAuth verification.
- [x] Account deletion in the app and on the web (Play requires both for
      an app with sign-in): Settings' "Delete account" calls the parser's
      `POST /account/delete` (SPEC "Deleting an account"). The Play
      listing's data safety form and account deletion URL (the web's
      Settings page) are the maintainer's to fill in.
- [ ] Android app, maintainer steps: register the Android app in the Firebase
      project (package `app.travelmo` and `app.travelmo.debug`, the signing
      SHA-1, Google sign-in enabled) and keep `google-services.json` out of
      git; add `ci / android` to the ruleset's required checks; add the
      sibling apps' `.claude/settings.json` SessionStart hook (the sandbox
      refuses an agent writing that file) so web sessions seed the SDK; make
      the upload keystore and put it, its passwords and the Firebase config
      in the `production` environment (README "Release"); create the Play
      Console app with its declarations, then the service account; enable
      the Firebase Cloud Messaging API and give the parser's service
      account the Messaging admin role (README "Deploy"); for the
      weekly batches, allow Actions to create pull requests, put
      `GRADLE_UPDATE_PAT` in a `gradle-update` environment and
      `NPM_UPDATE_PAT` in an `npm-update` one (README "Dependency
      updates"), and have the ruleset require branches to be up to date,
      which their auto-merge checks for before arming; for forwarding
      addresses, add travelmo.app to Cloudflare with Email Routing on,
      deploy the `apps/inbound` Worker with its `INBOUND_SECRET`, point
      the catch-all rule at it, and set `FORWARD_DOMAIN`, `INBOUND_SECRET`
      and `NEXT_PUBLIC_FORWARD_DOMAIN` (README "Deploy", step 8).
- [x] A second chance for places an exhausted daily geocoding budget left
      without a country or a spot: the import queues the booking and a daily
      sweep (`/internal/geocode-sweep`, the third scheduler job) asks again.
- [ ] Read past bookings faster within Gmail's quota: fetch a message's
      headers first (`format: "metadata"`, 20 units rather than a full
      message's 60) and the full message only once the pre-filter passes
      it. Worth it if more than a third of the search's hits are turned
      down; count `prefiltered` against `imported` in the `backfill` log
      lines first.
- [ ] Trial the Gemini Decisions API (`gemini-decision-1`, launched
      2026-11-11) as the booking gate in place of the similarity
      pre-filter, behind a flag. Wait until the deploy has real mail: first
      count how often an extraction ends `not_booking` versus `imported`,
      and go ahead only if those wasted calls add up. One call can ask
      several closed questions over the same email (booking? promotional?
      booking type?), billed once at $0.10 per 1M input tokens with no
      output tokens and 150–250 ms latency, and it needs no stored examples
      or thresholds. It cannot replace extraction, which must write
      `ExtractedBooking`. From the docs: `ai.decisions.create` needs
      `@google/genai` 3.2 or later (the parser has 2.32, so a major bump
      first) and `apiVersion: "v1beta"`; it is on the Developer API (AI
      Studio key) only, so the Vertex AI path stays on the similarity
      filter until Google Cloud support ships; no batch or context caching;
      yes/no answers are clamped to 0.01–0.99, so pick the threshold from
      labeled mail, and record a drop as "filtered" so it still shows in
      the Import review list with "import anyway". Docs: https://aistudio.google.com/docs/decisions-api
- [ ] Make connecting Gmail obvious: after the consent screen, Settings
      shows only a small green notice. Show the connected state and the
      next step (import past bookings) prominently in the Gmail section.
- [x] Connect more than one Gmail account (up to five), each with its own
      Import past bookings and Disconnect, on the web and Android.
- [ ] Once every mailbox connected before there could be several has been
      moved (the parser logs `gmail_moved` with `moved: 0` on every start),
      stop reading and writing the user document's `gmail` (rules, parser,
      web and Android), and drop the frozen copies.

- [ ] Choose the app's heading and body fonts on the web and Android.
      Geist on the web for now; Fira Sans is the brand face (wordmark,
      Play listing). None of Fira Sans with Inter, with the system font,
      or on its own was right.
- [x] Home, step 1: work out home over time from round trips, with moves
      and corrections (`homeTimeline`, `homeAt`, `isAtHome` in
      `packages/core` and the Android `:core`; SPEC "Home").
- [x] Home, step 2: group imports by it, so a day out at home never joins
      a trip away and journeys from home and back bound a trip (a holiday
      club in London either side of a Liverpool weekend came in as one
      "London" trip).
- [x] Home, step 3: show home over time on the web's Profile, with a way to
      correct it (`homes` on the user document; imports and regrouping
      honor it).
- [x] Home on Android's Profile tab, as the web has it (`describeHomes`,
      `effectiveHomes` and `HomeCorrection` are already in `:core`).
- [x] Home, step 4: regroup existing trips under the new rule ("Regroup
      trips" in Settings on the web, `POST /trips/regroup`).
- [x] Android: a "Regroup trips" action in Settings, calling
      `POST /trips/regroup` as the web does.
- [x] Android: "Delete all trips" in Settings, calling
      `POST /trips/delete-all` and asking first, as the web does.
- [x] Finish a half-done account deletion: when the deletion marker exists
      but the sign-in account does not go (in production it once failed
      deleting the Firebase Auth user, before the parser held
      `roles/firebaseauth.admin`), every action fails with "410 This account
      was deleted". The parser's 410 should say the deletion did not finish,
      and the web app should say so and offer to finish deleting (calling
      `POST /account/delete` again), rather than leave every action failing.
- [x] A "New Payment Confirmation" receipt from class4kids.co.uk came in as
      its own 00:00 activity, duplicating the "Stage Stars! Holiday Club -
      Day 1" booking it paid for: a receipt without a time should not
      become a booking, or should match the order it pays for.
- [ ] Evaluate pre-filtering Gmail on sender and subject alone, fetching
      a message's body only once it passes (`format: "metadata"` first,
      then `"full"`), so emails that aren't bookings are never downloaded
      in full. Check what the filter and the similarity step read beyond
      those headers, what an extra request per passing message costs in
      quota and time, and update `/privacy` to match if it changes.

- [ ] Analytics, server side: a parser job that counts, across all users,
      bookings and import outcomes (imported, skipped, failed) per sender
      domain (the travel company) and per source, and forwarded email per
      sender's mail provider (well-known providers only, the rest as
      "other"). Counts name companies, never people; buckets under 5 are
      dropped; nothing goes to an analytics service, so no consent prompt
      is needed. `/privacy` and `docs/PRIVACY.md` describe this as
      planned: when it ships or the plan changes, update both, their date,
      and Play's data safety form.
- [ ] Maybe later: opt-in Android crash reports (Firebase Crashlytics),
      as in the sibling apps, behind a Settings switch that is off by
      default. The privacy policy already promises the opt-in.
- [x] Live flight updates, first part: the departure and arrival gate and
      terminal and the baggage carousel, on the flight's card and as a
      notification when one is set or changes, from FlightAware AeroAPI
      (Personal tier), polled by the parser every minute from two hours
      before departure and from half an hour before landing to 45 minutes
      after, every 15 minutes between, and when the trip page is open (at
      most once a minute per flight, shared by everyone on it); about $1 a
      flight, with a daily cap.
- [x] Live flight updates, second part: delays, cancellations and
      diversions on the flight's card and as notifications, from the same
      AeroAPI polling.
- [x] Approve sign-ups by hand: a new account waits until an admin
      approves it (Firestore rules and the parser refuse its writes and
      imports meanwhile; trips shared with it stay readable), the admin is
      told of each request, and accounts made before this ships stay in.
      AeroAPI's Personal license covers personal and household use only;
      the next tier up (Standard) costs $100 a month.
- [x] Invites: an admin invites an email address, and an account signing
      in with that verified address is approved without waiting.
- [x] Linked email addresses: confirm other addresses of yours (a work
      one) from Settings by an emailed link, and trips, profiles, invites,
      reminders and flight news for any of them reach you; the connected
      Gmail counts too.
- [x] Invited at another address: the invite-only page links the address
      someone was invited at, and confirming it lets them in.
- [x] Android access screens (request-access screen and Access page): the
      "Travelmo is invite-only" screen with Request access (writing
      `access/{email}` and calling `/access/check`, as the web does),
      invites written with shares, and the Access page for admins, opened
      by the "Access request" notification.
- [x] Read PDF attachments (tickets, booking confirmations) when an email
      passes the filter: an SJ "Tickets for booking …" email was read as
      not a booking, most likely because the journey is only in the PDF.
      Gmail's, handed to the model as documents, never parsed here.
- [ ] Read PDF attachments of Fastmail, IMAP and forwarded emails too, as
      Gmail's are: each source's fetch offers them (`attachments`); the
      forwarding Worker's size limit cuts large attachments off.
- [x] File a car or taxi from the airport with the flight it meets, not as
      a trip of its own named after home (`isTransfer`, `connects`).
- [ ] Maybe later: a `transfer` booking type from extraction, shown as
      "Transfer" rather than "Car". Transfers are inferred today from a car
      or "other" booking whose two ends differ, which needs no schema,
      rules or Android model change.
- [x] Web, found in the light and dark audit: the calendar's `role="grid"`
      has no rows or cells (axe `aria-required-children`); the booking
      form's time fields clip "09:00" at desktop width; the Profile
      loyalty table runs its Balance and Status headers together.
- [ ] Web manifest: `background_color` and `theme_color` are light only,
      so an installed app's splash screen is white in dark mode; a manifest
      cannot vary by scheme, so it needs a choice of one neutral color.
- [x] Pending cancellations expire per entry: an undated entry in a mixed
      list keeps the undated retention (`stillWaiting`).
- [x] Revival after a reconfirmation should check the other pending
      cancellations for that booking (`standingCancellation`).
- [x] Show the cancelled label on upcoming trip cards: pass segments for
      cancellation status independently of showNext (web page.tsx Section,
      Android TripListScreen), with a snapshot re-record.
- [ ] Cancel through an alternate reference: one kept only as "Other
      reference: …" in a booking's notes isn't matched; needs a field for
      matchable alternate references.
- [x] "Delete all trips" also clears the user's `pendingCancellations`,
      so a re-import starts from nothing.
- [x] Android app: read a booking's `cancelledAt` in `data/Documents.kt` and
      show cancelled bookings struck through with a "Cancelled" label and a
      Restore action, as the web does.
- [x] Android app: a cancelled booking in a screenshot fixture
      (`trip_detail_cancelled`).
- [x] Remind travelers when online check-in opens: per-airline windows
      (default a day), on the trip card too; once per booking and person,
      by their reminder channels, from the every-minute flight job.
- [x] Reminders of the traveler's own before international trips: a list
      in Settings with lead times, a "Before you go" checklist on each trip
      (ticked off and one-offs added per person), each due one sent once by
      the daily run.
- [ ] Check-in reminders: deep links to each airline's check-in page in
      place of its home page, once each is checked from a browser; more
      airlines in the table as their windows are confirmed.
- [x] Suggest a car or ride for a flight with none booked: rental
      companies where it lands, the traveler's own companies (Settings) for
      rides to and from the airport at home; hidden per suggestion.
- [x] Android: car and ride suggestions on the trip page, as the web shows
      them; companies stay edited on the web.
- [ ] Car suggestions: open each rental company's search at the arrival
      airport and dates in place of its home page, once each link is
      checked from a browser.
- [x] Loyalty numbers from booking emails: the extraction lists them, the
      owner's are kept beside TripIt's, shown in Profile's table and the
      booking line, and removable.
- [x] Android: loyalty numbers found in emails on the Profile tab and the
      booking line, with Remove.
- [x] Loyalty balances and status from travel programs' statement emails
      (Emerald Club, MileagePlus), only from travel companies' domains.
- [x] A journey that lands where the next trip leaves from opens that trip
      on import too, not only on Regroup (`opensTrip`): booked as it
      happens, the flight to New York stays with the trip before until a
      Regroup moves it.
- [x] "Never import this sender" on an imported booking (web and
      Android), beside "Always import this sender": stops future imports
      from it and offers to remove what it already imported (a weekly kids'
      class is no trip).

- [x] Residence and visa days on Reports: days in and out of countries
      against UK settlement and citizenship, Schengen, US citizenship,
      green card and tax, Canada and Australia limits.
- [x] Residence and visa days on Android: a date picker, as the web has
      (it counts to today), and the stays and time away past the latest
      five.
- [ ] Mailboxes beyond Gmail, read as Gmail is (new mail and the whole
      history), with several connected at once:
  - [x] The parser reads mail through a `MailSource` (search a page,
        fetch a message), Gmail its first implementation.
  - [x] Fastmail over JMAP with a read-only API token from Settings
        (web and Android): new mail polled, the backfill chain per
        mailbox, `source: "fastmail"`.
  - [ ] Maintainer: run `deploy/scheduler.sh` again for the
        `poll-fastmail` job, then connect a real Fastmail mailbox and
        check new mail and Import past bookings.
  - [ ] Ask Fastmail's partnerships team for an OAuth client with a mail
        read scope, so connecting is one tap instead of a pasted token.
  - [x] Encrypt stored mail credentials (Gmail and Calendar refresh
        tokens, parked OAuth tokens, Fastmail tokens) with Cloud KMS, so
        only the parser can read them and a Firestore leak reveals
        nothing usable.
  - [ ] Maintainer: run `deploy/kms.sh`, set `CREDENTIALS_KMS_KEY` on the
        parser, and check `credentials_sealed` in its log.
  - [x] IMAP with app passwords (iCloud, Infomaniak, Yahoo, others), as a
        `MailSource`: inbox opened read-only, new mail polled with the
        Fastmail job, the backfill through IMAP search; server settings
        filled in for known providers; passwords sealed with Cloud KMS as
        the other credentials are (`sealing.ts`, and found by
        `sealStored.ts`). Neither iCloud nor Infomaniak offers OAuth for
        mail.

## iOS app

Kotlin Multiplatform, sharing the Android app's Kotlin (SPEC "iOS app").

- [x] Build `apps/android/core` for iOS too, its tests on the iOS
      Simulator in CI.
- [x] Move the Compose screens to a module both apps build (Compose
      Multiplatform):
  - [x] their text (`apps/android/shared`, `Res.string.*`);
  - [x] logging and data access behind interfaces;
  - [x] the view model (`TripsViewModel`), which every screen takes;
  - [x] the palette, the brand and most screens (trip list, calendar,
        profile, booking form, checklist, import review, residence days);
  - [x] the trip page, Reports and Access;
  - [x] Settings, its Android-only sections (notifications, text size,
        debug log) coming from the app;
  - [x] navigation (the pages, the home tabs and the back stack's routes).
- [ ] The iOS app:
  - [x] Firestore for both apps in one implementation (`:firestore`,
        GitLive's Firebase Kotlin SDK);
  - [ ] the Xcode project, Firebase Auth, Google sign-in and Sign in with
        Apple, the parser calls, notifications.
- [ ] TestFlight builds from CI (needs the Apple Developer Program).

## Decisions needing review

Guesses made on autopilot; change any of them freely.

- iOS: the sign-in and licenses screens stay each app's own rather than
  shared: iOS signs in with Apple as well as Google and lists its own
  bundled libraries, so sharing them would mean sharing little.
- Flight changes channel: high importance (heads-up) with an original
  falling E6–C6 chime (`apps/android/scripts/flight-chime.py`); the app
  picks it by the parser's `flight-` tag rather than a new message field,
  so it works with the parser as deployed. Reminders keep default
  importance and the system sound.
- Flight delays: the card shows a departure or landing five minutes or
  more off schedule; a departure moved 15 minutes or more from what the
  last news said is news; landing estimates are shown but never sent; an
  airline cancellation shows only "Flight cancelled", hiding gates.

- Fastmail: two users may connect the same Fastmail mailbox, since the
  token is proof of access. (Settled by the maintainer: a connected
  Fastmail or IMAP address does not count as a confirmed address for
  sharing; confirming it under Email addresses is enough.)
- Fastmail: only read-only tokens are accepted, and new mail is polled
  every five minutes (about ten cents a month for the scheduler job).
- IMAP: up to five mailboxes per account, as Gmail's; like Fastmail, two
  users may connect the same mailbox (the password is proof of access).
- Access: nobody can ask for access any more (bots filled the requests);
  only invites and shares let people in. To bring asking back, revert the
  commit "Remove asking for access" and add a bot check before reopening it.
- Loyalty revision: when reading an email again finds no numbers at all,
  the numbers kept from it stay as they were rather than being removed.
- IMAP: only the inbox is read, new mail and backfill alike; archive
  folders (iCloud's Archive, Yahoo's) are not, and the statements search
  is not narrowed to travel programs' senders (the pre-filter does it).
- IMAP: the username is always the email address, and the server always
  implicit TLS; a server that only offers STARTTLS on 143 is refused.
- IMAP: known providers are iCloud, Yahoo and Infomaniak by their own
  domains; a custom domain hosted there asks for the server.
- IMAP: after a refused password, background reads skip the mailbox for an
  hour; "Import anyway" still tries. Messages are read up to 2 MB, and a
  poll imports at most 200 new ones.
- IMAP: the five-minute job keeps its `poll-fastmail` name and now calls
  `/internal/poll-mail`, which polls both, rather than adding a job.
- IMAP: sources and review rows read "Other email" (not "Email", which
  Gmail's sources use).

- iOS: the shared screens will be Compose Multiplatform rather than SwiftUI,
  so one UI serves both phones; SwiftUI would feel more native but means a
  second UI to keep in step.

- Android access: until the server confirms an account is not approved,
  the app shows as before (an empty trip list for one not approved) rather
  than a loading screen, so an approved account never waits, offline
  included; the web shows "Loading…" instead. Access is in every screen's
  ⋮ menu for an admin (not on the Access page itself), after the screen's
  own items. Access requests get a notification channel of their own
  ("Access requests") rather than sharing "Trip reminders", so an admin can
  mute them apart; they are told by both the `access-` tag and the
  `/access` URL, so an airline page named /access still opens in the
  browser. "Invited at another address?" says "Open it to confirm", as
  Settings does, since the link opens on the web, not in the app. An
  Android account from before approvals records itself, as on the web.

- Residence and visa days: the official pages (gov.uk, ec.europa.eu,
  uscis.gov, irs.gov, canada.ca, immi.homeaffairs.gov.au) could not be
  fetched from the build sandbox, so each number and convention was
  checked against search results quoting them, not the pages themselves;
  read each cited page before relying on it. Doubts:
  - UK citizenship: that departure and return days are not absences is
    the Home Office's rule for settlement (whole days); naturalisation
    guidance was not seen saying the same. The Home Office's discretion
    (up to 480 days) is not modeled. Planned changes to settlement
    (a longer qualifying period) are not reflected; the 12-month windows
    run over the five years before the date whatever the route.
  - UK: only GB counts as the UK; the Channel Islands and Isle of Man are
    away.
  - Australia: sources disagree on whether the days of leaving and
    returning count as days in Australia; they are counted as in (the
    any-part rule). The 12 months away is 365 days, and the four years'
    other conditions (lawful residence, a year as a permanent resident)
    are not checked.
  - Canada: the half-day credit for time before permanent residence (up
    to 365 days) is not counted, and permanent residence is checked over
    the last five years even for someone resident less long. That a part
    day counts is from IRCC's calculator help, not verified on the page.
  - US: "over six months" is a day past six calendar months after leaving;
    "a year or more" is coming back on or after the same date a year on.
    The green card warns from six months, when the return may be
    questioned. Substantial presence ignores exempt days (students,
    teachers, commuters from Canada or Mexico, transit under 24 hours).
  - Schengen: Monaco, San Marino and Vatican City are not counted; the
    worst window is looked for over the year before the date.
  - A day nothing places counts against the traveler (away, or in for
    Schengen and US tax), and so do the days of a trip shared with them
    by someone else, as the other reports count them.

- "Import past bookings" regroups the user's trips when it finishes, as
  "Regroup trips" does, so a booking moved by hand during the import may
  be filed again by the grouping rules.

- Loyalty from emails: a number whose name could not be the account's
  (shares no name with the Google profile's) is kept as that person's, as
  the maintainer asked, and shown on bookings too; whose a number is stays
  as first seen unless the owner says otherwise. Kept only from
  emails that book travel, and from travel programs' statements, which pass
  the pre-filter only from the travel domains listed in `prefilter.ts` or a
  sender the user always imports; statements over 60 days old are skipped.

- Car and ride suggestions: home is this trip's own round trip (or Profile's
  corrections), not the timeline of every trip, to save reads; rides at
  home show only once the traveler adds a company near home; the built-in
  list is Avis, Enterprise, Hertz, Budget, Sixt, National and Alamo, and no
  shuttle directory.
- Linked email addresses: each connected Gmail mailbox counts as confirmed
  only while connected (no stored claim of its own); only the sign-in's decline
  locks an account out; at most ten linked and pending addresses and five
  links a day; trips shared with a linked
  address keep it when the account is deleted; another account signing up
  later with a linked address is not stopped (both count it). A fellow
  traveler's document warnings show on a trip shared with their sign-in or
  the address on their profile, not their other linked ones, which nobody
  else can read.

- Cancellations and trip dates: rather than every screen loading a trip's
  bookings to work out what is still booked (the trip list loads them for
  only a few trips), the trip keeps when the person now travels beside its
  own dates (`liveStart`, `liveEnd`), set by the importer and widened by
  the apps' edits. An end set beyond the bookings is kept. Deleting a
  booking narrows neither, as before; Fit dates does.

- Live flight status: the flight number is read from the booking's title
  (no field of its own yet); one status per flight number, local date and
  departure airport, readable by any signed-in user who names it (public
  flight data, never listed); old statuses are kept rather than swept, a
  few hundred bytes a flight; news goes to the owner and sharees of every
  trip holding the flight, through the reminders' notification channels
  and the Android `reminders` channel rather than one of its own; the
  daily cap defaults to 1,000 calls (about $5); a status shows from a day
  before departure; an open trip page asks for a look from six hours
  before.

- Trip names: journeys name a trip before stays, so a flight to Melbourne
  names it whatever suburb the stays are in; suburbs are not mapped to
  their city otherwise (a trip of stays in St Kilda alone is "St Kilda").
  A title counts as an import's (and is renamed as bookings join, and by
  Regroup) when it equals what its bookings, or one email's, would be
  named, by the current or earlier rules, or the name of one of its
  bookings or their places; a name the user typed that happens to equal
  one of those is renamed too.
- A stay whose two emails name different places merges on the same
  provider, listing title and check-in and check-out instants; the more
  specific place wins (address, coordinates, city; the confirmation's on a
  tie). Regroup still only moves bookings, so such stays already filed
  twice stay until one is deleted.

- Gmail quota for "Import past bookings": a reading spends at most 4,000 of
  a user's 6,000 units a minute (about 66 messages), leaving the rest for
  new mail and opening emails; a rate-limited batch holds the next off one
  minute; a delivery waits in its request up to a minute before handing on
  to a fresh message; three failed batches in a row stop the reading. New
  mail waits out a rate limit for up to a minute per notification.

- Deleting an account keeps the bookings the user added to someone else's
  trip (they belong to that trip; their `sources` still carry the deleted
  uid, which links to nothing), takes the user's verified email off other
  people's travel profiles' `trustedEmails` as well as trips'
  `sharedWith`, and revokes every Google token outright rather than
  sparing a grant another connection rests on, since none is left. An
  unverified email in the ID token removes the user from nothing, so a
  look-alike account cannot unshare a real address. The parser does not
  ask for a recent sign-in: the in-page confirmation (a dialog on
  Android) is the only check. The web clears its Firestore cache
  afterwards; the Android app does not clear Firestore's on-device cache,
  as it does not on a change of account either. The Android app's parser
  address is the production one from `apps/android/gradle.properties`
  (public, as in `apphosting.yaml`), overridable with
  `-PtravelmoParserUrl` or `TRAVELMO_PARSER_URL`; a build without one
  says to delete the account on the web. Logs name the account by uid
  only, as the parser's other logs do.

- Home, step 4 (regrouping existing trips) went before step 3 (showing and
  correcting home on Profile): the trips already imported were grouped
  wrongly, and step 3 is only the Profile view. Regrouping keeps a trip's
  title only while it still holds every booking it had, since nothing
  marks a title the user typed; a renamed trip that loses bookings takes
  the worked-out name.

- Outings (activities and other bookings in one place) no longer chain by
  nearness of dates, even while home is unknown: an outing and travel join
  only when they share a town the travel goes to. The price is that a day
  trip from a trip away (Uppsala from Stockholm) comes in as its own trip.
  Recognizing a home district by distance (Bromley, Muswell Hill as
  London) was left out: grouping no longer needs it.
- A journey's end more than eight days after it leaves is ignored for a
  trip's dates, rather than capping it at eight days.
- One event confirmed twice under two references is matched only on the
  event's name, never on a shared venue alone; regrouping still moves
  bookings only, so duplicates already filed stay until deleted.

- Forwarding addresses are `<token>@travelmo.app`, the token the whole
  local part (twenty lowercase base32 characters) rather than an
  `import+<token>` tag: Email Routing's catch-all delivers either, and the
  bare form has nothing for a mail client to mangle. The Worker relays the
  raw message and the parser parses it (`postal-mime`, MIT-0, no
  dependencies), so the Worker stays within the free plan's CPU allowance;
  attachments are not read. A forwarded message skips the pre-filter, as a
  user's "import anyway" does, with a cap of 50 a day per user. Unknown and
  retired addresses and over-limit days bounce to the sender with the
  reason rather than vanish. The web learns the domain from
  `NEXT_PUBLIC_FORWARD_DOMAIN`, as it learns the push key, so the section
  hides on a deployment without forwarding. `wrangler` is not a
  dependency: deploys use `pnpm dlx wrangler@4`. The forwarding helpers in
  `packages/core/src/forward.ts` (token shape, address, reading the
  original sender out of a forwarding block) have no Kotlin twin: only
  the parser runs them, and an Android Settings section would show the
  issued address straight from the user document, as the web does.
- Reminders to phones share the web's `reminders.push` flag rather than a
  flag of their own: the parser's one query finds everyone with any
  channel, and each client clears the flag only when no browser and no
  phone is left. The Messaging channel is always on in the parser (the
  Admin credential needs no key), where email and web push each need a
  setting. A device's id is the first 32 hex characters of the token's
  SHA-256, so a token is never a document name. A message is data only
  (a notification message is collapsible per app, so of several trips'
  reminders queued for an offline phone only the last would arrive) and
  the app draws it in the `reminders` channel at default importance; a tap
  opens the trip in the app.
- The Gradle batch dispatches no CI run (`ci-workflow: ''`): ci.yml has no
  `workflow_dispatch` with a `pr` input, and the PAT makes the dispatch
  unnecessary; until the PAT exists, a batch PR's CI waits for one approval
  click. Its checks include the screenshot verify, so a rendering change
  from a Compose bump fails the batch for a human rather than landing. The
  engine's "Not managed" report reads only root-level Gradle scripts, so the
  one plugin pinned outside the catalog, foojay-resolver in
  `apps/android/settings.gradle.kts`, goes unreported; it is listed here
  instead.
- The Android `Publish` job warns and stops when the release secrets are
  missing, where the sibling apps fail the run: this app has no Play
  listing yet, so a red main on every merge would say nothing new. Switch
  it to failing once the first release has shipped.

- Partner sharing is per trip, by email. A sharee edits bookings; only the
  owner renames, shares or deletes the trip. Not whole-account sharing.
- Backfill: started on demand from Settings, then the whole mailbox read
  on the server in batches of up to 300, each queueing the next through
  Pub/Sub, so closing the page does not stop it (the user can stop and
  continue later); nothing automatic at connect time.
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
  `airport-data` package and OurAirports (public domain), filled from
  coordinates with `tz-lookup` where they have none; generated and
  committed, not fetched at build time.
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
- The trip card's online check-in line reads the airline's window from a
  short table (a day for any airline not listed) and says open until
  departure, since airlines close at different times (most 45 to 60
  minutes before); the line says "usually" and is a nudge, not a
  promise. Check-in reminders: sent from the every-minute flight job (not
  the daily reminder run, which would be up to a day late, nor a new
  Scheduler job), even without an AeroAPI key; no earlier than two days
  before departure however early the airline opens (easyJet's month), and
  none in the last hour; a flight booked after check-in opened is
  reminded at once; once per booking, so a retimed flight is not reminded
  again and someone added to the trip after it went is not told; no
  switch of its own, following `reminders.email` and `reminders.push`;
  delivered when any channel took it (as flight news), a failure on every
  channel tried again by the next five runs; a tap opens the airline's
  home page (not a deep link to check-in, which could not be checked from
  the sandbox and moves often) or the trip; one reminder per person per
  flight across bookings of the same flight. The table's windows are from
  memory of the airlines' published rules, not checked online. The countdown stops a week out, where a date says more than a
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
- Several Gmail mailboxes: at most five per account; the account's first
  mailbox ever keeps Gmail's bare message ids and every other gets
  `gmail-<key>-` ids (the same each time it is connected). A user who
  disconnected their only mailbox before this shipped and now connects a
  different one first gives that one the bare ids, as before. A request
  that names no mailbox means the only one and is refused while there are
  several; apps older than this show only the first mailbox (the frozen
  `gmail`). Source links carry the mailbox in the source id rather than a
  new `mailbox` field, so sharees never see the importer's other addresses.

- Reminders before trips: a trip counts as international from this trip's
  own round trip (or Profile's corrections), as ride suggestions work home
  out, not from every trip as Profile does, to save reading every trip on
  each visit and run; a one-way trip with no correction is not
  international. No home country or no placed booking: not international.
- Reminders before trips: trips shared with the person get their own
  standing reminders too, to them alone; one-offs go on any trip, abroad
  or not. They go by the Reminders switches (nothing with both off), in
  the daily run at the document reminders' hour (06:07 UTC), not the
  person's own morning, as the document reminders do. One email and one
  notification per reminder, not one digest a day.
- Reminders before trips: one document per reminder in a numbered slot
  (s0–s19, a0–a9) rather than a list on the user document, since the
  rules ran out of their 1000 expressions checking more than five list
  entries; months count back calendar months; a lead time is at most 365
  days, 52 weeks or 12 months. Ticks of a deleted trip stay until the
  account goes; a reminder edited after it was sent is not sent again.
- Reminders before trips: "Before you go" shows on every trip not yet
  over, with Add a reminder even when nothing is listed, so a one-off can
  go on a trip at home.
