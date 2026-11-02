# travelmo

Your trips in one place, imported from your inbox. A TripIt-style planner:
connect Gmail, and booking confirmations become trips with flights, trains,
stays and rentals, grouped into now, upcoming and past. Share a trip with a
partner by email.

`SPEC.md` has the architecture and the reasoning behind it.

## Layout

```
apps/web        Next.js app (Firebase Auth + Firestore, PWA) on Firebase App Hosting
apps/parser     Cloud Run worker: Gmail OAuth, Pub/Sub push, pre-filter, Gemini extraction
packages/core   Shared zod schemas, Firestore paths, trip grouping, formatting, airport zones
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

`pnpm --filter @travelmo/core airports` regenerates the airport-to-time-zone
table from the OpenFlights data (ODbL) packaged in `airport-data`; the result
is committed, so a normal build needs nothing.

The web app's `build` script bundles the service worker (`src/sw.ts` to
`public/sw.js`) before `next build`; the worker registers in production
builds only, so `next dev` runs without it.

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
GEMINI_API_KEY=... \
pnpm --filter @travelmo/parser dev
```

## Deploy

One Google Cloud project holds everything.

1. **Firebase**: create the project, enable Google sign-in in Authentication,
   create a Firestore database, then `firebase deploy --only firestore` for
   the rules.
2. **Gmail**: enable the Gmail API. Create an OAuth client (web application)
   whose redirect URI is `https://<parser>/gmail/callback`. Create a service
   account for Pub/Sub to push as (it needs no roles of its own).
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
   pre-filter).
4. **Push**: `PROJECT=… PARSER_URL=https://<parser> PUSH_SA=<service account>
   deploy/pubsub.sh` creates the `gmail` topic (with Gmail allowed to publish
   to it), a push subscription to `https://<parser>/internal/pubsub/gmail`
   authenticated with an OIDC token from that service account, and a
   `gmail-dead-letter` topic and subscription that receive a notification the
   parser failed five times. Rerun it to change a setting.
5. **Renewal**: a Cloud Scheduler job that POSTs to
   `https://<parser>/internal/renew-watches` daily with an OIDC token from a
   service account listed in `INTERNAL_CALLERS`, since Gmail watches expire
   after seven days.
6. **Alerts**: `PROJECT=… CHANNEL=<notification channel> deploy/monitoring.sh`
   creates two alerting policies from `deploy/alerts/`: a failed watch renewal
   (the parser's `renew_watch_failed` log line) and a dead-lettered
   notification. Create the notification channel (email, Slack, …) first;
   Cloud Monitoring's alerting is free at this volume.
7. **Web** on Firebase App Hosting: connect the repository, set the root
   directory to `apps/web`, and fill in the variables in
   `apps/web/apphosting.yaml`, whose build command runs the app's `build`
   script so the service worker is bundled. Add the App Hosting domain to
   Authentication's authorized domains.

## Costs

Everything scales to zero. At a hundred users the bill is dominated by
Firestore reads and a few cents of Gemini per imported booking; see
`SPEC.md`.
