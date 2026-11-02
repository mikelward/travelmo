import { serve } from "@hono/node-server";
import { GoogleGenAI } from "@google/genai";
import { NotACalendar, NotATripItExport, parseIcs, parseTripItExport, paths, type GmailState } from "@travelmo/core";
import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  MailboxConflict,
  OtherMailboxConnected,
  createOAuthState,
  loadState,
  mailboxOwner,
  removeConnection,
  saveConnection,
  savePending,
  takeOAuthState,
  takePending,
  updateBackfill,
  updateHistoryId,
  updateWatch,
} from "./connections";
import { optionalEnv, requireEnv } from "./env";
import { geminiEmbedder, geminiExtractor } from "./extract";
import { auth, db } from "./firebase";
import {
  currentHistoryId,
  fetchMessage,
  gmailFor,
  gmailScopes,
  isNotFound,
  listAddedSince,
  oauthClient,
  isBadRequest,
  searchMessagePage,
  stopWatch,
  watch,
  type OAuthConfig,
} from "./gmail";
import { importCalendar, importMessage, importMessages, importTripIt, type ImportDeps, type ImportOptions } from "./importer";
import { errorFields, log } from "./log";
import { BadPushEnvelope, parseGmailPush, type GmailNotification } from "./pubsub";
import { firestoreStore } from "./store";
import { FeedLimitReached, addFeed, feedFailure, firestoreFeeds, pollAllFeeds, type FeedIo } from "./feeds";
import { fetchFeed } from "./safefetch";
import { backfillBatch, backfillQuery, runBackfillBatch } from "./backfill";

const webOrigin = requireEnv("WEB_ORIGIN");
const pubsubTopic = requireEnv("GMAIL_PUBSUB_TOPIC");
const oauth: OAuthConfig = {
  clientId: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
  clientSecret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
  redirectUrl: requireEnv("GOOGLE_OAUTH_REDIRECT_URL"),
};
// Pub/Sub push and Cloud Scheduler call with an OIDC token for this audience
// from one of these service accounts; nothing else may hit /internal.
const internalAudience = requireEnv("INTERNAL_AUDIENCE");
const internalCallers = new Set(requireEnv("INTERNAL_CALLERS").split(",").map((s) => s.trim()));
const geminiModel = optionalEnv("GEMINI_MODEL", "gemini-flash-lite-latest");
const embeddingModel = optionalEnv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001");
const genai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : new GoogleGenAI({
      vertexai: true,
      project: requireEnv("GOOGLE_CLOUD_PROJECT"),
      location: optionalEnv("GOOGLE_CLOUD_LOCATION", "europe-west1"),
    });


const deps: ImportDeps = {
  store: firestoreStore(db),
  extract: geminiExtractor(genai, geminiModel),
  embed: geminiEmbedder(genai, embeddingModel),
  now: () => new Date().toISOString(),
  log: (event, fields) => log("INFO", event, fields),
};

type Env = { Variables: { uid: string } };
const app = new Hono<Env>();

app.use("/gmail/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/import/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/feeds/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));

app.get("/healthz", (c) => c.text("ok"));

function bearer(c: Context<Env>): string {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new HTTPException(401, { message: "Missing bearer token" });
  return header.slice(7);
}

async function requireUser(c: Context<Env>): Promise<string> {
  const token = bearer(c);
  try {
    return (await auth.verifyIdToken(token)).uid;
  } catch (error) {
    log("WARNING", "bad_id_token", errorFields(error));
    throw new HTTPException(401, { message: "Invalid token" });
  }
}

async function requireInternalCaller(c: Context<Env>): Promise<void> {
  const token = bearer(c);
  try {
    const ticket = await oauthClient(oauth).verifyIdToken({ idToken: token, audience: internalAudience });
    const payload = ticket.getPayload();
    if (!payload?.email_verified || !payload.email || !internalCallers.has(payload.email)) {
      throw new Error(`caller ${payload?.email ?? "unknown"} not allowed`);
    }
  } catch (error) {
    log("WARNING", "bad_internal_token", errorFields(error));
    throw new HTTPException(403, { message: "Forbidden" });
  }
}

async function revokeQuietly(refreshToken: string, uid: string): Promise<void> {
  try {
    await oauthClient(oauth).revokeToken(refreshToken);
  } catch (error) {
    log("WARNING", "revoke_failed", { uid, ...errorFields(error) });
  }
}

app.post("/gmail/connect", async (c) => {
  const uid = await requireUser(c);
  const nonce = randomBytes(24).toString("base64url");
  await createOAuthState(db, nonce, uid, new Date().toISOString());
  const url = oauthClient(oauth).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: gmailScopes,
    state: nonce,
  });
  return c.json({ url });
});

// Google sends the browser here with no Travelmo credentials, so the tokens
// are parked under a one-time code and the signed-in web app must claim them
// from /gmail/complete; the claimant's uid has to match the initiator's.
app.get("/gmail/callback", async (c) => {
  const code = c.req.query("code");
  const nonce = c.req.query("state");
  if (c.req.query("error")) return c.redirect(`${webOrigin}/settings?gmail=denied`);
  if (!code || !nonce) throw new HTTPException(400, { message: "Missing code or state" });

  const state = await takeOAuthState(db, nonce, Date.now());
  if (!state) throw new HTTPException(400, { message: "Unknown or expired state" });

  const { tokens } = await oauthClient(oauth).getToken(code);
  if (!tokens.refresh_token) {
    log("ERROR", "no_refresh_token", { uid: state.uid });
    return c.redirect(`${webOrigin}/settings?gmail=error`);
  }
  const completion = randomBytes(24).toString("base64url");
  await savePending(db, completion, { uid: state.uid, refreshToken: tokens.refresh_token, createdAt: new Date().toISOString() });
  return c.redirect(`${webOrigin}/settings?gmail=pending&state=${completion}`);
});

app.post("/gmail/complete", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { state?: string };
  if (!body.state) throw new HTTPException(400, { message: "Missing state" });
  const pending = await takePending(db, body.state, Date.now());
  if (!pending) throw new HTTPException(400, { message: "Unknown or expired state" });
  if (pending.uid !== uid) {
    log("WARNING", "completion_uid_mismatch", { uid, initiator: pending.uid });
    await revokeQuietly(pending.refreshToken, uid);
    throw new HTTPException(403, { message: "This connection was started by a different account" });
  }

  const gmail = gmailFor(oauth, pending.refreshToken);
  const profile = await currentHistoryId(gmail);
  // The watch is per mailbox, not per token, so it is never touched until
  // ownership is settled: stopping it here would silence the real owner.
  const owner = await mailboxOwner(db, profile.emailAddress);
  if (owner !== undefined && owner !== uid) {
    await revokeQuietly(pending.refreshToken, uid);
    throw new HTTPException(409, { message: new MailboxConflict(profile.emailAddress).message });
  }
  // Connecting a different mailbox replaces the old one, watch and token included.
  const previous = await loadState(db, uid);
  if (previous && previous.emailAddress !== profile.emailAddress) await disconnect(uid, previous);
  try {
    const watched = await watch(gmail, pubsubTopic);
    await saveConnection(db, uid, {
      refreshToken: pending.refreshToken,
      emailAddress: profile.emailAddress,
      connectedAt: new Date().toISOString(),
      historyId: watched.historyId,
      watchExpiration: watched.expiration,
    });
  } catch (error) {
    // The watch, if started, points at our own topic and is left alone.
    await revokeQuietly(pending.refreshToken, uid);
    if (error instanceof MailboxConflict || error instanceof OtherMailboxConnected) {
      throw new HTTPException(409, { message: error.message });
    }
    throw error;
  }
  log("INFO", "gmail_connected", { uid });
  return c.json({ emailAddress: profile.emailAddress });
});

async function disconnect(uid: string, state: GmailState): Promise<void> {
  try {
    await stopWatch(gmailFor(oauth, state.refreshToken));
  } catch (error) {
    log("WARNING", "stop_watch_failed", { uid, ...errorFields(error) });
  }
  await revokeQuietly(state.refreshToken, uid);
  await removeConnection(db, uid, state.emailAddress);
}

app.post("/gmail/disconnect", async (c) => {
  const uid = await requireUser(c);
  const state = await loadState(db, uid);
  if (state) await disconnect(uid, state);
  return c.body(null, 204);
});

function importIds(uid: string, gmail: ReturnType<typeof gmailFor>, ids: readonly string[], options: ImportOptions = {}) {
  return importMessages(uid, ids, (id) => fetchMessage(gmail, id), deps, options);
}

// One batch of reading the whole mailbox: it carries on from where the last
// batch stopped (or starts over when asked), and records how far it got on
// the connection, where Settings shows it. The page calls this until done.
app.post("/gmail/backfill", async (c) => {
  const uid = await requireUser(c);
  const state = await loadState(db, uid);
  if (!state) throw new HTTPException(409, { message: "Gmail not connected" });
  const body = (await c.req.json().catch(() => ({}))) as { restart?: unknown };
  const gmail = gmailFor(oauth, state.refreshToken);
  const batch = await runBackfillBatch(state.backfill, body.restart === true, {
    page: (token) => searchMessagePage(gmail, backfillQuery, backfillBatch, token),
    // An email whose import failed (the model was down, say) is read again
    // when the reading passes it again, as after starting over.
    importIds: (ids) => importIds(uid, gmail, ids, { retryFailed: true }),
    isStaleCursor: isBadRequest,
    now: () => new Date().toISOString(),
    log: (event, fields) => log("WARNING", event, { uid, ...fields }),
  });
  if (!(await updateBackfill(db, uid, state.emailAddress, batch.progress))) {
    log("WARNING", "backfill_for_disconnected_user", { uid });
  }
  const { cursor: _cursor, ...progress } = batch.progress;
  log("INFO", "backfill", { uid, candidates: batch.candidates, ...batch.counts, ...progress });
  return c.json({ candidates: batch.candidates, ...batch.counts, progress });
});

// A second look at one message the user picked from the review list: the
// pre-filter is skipped, and an earlier non-booking outcome no longer stands
// in the way. An import already under way, or already done, does.
app.post("/gmail/reimport", async (c) => {
  const uid = await requireUser(c);
  const state = await loadState(db, uid);
  if (!state) throw new HTTPException(409, { message: "Gmail not connected" });
  const body = (await c.req.json().catch(() => ({}))) as { messageId?: string };
  if (!body.messageId) throw new HTTPException(400, { message: "Missing messageId" });
  const gmail = gmailFor(oauth, state.refreshToken);
  let message;
  try {
    message = await fetchMessage(gmail, body.messageId);
  } catch (error) {
    if (isNotFound(error)) throw new HTTPException(404, { message: "That email is no longer in Gmail" });
    throw error;
  }
  const outcome = await importMessage(uid, message, deps, { force: true, reclaim: true });
  log("INFO", "reimport", { uid, messageId: message.id, outcome });
  if (outcome === "skipped") {
    throw new HTTPException(409, { message: "That email is already imported or being imported right now" });
  }
  return c.json({ outcome });
});

// A whole account's history is a few megabytes of JSON; well past that is
// not a TripIt export.
const tripItMaxBytes = 20 * 1024 * 1024;

// The Settings page has already shown the user what the file holds (the
// same mapping, run in the browser); this writes it. Each TripIt trip is
// recorded once, so uploading the same file again changes nothing.
app.post(
  "/import/tripit",
  bodyLimit({
    maxSize: tripItMaxBytes,
    onError: () => {
      throw new HTTPException(413, { message: "That file is too large to be a TripIt export" });
    },
  }),
  async (c) => {
    const uid = await requireUser(c);
    const body = (await c.req.json().catch(() => undefined)) as { export?: unknown } | undefined;
    let parsed;
    try {
      parsed = parseTripItExport(body?.export);
    } catch (error) {
      if (error instanceof NotATripItExport) throw new HTTPException(400, { message: error.message });
      throw error;
    }
    const counts = await importTripIt(uid, parsed, deps);
    const result = { ...counts, notImported: parsed.skipped.length };
    log("INFO", "tripit_import", { uid, ...result });
    return c.json(result);
  },
);

const icsMaxBytes = 10 * 1024 * 1024;
// Events read by the model per request, as for a backfill: enough for a
// trip export, and a whole calendar's history comes in over a few uploads.
const icsMaxRead = 100;

// An uploaded calendar file, read like email: each event is recorded once,
// so uploading the same file again reads only what the last upload did not
// reach.
app.post(
  "/import/ics",
  bodyLimit({
    maxSize: icsMaxBytes,
    onError: () => {
      throw new HTTPException(413, { message: "That calendar file is too large" });
    },
  }),
  async (c) => {
    const uid = await requireUser(c);
    const body = (await c.req.json().catch(() => undefined)) as { text?: unknown } | undefined;
    if (typeof body?.text !== "string") throw new HTTPException(400, { message: "Missing calendar text" });
    let calendar;
    try {
      calendar = parseIcs(body.text);
    } catch (error) {
      if (error instanceof NotACalendar) throw new HTTPException(400, { message: error.message });
      throw error;
    }
    const counts = await importCalendar(uid, calendar, deps, icsMaxRead);
    log("INFO", "ics_import", { uid, events: calendar.events.length, ...counts });
    return c.json(counts);
  },
);

const feedIo: FeedIo = { feeds: firestoreFeeds(db), fetchText: (url) => fetchFeed(url), deps };

// Subscribes to a calendar feed: the link is checked (https, public
// address) and read at once, so a wrong one is refused while the user waits.
app.post("/feeds/add", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => undefined)) as { url?: unknown; label?: unknown } | undefined;
  if (typeof body?.url !== "string") throw new HTTPException(400, { message: "Missing feed address" });
  const label = typeof body.label === "string" ? body.label : undefined;
  try {
    const { feed, counts } = await addFeed(uid, body.url, label, feedIo);
    return c.json({ id: feed.id, ...counts });
  } catch (error) {
    if (error instanceof FeedLimitReached) throw new HTTPException(409, { message: error.message });
    const message = feedFailure(error);
    if (message) throw new HTTPException(400, { message });
    throw error;
  }
});

// Stops polling a feed. Bookings it brought in stay.
app.post("/feeds/remove", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => undefined)) as { id?: unknown } | undefined;
  if (typeof body?.id !== "string" || !body.id) throw new HTTPException(400, { message: "Missing feed id" });
  await feedIo.feeds.remove(uid, body.id);
  log("INFO", "feed_removed", { uid, feedId: body.id });
  return c.body(null, 204);
});

// Cloud Scheduler calls this daily (deploy/scheduler.sh).
app.post("/internal/poll-feeds", async (c) => {
  await requireInternalCaller(c);
  const result = await pollAllFeeds(feedIo);
  log("INFO", "feeds_polled", result);
  return c.json(result);
});

// A non-2xx response makes Pub/Sub redeliver; after the subscription's
// maximum attempts the notification lands on the dead-letter topic, which
// is alerted on (deploy/monitoring.sh). Nothing is lost with it: the next
// notification resumes from the stored history id.
app.post("/internal/pubsub/gmail", async (c) => {
  await requireInternalCaller(c);
  let notification: GmailNotification;
  try {
    notification = parseGmailPush(await c.req.json());
  } catch (error) {
    if (error instanceof BadPushEnvelope) throw new HTTPException(400, { message: error.message });
    throw error;
  }
  const { pubsubMessageId, deliveryAttempt } = notification;

  try {
    const account = await db.doc(paths.gmailAccount(notification.emailAddress)).get();
    const uid = (account.data() as { uid?: string } | undefined)?.uid;
    if (!uid) {
      log("WARNING", "notification_for_unknown_account", { pubsubMessageId });
      return c.body(null, 204);
    }
    const state = await loadState(db, uid);
    if (!state) return c.body(null, 204);

    const gmail = gmailFor(oauth, state.refreshToken);
    const since = state.historyId ?? notification.historyId;
    const result = await listAddedSince(gmail, since);
    if (result === "expired") {
      log("WARNING", "history_expired", { uid, since });
      await updateHistoryId(db, uid, state.emailAddress, notification.historyId);
      return c.body(null, 204);
    }
    const counts = await importIds(uid, gmail, result.messageIds);
    if (!(await updateHistoryId(db, uid, state.emailAddress, result.historyId))) {
      log("WARNING", "notification_for_disconnected_user", { uid });
    }
    log("INFO", "notification_processed", {
      uid,
      pubsubMessageId,
      deliveryAttempt,
      messages: result.messageIds.length,
      ...counts,
    });
    return c.body(null, 204);
  } catch (error) {
    log("ERROR", "notification_failed", { pubsubMessageId, deliveryAttempt, ...errorFields(error) });
    throw error;
  }
});

// Gmail watches last seven days; Cloud Scheduler calls this daily.
app.post("/internal/renew-watches", async (c) => {
  await requireInternalCaller(c);
  const soon = Date.now() + 2 * 24 * 60 * 60 * 1000;
  const accounts = await db.collection("gmailAccounts").get();
  let renewed = 0;
  for (const doc of accounts.docs) {
    const uid = (doc.data() as { uid: string }).uid;
    const state = await loadState(db, uid);
    if (!state) continue;
    if (state.watchExpiration && Date.parse(state.watchExpiration) > soon) continue;
    try {
      const watched = await watch(gmailFor(oauth, state.refreshToken), pubsubTopic);
      if (await updateWatch(db, uid, state.emailAddress, watched.expiration)) renewed += 1;
      else log("WARNING", "renewed_watch_for_disconnected_user", { uid });
    } catch (error) {
      log("ERROR", "renew_watch_failed", { uid, ...errorFields(error) });
    }
  }
  log("INFO", "watches_renewed", { renewed, accounts: accounts.size });
  return c.json({ renewed });
});

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (c.req.path !== "/internal/pubsub/gmail") log("ERROR", "unhandled", { path: c.req.path, ...errorFields(error) });
  return c.text("Internal error", 500);
});

const port = Number(optionalEnv("PORT", "8080"));
serve({ fetch: app.fetch, port }, () => log("INFO", "listening", { port, geminiModel, embeddingModel }));
