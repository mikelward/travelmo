# travelmo

Your trips in one place, imported from your inbox. A TripIt-style planner:
connect Gmail, and booking confirmations become trips with flights, trains,
stays and rentals, grouped into now, upcoming and past, each card saying
what comes next, how soon, and when online check-in opens. Share a trip with a
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
packages/core   Shared zod schemas, Firestore paths, trip grouping, formatting, airport tables, travel reports, TripIt mapping
packages/rules  Firestore security-rules tests (run against the emulator)
firestore.rules Who may read and write what
deploy/         gcloud scripts for the Pub/Sub subscription and the alerting policies
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
zone, and country and coordinates) from the OpenFlights data (ODbL) packaged in
`airport-data`, `pnpm --filter @travelmo/core visas` the entry-requirements
table from the Passport Index dataset (MIT, fetched from GitHub; rerun it now
and then, since rules change and the trip page shows the month it was
fetched), and `pnpm --filter @travelmo/web worldmap` the reports page's
world map from Natural Earth (public domain) packaged in `world-atlas`; the
results are committed, so a normal build needs nothing.

The install icons are PNGs rendered from SVGs and committed; after changing
`apps/web/src/app/icon.svg` or `apps/web/icons/*.svg`, rerun
`pnpm --filter @travelmo/web icons`.

The web app's `build` script bundles the service worker (`src/sw.ts` to
`public/sw.js`) before `next build`; the worker registers in production
builds only, so `next dev` runs without it.

### Android

`apps/android` is a Gradle build of its own (JDK 21; the wrapper fetches
Gradle). `:core` is plain Kotlin with the models and the logic the web's
`packages/core` has (grouping, what comes next, the status lines, date
formatting), tested without an SDK and kept free of Android by
`:core:verifyNoAndroid`; `:app` is the Compose app: sign-in, the trip list,
a trip's bookings with adding, editing and deleting, the calendar's month
view, the travel profile with its document warnings, reports, and Settings
with sign-out, the reminders switches (by email, and as notifications on
the phone over Firebase Cloud Messaging, which asks for the notification
permission) and the debug log. The debug log is the
fleet's shared one, `com.mikelward.androidlog` from the Maven repository
that mikelward/androidlog publishes into its own `maven` branch (declared in
`settings.gradle.kts`, scoped to that group); it stays on the phone, and
Settings shares a report of it through the share sheet.

```sh
cd apps/android
./gradlew :core:verifyNoAndroid :core:test            # no SDK needed
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
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

The app signs in with Google through Firebase Auth, so it needs the Firebase
project's Android app: in the Firebase console add an Android app with the
package `app.travelmo` (and `app.travelmo.debug` for debug builds) and the
signing certificate's SHA-1, enable the Google sign-in provider (which gives
the project a web client id), download `google-services.json` into
`apps/android/app/` (gitignored; never commit it) and build again. Without
the file the build still succeeds and runs, with the sign-in button explaining
that nothing is behind it, which is how CI builds. `versionCode` is the
repository's commit count and `versionName` names the commit, so build from a
full clone (`scripts/unshallow.sh` deepens a shallow one).

#### Release

A push to `main` runs the `Publish` job: it builds the signed release
bundle, keeps it as the `app-release-aab` workflow artifact for 30 days,
publishes it as a GitHub prerelease tagged `v<versionCode>` with the
release-worthy commit subjects since the last published release as notes
(`scripts/publish-github-release.sh`,
shared byte for byte with the sibling apps and tested on every pull
request), and uploads it to the Play internal testing track once a Play
service account is configured. The secrets live in the repository's
`production` environment (Settings → Environments; limit its deployment
branches to `main`):

| Secret | What it is |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | The Play upload keystore, base64: `keytool -genkeypair -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000`, then `base64 -w0 upload.keystore`. Play App Signing re-signs the bundle with its own key, so this one only authenticates the upload. |
| `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` | Its password, the key's alias and the key's password. |
| `GOOGLE_SERVICES_JSON` | The Firebase project's `google-services.json` for `app.travelmo`, so the release signs in. |
| `PLAY_SERVICE_ACCOUNT_JSON` | Optional. A Play Console service account's key with "Release to testing tracks" on the app and nothing more; until it is set, upload the prerelease's bundle through Play Console by hand. Add it only after the Play app exists with its declarations filed. |

Without the keystore and the Firebase config the job warns and stops rather
than failing. A push whose commits are all `docs:`, `test:`, `build:`,
`refactor:` or `ci:`, or touch only Markdown, dotfiles or `design/`, keeps
the bundle as the artifact and publishes nothing, as there is nothing to
announce. Locally, `RELEASE_KEYSTORE_FILE=… RELEASE_KEYSTORE_PASSWORD=…
RELEASE_KEY_ALIAS=… RELEASE_KEY_PASSWORD=… ./gradlew :app:bundleRelease`
builds the same signed bundle.

#### Dependency updates

`.github/workflows/gradle-update.yml` runs the fleet's shared weekly batch
(mikelward/gradle-update) on Saturdays: every entry in
`apps/android/gradle/libs.versions.toml` moves to the newest stable release
within its major, the Android checks run against the result, and one pull
request opens with auto-merge armed, so a clean batch lands once CI passes;
a failed check leaves it open for a look. The androidlog repository's Maven
branch is declared to it and exempted from the release-age cooldown, as that
repository's README asks. One-time setup: Settings → Actions → General →
Workflow permissions → "Allow GitHub Actions to create and approve pull
requests", and a `gradle-update` environment holding `GRADLE_UPDATE_PAT`, a
fine-grained token with Contents and Pull requests write on this repository
(docs/PAT.md there), so the batch PR runs CI without an approval click. The
pnpm workspace has no batch yet (TODO.md).

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
GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
GOOGLE_OAUTH_REDIRECT_URL=http://localhost:8080/gmail/callback \
INTERNAL_AUDIENCE=http://localhost:8080 INTERNAL_CALLERS=none \
GEMINI_API_KEY=... GEOCODING_API_KEY=... \
pnpm --filter @travelmo/parser dev
```

## Deploy

One Google Cloud project holds everything.

1. **Firebase**: create the project, enable Google sign-in in Authentication,
   create a Firestore database, then `firebase deploy --only firestore` for
   the rules and indexes (the shared travel profiles need a collection-group
   index on `trustedEmails`, and the calendar export composite indexes on
   `trips`).
2. **Gmail, Calendar and Geocoding**: enable the Gmail API, the Google
   Calendar API and the Geocoding API.
   Create an OAuth client (web application) whose redirect URI is
   `https://<parser>/gmail/callback` (Calendar consent returns there too), and
   add the `gmail.readonly` and `calendar.readonly` scopes to the consent
   screen. Create a service account for Pub/Sub to push as (it needs no roles
   of its own).
3. **Parser** on Cloud Run, built from the repository root:
   `gcloud run deploy parser --source . --dockerfile apps/parser/Dockerfile`
   (or build the image and deploy it). Allow unauthenticated invocations —
   user endpoints verify Firebase ID tokens and `/internal/*` verifies an OIDC
   token from the service accounts named in `INTERNAL_CALLERS`. Environment:
   `WEB_ORIGIN`, `GMAIL_PUBSUB_TOPIC`, `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET` (from Secret Manager),
   `GOOGLE_OAUTH_REDIRECT_URL`, `INTERNAL_AUDIENCE` (the service URL),
   `INTERNAL_CALLERS`, and either `GEMINI_API_KEY` or Vertex AI access through
   the service account (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`).
   `GEMINI_MODEL` defaults to `gemini-flash-lite-latest` and
   `GEMINI_EMBEDDING_MODEL` to `gemini-embedding-001` (the similarity
   pre-filter). `GEOCODING_API_KEY` (from Secret Manager; an API key
   restricted to the Geocoding API) turns on filling in a place's country
   and coordinates at import; without it places keep whatever their source
   gave. `GEOCODE_DAILY_LIMIT` caps the calls per day across all users
   (default 300, within the API's free monthly allowance; answers are
   cached, so a place name is asked about once ever), and a place that has
   its country and wants only its spot for the map may use half of it.
   `SMTP_HOST`, `SMTP_PORT` (default 465, TLS from the start; 587 upgrades),
   `SMTP_USERNAME` and `SMTP_PASSWORD` (from Secret Manager) and `SMTP_FROM`
   turn on reminders by email, sent through whatever mail service the
   account already has; without `SMTP_HOST` the switch in Settings does
   nothing. `VAPID_PRIVATE_KEY` (from Secret Manager), `VAPID_PUBLIC_KEY`
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
   deploy/pubsub.sh` creates the `gmail` topic (with Gmail allowed to publish
   to it), a push subscription to `https://<parser>/internal/pubsub/gmail`
   authenticated with an OIDC token from that service account, and a
   `gmail-dead-letter` topic and subscription that receive a notification the
   parser failed five times. Rerun it to change a setting.
5. **Daily jobs**: `PROJECT=… PARSER_URL=https://<parser>
   SCHEDULER_SA=<service account> deploy/scheduler.sh` creates four Cloud
   Scheduler jobs that POST with an OIDC token from that service account
   (list it in `INTERNAL_CALLERS`): `/internal/renew-watches`, since Gmail
   watches expire after seven days, `/internal/poll-feeds`, which reads
   every subscribed calendar feed, `/internal/geocode-sweep`, which asks
   the geocoder again about the bookings a spent daily budget put off, and
   `/internal/reminders`, which sends the day's reminders by email and
   push. Three jobs per billing account are free; the fourth costs about
   ten cents a month.
6. **Alerts**: `PROJECT=… CHANNEL=<notification channel> deploy/monitoring.sh`
   creates two alerting policies from `deploy/alerts/`: a failed watch renewal
   (the parser's `renew_watch_failed` log line) and a dead-lettered
   notification. Create the notification channel (email, Slack, …) first;
   Cloud Monitoring's alerting is free at this volume.
7. **Web** on Firebase App Hosting: connect the repository, set the root
   directory to `apps/web`, and fill in the variables in
   `apps/web/apphosting.yaml`, whose build command runs the app's `build`
   script so the service worker is bundled. Add the App Hosting domain to
   Authentication's authorized domains. For address autocomplete in the
   booking form, enable the Places API (New) and set
   `NEXT_PUBLIC_GOOGLE_MAPS_KEY` to a browser key restricted to that API and
   to the app's origins (HTTP referrers): it ships in the client bundle like
   the Firebase config, so the restrictions are what protect it. Left unset,
   the form's place fields are plain inputs. A picked address also puts the
   place on the reports map. `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, the public half
   of the parser's pair, lets Settings offer reminders as notifications in
   the browser; left unset, the switch is hidden.

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
cents a month); see `SPEC.md`.
