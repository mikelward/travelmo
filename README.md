# travelmo

Your trips in one place, imported from your inbox. A TripIt-style planner:
connect Gmail, and booking confirmations become trips with flights, trains,
stays and rentals, grouped into now, upcoming and past, each card saying
what comes next, how soon, the gate or carousel for a flight, and when online
check-in opens, until you say you checked in. Share a trip with a
partner by email, see them month by month on a calendar, rate the places you stayed and mark favorites, see what each country of a trip asks of your passport, and see warnings when a passport or visa runs out too close to a trip, by email or as a notification if you like. Reports count the days spent in each country and the trips
each year, on a map of where you've been, and a calendar link puts your trips
in Google or Apple Calendar. A TripIt history comes in from the JSON export TripIt
support sends on request.

`SPEC.md` has the architecture and the reasoning behind it; `IMPORT.md` compares
the ways trips can come in, built and planned.

## Layout

```
apps/web        Next.js app (Firebase Auth + Firestore, PWA) on Firebase App Hosting
apps/android    Native Android app (Kotlin, Compose, Firebase Auth + Firestore): its own Gradle build
apps/parser     Cloud Run worker: Gmail OAuth, Pub/Sub push, pre-filter, Gemini extraction, TripIt import
apps/inbound    Cloudflare Email Worker: relays mail for the forwarding domain to the parser
packages/core   Shared zod schemas, Firestore paths, trip grouping, formatting, airport tables, travel reports, TripIt mapping
packages/rules  Firestore security-rules tests (run against the emulator)
firestore.rules Who may read and write what
deploy/         gcloud scripts for Pub/Sub, the daily jobs, alerting and CI deploys
design/android  Clickable Material 3 mockups of the Android app (also a Design canvas)
```

## Develop

Requires Node 22, pnpm (`corepack enable`) and a JRE for the Firestore emulator.

```sh
pnpm install
pnpm test          # unit tests + rules tests (starts the emulator)
pnpm typecheck
pnpm lint
pnpm build
```

End-to-end tests build the web app and drive it in Chromium against the Auth
and Firestore emulators (`apps/web/e2e`), offline reload included:

```sh
pnpm --filter @travelmo/web exec playwright install chromium   # once
pnpm --filter @travelmo/web test:e2e
```

`pnpm --filter @travelmo/core airports` regenerates the airport tables (time
zone, and country, coordinates and city) from the OpenFlights data (ODbL) packaged in
`airport-data` and OurAirports (public domain, fetched from GitHub), `pnpm
--filter @travelmo/core cities` the city-to-country table from GeoNames (CC
BY 4.0) packaged in `all-the-cities`, `pnpm --filter @travelmo/core city-names` each
city's names in English and its country's languages from GeoNames (CC BY 4.0,
fetched from download.geonames.org, about 200 MB, or read from a directory
given as its argument), `pnpm --filter @travelmo/core visas` the entry-requirements
table from the Passport Index dataset (MIT, fetched from GitHub; rerun it now
and then, since rules change and the trip page shows the month it was
fetched), `pnpm --filter @travelmo/web worldmap` the reports page's
world map from Natural Earth (public domain) packaged in `world-atlas`, and
`pnpm --filter @travelmo/web country-landmarks` the country map outlines in
`packages/core/src/landmarks.json` from the same `world-atlas` data; the
results are committed, so a normal build needs nothing.

The mark is a white paper plane with a trail of three curved dashes on
orange (`#F26B1D`), on the web, the launcher and the 512 px Play icon
(`apps/android/play/icon-512.png`), and one curved dash on the
notification icon. `scripts/icon-sources.mjs` holds its geometry and writes
every source from it: the web SVGs, the Play SVG, the Android vectors
(`res/drawable/ic_launcher_foreground.xml`, `ic_notification.xml`) and the
web's inline `components/Logo.tsx`; CI fails when they differ from what it
writes. After changing it, run `node scripts/icon-sources.mjs`, then
`pnpm --filter @travelmo/web icons` for the committed PNGs and
`pnpm --filter @travelmo/web play-graphics` for the listing's feature
graphic.

The web app's `build` script bundles the service worker (`src/sw.ts` to
`public/sw.js`) before `next build`; the worker registers in production
builds only, so `next dev` runs without it.

### Android

`apps/android` is a Gradle build of its own (JDK 21; the wrapper fetches
Gradle). `:firestore` is the Firestore code both apps use (GitLive's
Firebase Kotlin SDK); building for iOS needs Xcode 26 or later (Swift 6.2,
for the Firebase iOS SDK it fetches through Swift Package Manager). `:shared` holds, for the iOS app to come, the palette and most
screens (Compose Multiplatform, with the app's pieces through `AppChrome`),
their text, the logo and the wordmark's font as Compose Multiplatform
resources (`scripts/icon-sources.mjs` writes the logo there, and
`scripts/segment-icons.mjs` the booking-type icons), the interfaces the screens read data and
take actions through (each with a no-op version for tests and previews;
`:app` implements them with Firebase and the parser) and the log shared
code writes to, which `:app` sends to its debug log. Its `strings.xml`
takes an apostrophe or a percent sign as written, not escaped. `:core` is Kotlin Multiplatform (the JVM and iOS) with the models and the logic the web's
`packages/core` has (grouping, what comes next, the status lines, date
formatting), tested without an SDK and kept free of Android by
`:core:verifyNoAndroid`; `:app` is the Compose app: sign-in, the trip list,
a trip's bookings with adding, editing and deleting and its "Before you go"
reminders, the calendar's month
view, the travel profile with its document warnings, reports, the
open-source licenses, and Settings with sign-out, the reminders switches (by email, and as notifications on
the phone over Firebase Cloud Messaging, which asks for the notification
permission; flight changes come in a channel of their own with a chime that
`apps/android/scripts/flight-chime.py` writes, and a flight under way has a
Live Update with its gate, landing time or carousel in the status bar), the reminders before international trips, the text size, the debug log and deleting the account. Deleting calls the
parser at `travelmoParserUrl` in `apps/android/gradle.properties` (the
production address, as in `apphosting.yaml`; override it with
`-PtravelmoParserUrl=…` or `TRAVELMO_PARSER_URL`, or set it empty to have
Settings point to the web instead). The debug log is the
fleet's shared one, `com.mikelward.androidlog` from the Maven repository
that mikelward/androidlog publishes into its own `maven` branch (declared in
`settings.gradle.kts`, scoped to that group); it stays on the phone, and
Settings shares a report of it through the share sheet. The text size is
the fleet's shared `com.mikelward.androidzoom`, published and declared the
same way. In a Claude Code cloud session, `.claude/hooks/session-start.sh`
installs the Android SDK and accepts its licenses, logging what it did to
`~/.local/state/travelmo/session-start.log`.

```sh
cd apps/android
./gradlew :core:verifyNoAndroid :core:test            # no SDK needed; on a Mac, also on the iOS Simulator
./gradlew :shared:testAndroidHostTest :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

Every screen is rendered under Robolectric to `apps/android/app/snapshots/`
by `ScreenScreenshotTest` (fixtures, a clock stopped at 1 November 2026, a
phone's size, light and dark), and CI fails when a render differs from the
committed PNG, so a UI change ships with its re-recorded screenshots and
the diff shows in the PR (a screenshot run builds with the fixed test
version CI uses, so the Settings screen reads the same on both):

```sh
./gradlew :app:testDebugUnitTest --tests app.travelmo.ui.ScreenScreenshotTest -Proborazzi.test.record
```

About's open-source licenses list is the committed
`app/src/main/res/raw/aboutlibraries.json`, which the AboutLibraries plugin
exports and `exportBundledLicenses` filters to what the release APK bundles;
items that aren't Maven dependencies (the Fira Sans font) are JSON files in
`app/aboutlibraries/libraries/`. CI regenerates it and fails on a diff, so
after changing a dependency regenerate it and commit the result:

```sh
./gradlew :app:exportBundledLicenses --rerun
```

The writes behind the screens (`FirestoreTrips`: saving, moving, restoring and
merging bookings, fitting a trip's dates, deleting a trip and finishing a
deletion the app interrupted) are tested against the Firestore emulator
with the real rules, as the web's `edits.test.ts` tests their twins, in
`app/src/androidTest`. The Firestore SDK does not run under Robolectric, so
these run on an Android emulator or device that `adb` sees, with the
Firebase emulators on the host; from the repository root:

```sh
pnpm --filter @travelmo/rules exec firebase emulators:exec --only firestore,auth \
  --project demo-travelmo --config ../../firebase.json ../../apps/android/scripts/connected-tests.sh
```

The script seeds two approved users with verified addresses (the rules read
`email_verified` for a sharee), makes the first an admin (so the tests can
read the access records shares write) and runs `connectedDebugAndroidTest`. CI's
`android-emulator` job does the same on a hosted runner's emulator, beside
the unit job, in about ten minutes.

The app signs in with Google through Firebase Auth, so it needs the Firebase
project's Android app: in the Firebase console add an Android app with the
package `app.travelmo` (and `app.travelmo.debug` for debug builds) and the
signing certificates' SHA-1s: the upload key's, and for Play builds every
SHA-1 that Play Console's Protected with Play → Play Store protection → Play
app signing page gives under "Copy all certificate fingerprints" (there can be
three, more than the page shows; Play re-signs the app with its own keys, and
without the fingerprint of the one a phone gets, sign-in fails with status 16).
Enable the Google sign-in provider (which gives the project a web client id),
fill in the Google Auth platform's Branding page (app name, user support email
and developer contact; a missing one also fails with status 16), download
`google-services.json` into `apps/android/app/` (gitignored; never commit it)
and build again. Fingerprints and branding are checked on Google's side, so
changing them needs no new build. Without the file the build still succeeds
and runs, with sign-in off and saying so, which is how CI builds. `versionCode` is the
repository's commit count and `versionName` names the commit, so build from a
full clone (`scripts/unshallow.sh` deepens a shallow one).

#### Release

A push to `main` runs the `Publish` job: it builds the signed release
bundle, keeps it as the `app-release-aab` workflow artifact for 30 days,
publishes it as a GitHub prerelease tagged `v<versionCode>` with the
release-worthy commit subjects since the last published release as notes
(`scripts/publish-github-release.sh`,
shared byte for byte with the sibling apps and tested on every pull
request). Once a Play service account is configured, the hourly `play`
workflow (`.github/workflows/play.yml`) puts the newest prerelease's
bundle on the Play internal testing track, with every release's notes
since the one Play has as "What's new", and the listing below, in one
edit; it commits nothing when Play is already current. Play limits how
many edits an app may commit a day, and uploading on every push used that
up on busy days ("Daily save quota exceeded"). To publish without waiting
for the hour: Actions → play → Run workflow. The secrets live in the repository's
`production` environment (Settings → Environments; limit its deployment
branches to `main`):

| Secret | What it is |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | The Play upload keystore, base64: `keytool -genkeypair -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000`, then `base64 -w0 upload.keystore`. Play App Signing re-signs the bundle with its own key, so this one only authenticates the upload. |
| `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` | Its password, the key's alias and the key's password. |
| `GOOGLE_SERVICES_JSON` | The Firebase project's `google-services.json` for `app.travelmo`, so the release signs in. Download it after enabling Google sign-in in Firebase Authentication: the Publish job fails on one without the web OAuth client. |
| `PLAY_SERVICE_ACCOUNT_JSON` | Optional. A Play Console service account's key with "Release to testing tracks" and "Manage store presence" (for the listing) on the app and nothing more; until it is set, upload the prerelease's bundle through Play Console by hand. Add it only after the Play app exists with its declarations filed. |

Without the keystore and the Firebase config the job warns and stops rather
than failing. A push whose commits are all `docs:`, `test:`, `build:`,
`refactor:` or `ci:`, or touch only Markdown, dotfiles or `design/`, keeps
the bundle as the artifact and publishes nothing, as there is nothing to
announce. Locally, `RELEASE_KEYSTORE_FILE=… RELEASE_KEYSTORE_PASSWORD=…
RELEASE_KEY_ALIAS=… RELEASE_KEY_PASSWORD=… ./gradlew :app:bundleRelease`
builds the same signed bundle.

The Play store listing lives in `apps/android/play`: `icon-512.png`, and
per language under `listings/<language>/` the title, short and full
descriptions (`title.txt`, `short-description.txt`,
`full-description.txt`), `feature-graphic.png` (1024 × 500) and
`phone-screenshots/` (2 to 8, sorted by name).
`pnpm --filter @travelmo/web play-graphics` renders the feature graphic
and frames the screenshots from `apps/android/app/snapshots` (the first from
`trip_list_cities`, a list of trips to cities with landmarks recorded for
it), removing any it no longer makes, so rerun it after re-recording those. CI checks the listing against Play's limits on
every pull request (`node scripts/publish-play.mjs --check`), and
once `PLAY_SERVICE_ACCOUNT_JSON` is set the `play` workflow compares it with
Play's copy hourly and sends what differs with the newest release. Play cannot take
a listing before the app exists in Play Console; the content rating,
target audience, data safety, app access and ads declarations stay in
Play Console.

#### Dependency updates

`.github/workflows/gradle-update.yml` runs the fleet's shared weekly batch
(mikelward/gradle-update) on Saturdays: every entry in
`apps/android/gradle/libs.versions.toml` moves to the newest stable release
within its major, the Android checks run against the result, and one pull
request opens with auto-merge armed, so a clean batch lands once CI passes;
a failed check leaves it open for a look. The androidlog and androidzoom
repositories' Maven branches are declared to it and exempted from the release-age cooldown, as those
repositories' READMEs ask. One-time setup: Settings → Actions → General →
Workflow permissions → "Allow GitHub Actions to create and approve pull
requests", and a `gradle-update` environment holding `GRADLE_UPDATE_PAT`, a
fine-grained token with Contents and Pull requests write on this repository
(docs/PAT.md there), so the batch PR runs CI without an approval click.

`.github/workflows/npm-update.yml` does the same for the pnpm workspace
through mikelward/npm-update in its pnpm mode, later the same Saturday:
every range in `package.json`, `apps/*/package.json` and
`packages/*/package.json` moves to the newest release it already admits
(`pnpm update -r`, pnpm at the version `packageManager` pins, Node from
`.node-version`), `pnpm run lint`, `pnpm test` and `pnpm run build` run
against the result, a transitive dependency that would cross a major is
held back, and one pull request opens with auto-merge armed. Its one-time
setup is the same Actions permission plus an `npm-update` environment
holding `NPM_UPDATE_PAT`, a token with the same two scopes. What the checks leave
behind (each workspace's `node_modules`, the builds, the emulator logs) is
declared in its `ignored-build-outputs`; a new gitignored build output has
to be added there, or the batch refuses to open its PR.

Run the web app locally against a Firebase project:

```sh
cp apps/web/.env.example apps/web/.env.local   # fill in the Firebase web config
pnpm --filter @travelmo/web dev
```

Or against the emulators (no project needed for Firestore; Auth still needs a
project's web config):

```sh
pnpm --filter @travelmo/rules exec firebase emulators:start --config ../../firebase.json --project demo-travelmo
```

Run the parser locally (needs application-default credentials for Firestore):

```sh
WEB_ORIGIN=http://localhost:3000 \
GMAIL_PUBSUB_TOPIC=projects/<project>/topics/gmail \
BACKFILL_PUBSUB_TOPIC=projects/<project>/topics/gmail-backfill \
GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
GOOGLE_OAUTH_REDIRECT_URL=http://localhost:8080/gmail/callback \
INTERNAL_AUDIENCE=http://localhost:8080 INTERNAL_CALLERS=none \
GEMINI_API_KEY=... GEOCODING_API_KEY=... \
pnpm --filter @travelmo/parser dev
```

## Deploy

One Google Cloud project holds everything.

1. **Firebase**: create the project, upgrade it to the Blaze plan (Cloud
   Run, Cloud Build and Cloud Scheduler need billing), enable Google sign-in
   in Authentication, register a web app (`firebase apps:create WEB`), and
   deploy the rules and indexes with `firebase deploy --only firestore` (the
   shared travel profiles need a collection-group index on `trustedEmails`,
   and the calendar export composite indexes on `trips`). The Firestore
   database's location is permanent; a multi-region (`nam5`, `eur3`) is
   fine, since browsers and phones talk to it directly.
2. **Gmail, Calendar and Geocoding**: enable the Gmail API, the Google
   Calendar API and the Geocoding API. In the Google Cloud console's Google
   Auth Platform, create an OAuth client (web application) whose redirect URI
   is `https://<parser>/gmail/callback` (Calendar consent returns there too),
   and add the `gmail.readonly` and `calendar.readonly` scopes under Data
   Access. Gmail's is a restricted scope, so Google verification means a paid
   security assessment; for a few users skip it. In Testing, only the listed
   test users can connect and their Gmail access lapses after seven days; in
   production unverified, each user clicks through an unverified-app warning
   once, up to 100 users. A Cloud Run service's URL is
   `https://<service>-<project number>.<region>.run.app`, so the redirect URI
   can be set before the parser exists. Create service accounts for Pub/Sub
   to push as and for Cloud Scheduler to call as (they need no roles of
   their own), and one for the parser to run as with
   `roles/datastore.user`, `roles/secretmanager.secretAccessor`,
   `roles/firebasecloudmessaging.admin` and `roles/firebaseauth.admin`
   (Delete account removes the sign-in account; without it the data goes
   but the request fails with "insufficient permission"). Then
   `PROJECT=… REGION=<the parser's region> PARSER_SA=<the parser's service
   account> deploy/kms.sh` enables Cloud KMS and creates the key the parser
   encrypts stored mail credentials with (Gmail and Calendar refresh tokens,
   Fastmail API tokens, IMAP app passwords; SPEC "Stored credentials"): a key ring `travelmo`
   and a symmetric key `credentials`, rotated every 90 days, which only the
   parser's service account may encrypt and decrypt with
   (`roles/cloudkms.cryptoKeyEncrypterDecrypter` on that key alone). It
   prints the `CREDENTIALS_KMS_KEY` value for step 3. Each key version
   costs about $0.06 a month (four a year with rotation, all kept so old
   ciphertext still decrypts) and each call about $0.03 per 10,000: one per
   Gmail notification, Fastmail or IMAP poll, batch of "Import past
   bookings" and connection made. A connected Fastmail or IMAP mailbox,
   polled every five minutes, is about 8,600 calls a month, under three
   cents; a Gmail
   mailbox's calls follow its mail, usually fewer. While Cloud KMS
   is unreachable, nothing that needs a token works; Pub/Sub and the
   scheduled jobs try again.
3. **Parser** on Cloud Run. Build the image from the repository root with
   `gcloud builds submit . --config=apps/parser/cloudbuild.yaml
   --substitutions=_IMAGE=<region>-docker.pkg.dev/<project>/travelmo/parser`
   (into an Artifact Registry repository; a cleanup policy keeping the
   newest two images stays within its free storage), then
   `gcloud run deploy parser --image=… --service-account=…`. Allow
   unauthenticated invocations —
   user endpoints verify Firebase ID tokens and `/internal/*` verifies an OIDC
   token from the service accounts named in `INTERNAL_CALLERS`. `--set-env-vars`
   splits on commas, so pass a list such as `INTERNAL_CALLERS` with another
   delimiter (`--set-env-vars="^;^A=1;INTERNAL_CALLERS=a,b"`). Environment:
   `WEB_ORIGIN`, `GMAIL_PUBSUB_TOPIC`, `BACKFILL_PUBSUB_TOPIC` (both printed
   by `deploy/pubsub.sh`, step 4), `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET` (from Secret Manager),
   `GOOGLE_OAUTH_REDIRECT_URL`, `INTERNAL_AUDIENCE` (the service URL),
   `INTERNAL_CALLERS`, `CREDENTIALS_KMS_KEY` (printed by `deploy/kms.sh`,
   step 2), and either `GEMINI_API_KEY` or Vertex AI access through
   the service account (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`).
   Without `CREDENTIALS_KMS_KEY` mail credentials are stored unencrypted
   and the parser logs `credentials_unencrypted` as it starts; with it,
   those stored before are encrypted as it starts (`credentials_sealed` in
   its log, with counts; `credential_seal_failed` for any it could not,
   retried on the next start). Deploy the Firestore indexes first: finding
   them needs the collection-group indexes on `private`.
   Make the key in AI Studio on a project with billing on: the free tier's
   terms let Google use prompts to improve its products, and the privacy
   policy (`/privacy`) promises email is never used to train AI models.
   `GEMINI_MODEL` defaults to `gemini-flash-lite-latest` and
   `GEMINI_EMBEDDING_MODEL` to `gemini-embedding-001` (the similarity
   pre-filter). `GEOCODING_API_KEY` (from Secret Manager; an API key
   restricted to the Geocoding API) turns on filling in a place's country
   and coordinates at import; without it places keep whatever their source
   gave. `GEOCODE_DAILY_LIMIT` caps the calls per day across all users
   (default 300, within the API's free monthly allowance; answers are
   cached, so a place name is asked about once ever), and a place that has
   its country and wants only its spot for the map may use half of it.
   `AEROAPI_KEY` (from Secret Manager; a FlightAware AeroAPI key, from
   flightaware.com/aeroapi) turns on live gates and baggage carousels
   (SPEC "Live flight status"); without it flights show none.
   `FLIGHT_STATUS_DAILY_LIMIT` caps AeroAPI calls per day across all users
   (default 1,000, about $5). The Personal tier covers personal and
   household use only.
   `SMTP_HOST`, `SMTP_PORT` (default 465, TLS from the start; 587 upgrades),
   `SMTP_USERNAME` and `SMTP_PASSWORD` (from Secret Manager) and `SMTP_FROM`
   turn on reminders by email, sent through whatever mail service the
   account already has, and the links that confirm a linked email address
   (SPEC "Linked email addresses"); without `SMTP_HOST` the switch in
   Settings does nothing and adding an address answers that email is not
   set up. `BUG_REPORT_TO`, with SMTP, is where bug reports sent from the
   apps go (SPEC "Bug reports"); without it, or without SMTP, Report a bug
   on the web answers that sending reports isn't set up, and Android's
   offers the share sheet instead. To use an address on the app's own
   domain, such as `bug@travelmo.app`, give it a mailbox first: Cloudflare
   Email Routing only receives mail, and with the domain's catch-all sending
   everything to the forwarding Worker (step 8), a report would land on the
   parser as an unknown forwarding address and bounce. In Cloudflare, under
   the domain's Email → Email Routing → Routing rules, add a custom address
   (`bug`) with the action "Send to an email" and your own inbox (Cloudflare
   mails that inbox once to verify it); custom addresses win over the
   catch-all. Then set it on the parser alone, keeping its other settings:
   `gcloud run services update parser --project=travelmo-13a7c --region=us-east4 --update-env-vars=BUG_REPORT_TO=bug@travelmo.app`.
   Each report's Reply-To is the reporter's address, so replying from that
   inbox answers them directly, from your own address (Email Routing cannot
   send; replying as `bug@` needs a "send as" alias through an SMTP
   service). `VAPID_PRIVATE_KEY` (from Secret Manager), `VAPID_PUBLIC_KEY`
   and `VAPID_SUBJECT` (a `mailto:` or `https:` URL the push services may
   contact) turn on reminders as browser notifications; make the pair once
   with `pnpm --filter @travelmo/parser exec web-push generate-vapid-keys`
   and keep it, since a new pair orphans every subscription. Reminders to
   phones go through Firebase Cloud Messaging with the service account's
   own credential, so they need no setting, only the Firebase Cloud
   Messaging API enabled on the project and the parser's service account
   holding the **Firebase Cloud Messaging API Admin** role
   (`roles/firebasecloudmessaging.admin`); without them the daily job logs
   `reminder_failed` for anyone with a registered phone.
4. **Push**: `PROJECT=… PARSER_URL=https://<parser> PUSH_SA=<service account>
   PARSER_SA=<the parser's service account> deploy/pubsub.sh` creates the
   `gmail` topic (with Gmail allowed to publish to it), a push subscription
   to `https://<parser>/internal/pubsub/gmail` authenticated with an OIDC
   token from that service account, and a `gmail-dead-letter` topic and
   subscription that receive a notification the parser failed five times.
   It also creates the `gmail-backfill` topic, which the parser publishes to
   (the parser's service account gets `roles/pubsub.publisher` on it) so that
   "Import past bookings" reads batch after batch on its own, and its push
   subscription to `https://<parser>/internal/backfill`, dead-lettered to the
   same topic after ten failed attempts (a batch that must wait, after a
   failure or Gmail's rate limit, queues a fresh message rather than fail
   its delivery). It prints the `GMAIL_PUBSUB_TOPIC` and
   `BACKFILL_PUBSUB_TOPIC` values for the parser. Rerun it to change a
   setting. It uses `gcloud beta`, which gcloud offers to install on first
   use.
5. **Scheduled jobs**: `PROJECT=… LOCATION=<region> PARSER_URL=https://<parser>
   SCHEDULER_SA=<service account> deploy/scheduler.sh` creates six Cloud
   Scheduler jobs that POST with an OIDC token from that service account
   (list it in `INTERNAL_CALLERS`): `/internal/renew-watches`, since Gmail
   watches expire after seven days, `/internal/poll-feeds`, which reads
   every subscribed calendar feed, `/internal/geocode-sweep`, which asks
   the geocoder again about the bookings a spent daily budget put off, and
   `/internal/reminders`, which sends the day's reminders (and each due
   reminder people set themselves before a trip) by email and push, daily, and `/internal/flight-status`, which sends check-in
   reminders and looks at the flights near departure or arrival, every
   minute (check-in reminders go even without `AEROAPI_KEY`), and
   `/internal/poll-mail` (the job is still named `poll-fastmail`), which
   reads new mail in connected Fastmail and IMAP mailboxes, every five
   minutes. IMAP mailboxes are read with the `imapflow` library (MIT,
   bundled with the parser, no service or fee: a poll costs a few seconds
   of Cloud Run time per mailbox); the parser reaches each provider's IMAP
   server on port 993 (or the one the user gave) with TLS, so Cloud Run's
   egress must allow it (it does by default). Providers rate-limit
   logins: a mailbox whose server refuses its app password is left alone
   for an hour and Settings asks the user to connect it again; a provider
   that is down only delays that mailbox's mail to a later poll. Three jobs per billing account
   are free; each further one costs about ten cents a month. Deploy the
   Firestore indexes first: the flight status job queries bookings by type
   and start across trips. Once continuous deployment is set up (below,
   including `SCHEDULER_SA`), CI reruns this script whenever it changes, so
   a job added here reaches production without a step by hand.
6. **Alerts**: `PROJECT=… CHANNEL=<notification channel> deploy/monitoring.sh`
   creates two alerting policies from `deploy/alerts/`: a failed watch renewal
   (the parser's `renew_watch_failed` log line) and a dead-lettered
   message, a Gmail notification or a batch of "Import past bookings" (the
   alert says how to tell them apart and what to do about each). Create the
   notification channel (email, Slack, …) first;
   Cloud Monitoring's alerting is free at this volume.
7. **Web** on Firebase App Hosting: connect the repository, leave the root
   directory at the repository root (`/`: the build finds the pnpm
   workspace only there, and `apphosting.yaml` builds and starts
   `apps/web`), pick the `nodejs22` runtime, and set the variables in
   `apphosting.yaml` (committed: App Hosting reads them from the
   repository, and they ship in the client bundle anyway; the optional ones
   stay commented out until they have a value, as any value turns a feature
   on), whose build command runs the app's `build`
   script so the service worker is bundled. Add the App Hosting domain to
   Authentication's authorized domains. For address autocomplete in the
   booking form, enable the Places API (New) and set
   `NEXT_PUBLIC_GOOGLE_MAPS_KEY` to a browser key restricted to that API and
   to the app's origins (HTTP referrers): it ships in the client bundle like
   the Firebase config, so the restrictions are what protect it. Left unset,
   the form's place fields are plain inputs. A picked address also puts the
   place on the reports map. `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the public half
   of the parser's pair, lets Settings offer reminders as notifications in
   the browser; left unset, the switch is hidden. `NEXT_PUBLIC_FORWARD_DOMAIN`,
   the parser's `FORWARD_DOMAIN`, lets Settings offer a forwarding address;
   left unset, that section is hidden. The Android app's equivalent is
   `travelmoForwardDomain` in `apps/android/gradle.properties` (or
   `-PtravelmoForwardDomain=…`, `TRAVELMO_FORWARD_DOMAIN`).
8. **Forwarding addresses** (optional) on Cloudflare, for people whose
   confirmations are not in Gmail: each user gets `<token>@<domain>` from
   Settings and forwards booking emails to it. Add the domain to Cloudflare
   (its nameservers) and turn on Email Routing for it, which writes the MX
   and SPF records; a subdomain (`in.example.com`) works too where the
   account's plan allows Email Routing on subdomains, leaving the apex for
   a mailbox. Deploy the Worker from `apps/inbound` with
   `pnpm dlx wrangler@4 deploy` after setting `PARSER_URL` in its
   `wrangler.toml`, give it the shared secret with
   `pnpm dlx wrangler@4 secret put INBOUND_SECRET` (any long random string),
   and make the domain's catch-all rule "Send to a Worker" naming it. On the
   parser set `FORWARD_DOMAIN` to the domain and `INBOUND_SECRET` (from
   Secret Manager) to the same secret; `FORWARD_DAILY_LIMIT` caps the
   forwarded emails read per user per day (default 50). The Worker relays
   each message as it arrived to `/inbound/cloudflare`, where the parser
   parses it, finds whose address it was sent to and runs the usual import;
   a message to a retired or unknown address, or one over 16 MB, bounces to
   the sender with the reason. Email Routing and the Worker are free at
   this volume on Cloudflare's free plan.
9. **Admins**: only approved accounts may use Travelmo (SPEC "Access").
   Nobody already using it is locked out, and there is nothing to run by
   hand: as the parser starts, before it serves, it records as approved
   every owner of a trip or travel profile that nothing else lets in (an
   Android-only account has no user document) and everyone an approved
   owner shared one with (`access_grandfathered` in its log). Deploy the
   parser before the rules, as CI does: a parser whose first such run
   fails does not start, and its previous revision keeps serving. Name the admins by hand in the Firebase
   console: in Firestore, a collection `config` with a document `access`
   whose field `admins` is an array of lowercase email addresses (no client
   can write `config`, so this is the only way to change them). Admins are
   always let in, see Access in the menu, and approve or decline requests,
   invite addresses and revoke access there. Each new request reaches them
   once by email (with the SMTP settings above) and as a notification on
   the browsers and phones they turned reminder notifications on for.
   Without the document nobody is an admin: everyone already in carries on,
   and requests wait unseen (the parser logs `access_request_no_admins`).

### Continuous deployment

Once the steps above have been done by hand, CI's Deploy job
(`.github/workflows/ci.yml`) keeps them current: after `check` passes on a
push to `main`, it deploys each part whose files changed since it was last
deployed, which a `deployed/<part>` tag marks (a part with no tag yet, or
whose tag a force push left off `main`, deploys in full). A run that `main`
has already moved past deploys nothing; the newer run carries its changes:

| Changed | Deployed |
|---|---|
| `firestore.rules`, `firestore.indexes.json`, `firebase.json` | `firebase deploy --only firestore` |
| `apps/parser/`, `packages/core/`, the lockfile or the root build files | a Cloud Build image tagged with the commit, then a new revision of the `parser` Cloud Run service |
| `apps/inbound/` | the forwarding Worker, with `wrangler deploy` |
| `deploy/scheduler.sh` | the Cloud Scheduler jobs, with that script (after the parser) |

The parser deploys before the rules and the scheduler jobs, and either due
while a due parser is skipped for missing settings waits for it
(unrecorded), since rules can rely on what the parser does as it starts
(the accounts it lets in, SPEC "Access") and a new job can call a route
the parser has only just gained; a failed parser deploy stops the job
before them. Gmail mailboxes connected before an account could connect
several move to where each is kept now as the parser starts, with nothing
to run by hand (`gmail_moved` in its log; SPEC "Several mailboxes"), and
so do stored credentials not yet encrypted, once `CREDENTIALS_KMS_KEY` is set
(`credentials_sealed`; SPEC "Stored credentials").

The web app needs nothing here: App Hosting builds `main` itself. The parser's
deploy names only the image, so the service keeps its environment variables,
secrets and service account; change those with `gcloud run services update`.

Set it up once:

1. `PROJECT=… REGION=<the parser's region> REPO=<owner>/<name>
   PARSER_SA=<the parser's service account>
   SCHEDULER_SA=<the scheduler jobs' service account> deploy/github-deploy.sh`
   creates a `github-deployer` service account and a Workload Identity pool
   whose GitHub provider accepts only this repository's `ci.yml` running on
   `main`, so no key is stored anywhere. The deployer gets only what the
   deploys need: starting Cloud Builds (into a bucket of its own,
   `<project>-deploy-source`, that deletes uploads after a week) and reading
   their logs, running them as the project's default Cloud Build service
   account, reading the parser's image repository,
   deploying Cloud Run revisions as the parser's service account,
   creating and updating Cloud Scheduler jobs that call as the scheduler's
   service account (acting as no other account), and deploying Firestore
   rules and indexes. A run that `main` has
   moved past deploys nothing, so a slow older run never rolls back a newer
   deploy, and `.gcloudignore` keeps the job's credentials file out of the
   build upload. It prints the
   values below. Rerun it to change a setting.
2. In the repository's `production` environment (Settings, Environments),
   add the variables `GCP_PROJECT`, `GCP_REGION`,
   `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` and
   `PARSER_IMAGE` (and `GCP_SOURCE_BUCKET` if the script was given another
   bucket) as printed. For the Worker, add the variables
   `CLOUDFLARE_ACCOUNT_ID` and `PARSER_URL` (the parser's URL, without a
   trailing slash: the committed `wrangler.toml` holds only a placeholder,
   and every deploy replaces its `[vars]`), and the secret
   `CLOUDFLARE_API_TOKEN`, a token made from the "Edit Cloudflare Workers"
   template and limited to that account. For the Cloud Scheduler jobs, add
   `SCHEDULER_SA` as printed (it also needs `PARSER_URL`). A setup from
   before CI kept the jobs in step reruns the script once with
   `SCHEDULER_SA` and adds that variable; until then the jobs are skipped
   with a notice and stay as `deploy/scheduler.sh` last left them.

A part whose settings are missing is skipped with a warning rather than
failing the job, and its tag stays put, so the first push after its
settings are set deploys it. A failed deploy fails the job and moves no
tag, so the next push deploys that part again; meanwhile Cloud Run keeps serving the
previous revision, which it replaces only once the new one is ready, and the
Worker and the rules stay as they were.

Cost: the parser's build runs on Cloud Build's default `e2-standard-2`
machine, whose monthly free allowance of build-minutes (2,500 at the time of
writing) covers a few minutes per change many times over. Each build adds an
image to Artifact Registry, so keep the cleanup policy from step 3. The
Firestore, Worker and Cloud Scheduler deploys are free: the jobs cost
nothing beyond themselves (about ten cents a month each past three).

### Sender counts

How the email reader does with each sender, across everyone, is kept as
counts per sender domain in `senderStats` (no user, no email; SPEC "Sender
counts"). To see the domains most worth a look (where people used Import
anyway to make a booking of an email the reader turned down, then those it
most often turns down), sign in with an account that can read the project's
Firestore and run:

```sh
gcloud auth application-default login
GOOGLE_CLOUD_PROJECT=travelmo-13a7c pnpm --filter @travelmo/parser sender-stats 50
```

It also notes that it started, how it ended and any error in
`~/.local/state/travelmo/sender-stats.log`.

## Costs

Everything scales to zero. At a hundred users the bill is dominated by
Firestore reads and a few cents of Gemini per imported booking; geocoding is
one cached call per new place name (a second, for its spot on the map, when
the source named the country but not where), free up to the API's monthly allowance
and about half a cent a call past it, with a daily cap; address autocomplete
is billed per lookup session (the keystrokes of one field and the pick),
free up to a monthly allowance and a fraction of a cent past it; reminders
by email ride the account's own SMTP service, by push the browsers' own
push services and Firebase Cloud Messaging (both free), and all a fourth Cloud Scheduler job (about ten
cents a month); forwarding addresses ride Cloudflare Email Routing and a
Worker, free at this volume, with the model cost of a Gmail import per
forwarded email; checking who may use the app adds a few Firestore reads
per page and per import; encrypting stored mail credentials with Cloud KMS
is about $0.06 a month per key version and up to three cents a month per
connected mailbox (a call per notification, poll or reading batch); see
`SPEC.md`.
