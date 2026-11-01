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
packages/core   Shared zod schemas, Firestore paths, trip grouping and formatting
packages/rules  Firestore security-rules tests (run against the emulator)
firestore.rules Who may read and write what
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
   whose redirect URI is `https://<parser>/gmail/callback`. Create a Pub/Sub
   topic `gmail` and grant `gmail-api-push@system.gserviceaccount.com` the
   Pub/Sub Publisher role on it.
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
   `GEMINI_MODEL` defaults to `gemini-flash-lite-latest`.
4. **Push and renewal**: a Pub/Sub push subscription on `gmail` to
   `https://<parser>/internal/pubsub/gmail` with an OIDC token from a service
   account listed in `INTERNAL_CALLERS`; a Cloud Scheduler job that POSTs to
   `https://<parser>/internal/renew-watches` daily with the same kind of
   token, since Gmail watches expire after seven days.
5. **Web** on Firebase App Hosting: connect the repository, set the root
   directory to `apps/web`, and fill in the variables in
   `apps/web/apphosting.yaml`. Add the App Hosting domain to Authentication's
   authorized domains.

## Costs

Everything scales to zero. At a hundred users the bill is dominated by
Firestore reads and a few cents of Gemini per imported booking; see
`SPEC.md`.
