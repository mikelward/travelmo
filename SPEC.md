# Travelmo specification

## Goal

A travel planner in the TripIt mold: one account holds every trip, trips are
imported from booking emails rather than typed in, the trip list loads fast,
and a partner can see a trip you share. Website first, installable as a PWA
on Android; native apps later without a rewrite.

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind | Static shells with client-side Firestore reads load instantly; React code and schemas carry over to React Native later |
| Hosting | Firebase App Hosting | Same project as Auth, Firestore and the worker; managed Next.js SSR on Cloud Run; scales to zero. Cloud Run with `apps/parser`-style Dockerfile is the fallback; Vercel was considered and rejected to keep one cloud and one bill |
| Auth | Firebase Auth, Google sign-in | Free at this scale; verified email is what sharing keys on |
| Data | Firestore | Realtime listeners, offline cache for the future mobile app, per-document rules make sharing a field, not a service |
| Email | Gmail API, OAuth refresh token, Pub/Sub push | Near-realtime import with no polling |
| Worker | Cloud Run (Hono, Node 22) | Pay per request; also hosts the OAuth flow so the web app needs no secrets |
| Extraction | Gemini via `@google/genai`, JSON schema output | Cheapest model that reliably fills a strict schema; model name is configurable |
| Mobile | PWA now, React Native + Expo later | `packages/core` already holds the schemas and logic a native app needs |

## Data model

ISO 8601 strings throughout, never Firestore Timestamps, so every client
reads the same document. Segment instants carry the local UTC offset of the
place they happen in and are displayed as written, not converted to the
viewer's zone. Trip bounds are calendar dates.

- `trips/{tripId}` — `title, start, end, ownerUid, sharedWith[], createdAt,
  updatedAt`. `sharedWith` holds lowercase email addresses.
- `trips/{tripId}/segments/{segmentId}` — `type` (flight, train, bus, ferry,
  lodging, car_rental, activity, other), `title, provider, confirmation,
  start, end, origin, destination, notes, source, gmailMessageIds[]`.
  Imported segments use the id `<gmailMessageId>-<index>` so a re-import
  overwrites rather than duplicates.
- `users/{uid}` — `email, displayName, photoURL, gmail {emailAddress,
  connectedAt, watchExpiration, historyId}`. `gmail` is server-written.
- `users/{uid}/settings/patterns` — `allow[], deny[]` sender domains.
- `users/{uid}/parsedMessages/{gmailMessageId}` — `outcome` (processing,
  filtered, not_booking, imported, failed), `reason, segmentIds[],
  processedAt`. Created atomically as `processing` before any work, so a
  message delivered twice is imported once; also the audit trail of what the
  LLM was shown.
- `users/{uid}/private/gmail` — the refresh token and watch state. Server
  only. `users/{uid}/private/import` is read and written by every import
  transaction, serializing trip assignment per user.
- `gmailAccounts/{emailAddress}` → `{uid}`; `oauthStates/{nonce}` → `{uid,
  createdAt}`. Server only.

Schemas live in `packages/core/src/schema.ts`; paths in `paths.ts`.

## Access rules

`firestore.rules`, tested in `packages/rules`:

- A trip is readable by its owner and by any signed-in user whose verified
  email is in `sharedWith`; writable and deletable by the owner only.
  Segments inherit the parent trip's access.
- A user reads and edits their own profile except the `gmail` field, owns
  their sender patterns, can read but not write their parsed-message log,
  and can never read `private`.
- `gmailAccounts` and `oauthStates` are closed to clients.
- The worker uses the Admin SDK and bypasses rules.

## Import pipeline

```
Gmail ─watch─▶ Pub/Sub ─push(OIDC)─▶ parser /internal/pubsub/gmail
                                        │ history.list since stored historyId
                                        ▼
                               create parsedMessages/{id} as "processing"
                                        │ already exists ─▶ skip
                                        │ created
                                        ▼
                               pre-filter: user deny list → user/seed allow
                               list → subject keywords, minus promotional
                               noise                       ── drop ─▶ record "filtered"
                                        │ pass
                                        ▼
                               Gemini, JSON-schema output, validated by
                               ExtractedBooking                ── throw ─▶ record "failed"
                                        │
                               isBooking && segments?          ── no ────▶ record "not_booking"
                                        │ yes
                                        ▼
                               transaction, serialized per user:
                               trip within 2 days of the booking's dates?
                               extend its bounds only : create one titled by
                               destination; write segments
                                        ▼
                               record "imported"
```

Cost control is the pre-filter plus the parsed-message record: an email is
shown to the model at most once, and only when it carries a booking signal.
The seed sender list is in `apps/parser/src/prefilter.ts`; users extend it
from Settings. The embedding-based pre-filter from the original brief is a
later step and would sit between the keyword check and the model call.

Backfill (`POST /gmail/backfill`) runs the same path over a Gmail search
limited to the last three years and booking-like subjects, capped at 300
messages per call.

Gmail watches expire after seven days; `/internal/renew-watches`, called
daily by Cloud Scheduler, renews those within two days of expiry. A history
id that has aged out logs a warning and resets to the notification's id; the
user can run a backfill to fill any gap.

## HTTP surface of the parser

| Route | Auth | Purpose |
|---|---|---|
| `POST /gmail/connect` | Firebase ID token | Returns the Google OAuth URL; stores a nonce for 10 minutes |
| `GET /gmail/callback` | OAuth state | Exchanges the code, starts the watch, stores the connection, redirects to `/settings` |
| `POST /gmail/backfill` | Firebase ID token | Imports past bookings; returns counts per outcome |
| `POST /gmail/disconnect` | Firebase ID token | Stops the watch, revokes the token, deletes the connection |
| `POST /internal/pubsub/gmail` | OIDC from `INTERNAL_CALLERS` | Pub/Sub push target |
| `POST /internal/renew-watches` | OIDC from `INTERNAL_CALLERS` | Cloud Scheduler target |
| `GET /healthz` | none | Liveness |

## Costs

Firebase Auth, Pub/Sub, Secret Manager and the Gmail API are free at this
scale. App Hosting and Cloud Run bill per request and idle at zero. Firestore
is the term that grows: one listener per trip list and per open trip. Gemini
Flash-Lite costs a fraction of a cent per booking email; a hundred users
importing fifty bookings a month is a few dollars. The rules tests and CI run
on GitHub-hosted runners.

## Later

Native apps (React Native + Expo in `apps/mobile`), reports (days out of
country, trips last year — via BigQuery export if Firestore aggregates get
clumsy), country map, calendar view and export, check-in/out surfacing,
ratings and favourites, itinerary ideas, loyalty balances, passport expiry
and visa reminders, other mail providers and forward-to-import.
