import { serve } from "@hono/node-server";
import { GoogleGenAI } from "@google/genai";
import { NotACalendar, NotATripItExport, parseIcs, parseTripItExport, paths, type GmailState, type GoogleCalendarChoice } from "@travelmo/core";
import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  MailboxConflict,
  OtherMailboxConnected,
  calendarUsers,
  createOAuthState,
  loadCalendarState,
  loadEventAliases,
  loadState,
  mailboxOwner,
  removeCalendarState,
  removeConnection,
  revocable,
  saveCalendarState,
  saveEventAliases,
  saveConnection,
  savePending,
  takeOAuthState,
  takePending,
  updateBackfill,
  updateCalendars,
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
import { LeaseLost, UploadRunning, withUploadLease } from "./leases";
import {
  calendarFor,
  calendarScopes,
  listCalendars,
  listEvents,
  mergeCalendarList,
  readCalendar,
  sameAccount,
  withResults,
  type CalendarIo,
} from "./googleCalendar";

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
app.use("/calendar/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
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

// Gives up a token we will not keep. Revoking it would withdraw the user's
// whole grant (see `revocable`), so it is revoked only when nothing else of
// theirs uses that Google account; otherwise it is just dropped.
async function releaseToken(refreshToken: string, uid: string, emailAddress?: string): Promise<void> {
  const connections = await Promise.all([loadState(db, uid), loadCalendarState(db, uid)]);
  if (!revocable(refreshToken, emailAddress, connections)) {
    log("INFO", "revoke_skipped_shared_grant", { uid });
    return;
  }
  await revokeQuietly(refreshToken, uid);
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
  // Gmail and Calendar consents share this callback; the state says which.
  const state = nonce ? await takeOAuthState(db, nonce, Date.now()) : undefined;
  const purpose = state?.purpose ?? "gmail";
  if (c.req.query("error")) return c.redirect(`${webOrigin}/settings?${purpose}=denied`);
  if (!code || !nonce) throw new HTTPException(400, { message: "Missing code or state" });
  if (!state) throw new HTTPException(400, { message: "Unknown or expired state" });

  const { tokens } = await oauthClient(oauth).getToken(code);
  if (!tokens.refresh_token) {
    log("ERROR", "no_refresh_token", { uid: state.uid, purpose });
    return c.redirect(`${webOrigin}/settings?${purpose}=error`);
  }
  const completion = randomBytes(24).toString("base64url");
  await savePending(db, completion, { uid: state.uid, refreshToken: tokens.refresh_token, createdAt: new Date().toISOString(), purpose });
  return c.redirect(`${webOrigin}/settings?${purpose}=pending&state=${completion}`);
});

// Redeems a parked consent for the signed-in user who started it, for the
// purpose it was granted for.
async function claimPending(uid: string, token: string, purpose: "gmail" | "calendar") {
  const pending = await takePending(db, token, Date.now());
  if (!pending) throw new HTTPException(400, { message: "Unknown or expired state" });
  if (pending.uid !== uid) {
    log("WARNING", "completion_uid_mismatch", { uid, initiator: pending.uid });
    await releaseToken(pending.refreshToken, pending.uid);
    throw new HTTPException(403, { message: "This connection was started by a different account" });
  }
  if ((pending.purpose ?? "gmail") !== purpose) {
    await releaseToken(pending.refreshToken, uid);
    throw new HTTPException(400, { message: "That consent was for something else" });
  }
  return pending;
}

app.post("/gmail/complete", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { state?: string };
  if (!body.state) throw new HTTPException(400, { message: "Missing state" });
  const pending = await claimPending(uid, body.state, "gmail");

  const gmail = gmailFor(oauth, pending.refreshToken);
  const profile = await currentHistoryId(gmail);
  // The watch is per mailbox, not per token, so it is never touched until
  // ownership is settled: stopping it here would silence the real owner.
  const owner = await mailboxOwner(db, profile.emailAddress);
  if (owner !== undefined && owner !== uid) {
    await releaseToken(pending.refreshToken, uid, profile.emailAddress);
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
    await releaseToken(pending.refreshToken, uid, profile.emailAddress);
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
  await releaseToken(state.refreshToken, uid, state.emailAddress);
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

function calendarIo(uid: string, refreshToken: string, mailboxImported: boolean): CalendarIo {
  const api = calendarFor(oauth, refreshToken);
  return {
    events: (id) => listEvents(api, id),
    aliases: { load: (id) => loadEventAliases(db, uid, id), save: (id, aliases) => saveEventAliases(db, uid, id, aliases) },
    mailboxImported,
    deps,
  };
}

// Reads the chosen calendars of one user and records how each went; only
// those in `only` when given.
async function readCalendars(uid: string, only?: ReadonlySet<string>): Promise<{ read: number; failed: number }> {
  const state = await loadCalendarState(db, uid);
  if (!state) return { read: 0, failed: 0 };
  const io = calendarIo(uid, state.refreshToken, sameAccount((await loadState(db, uid))?.emailAddress, state.emailAddress));
  const results: GoogleCalendarChoice[] = [];
  for (const choice of state.calendars) {
    if (!choice.selected || (only && !only.has(choice.id))) continue;
    results.push(await readCalendar(uid, choice, io));
  }
  if (results.length && !(await updateCalendars(db, uid, state.emailAddress, (current) => withResults(current, results)))) {
    log("WARNING", "calendar_read_for_disconnected_user", { uid });
  }
  return { read: results.length, failed: results.filter((r) => r.lastError).length };
}

app.post("/calendar/connect", async (c) => {
  const uid = await requireUser(c);
  const nonce = randomBytes(24).toString("base64url");
  await createOAuthState(db, nonce, uid, new Date().toISOString(), "calendar");
  const url = oauthClient(oauth).generateAuthUrl({ access_type: "offline", prompt: "consent", scope: calendarScopes, state: nonce });
  return c.json({ url });
});

// Lists the account's calendars, none chosen yet: the user picks which hold
// travel, so a busy work calendar is not read unasked.
app.post("/calendar/complete", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { state?: string };
  if (!body.state) throw new HTTPException(400, { message: "Missing state" });
  const pending = await claimPending(uid, body.state, "calendar");
  let listed;
  try {
    listed = await listCalendars(calendarFor(oauth, pending.refreshToken));
  } catch (error) {
    await releaseToken(pending.refreshToken, uid);
    throw error;
  }
  const emailAddress = listed.find((l) => l.primary)?.id ?? "Google Calendar";
  const previous = await loadCalendarState(db, uid);
  // Connecting again keeps the choices for the same account. The old token
  // of the same account is only dropped: revoking it would revoke the grant
  // the new token rests on. Another account's is revoked unless Gmail uses
  // that account.
  if (previous && previous.refreshToken !== pending.refreshToken && previous.emailAddress !== emailAddress) {
    await releaseToken(previous.refreshToken, uid, previous.emailAddress);
  }
  const kept = previous?.emailAddress === emailAddress ? previous.calendars : [];
  await saveCalendarState(db, uid, {
    refreshToken: pending.refreshToken,
    emailAddress,
    connectedAt: new Date().toISOString(),
    calendars: mergeCalendarList(kept, listed),
  });
  log("INFO", "google_calendar_connected", { uid, calendars: listed.length });
  return c.json({ emailAddress, calendars: listed.length });
});

// Sets which calendars are read, then reads the newly chosen ones at once
// so the user sees what they hold.
app.post("/calendar/select", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(body.ids) || !body.ids.every((id) => typeof id === "string")) {
    throw new HTTPException(400, { message: "Missing calendar ids" });
  }
  const chosen = new Set(body.ids as string[]);
  const state = await loadCalendarState(db, uid);
  if (!state) throw new HTTPException(409, { message: "Google Calendar not connected" });
  const newly = new Set(state.calendars.filter((cal) => chosen.has(cal.id) && !cal.selected).map((cal) => cal.id));
  const saved = await updateCalendars(db, uid, state.emailAddress, (current) =>
    current.map((cal) => ({ ...cal, selected: chosen.has(cal.id) })),
  );
  if (!saved) throw new HTTPException(409, { message: "Google Calendar not connected" });
  const result = newly.size ? await readCalendars(uid, newly) : { read: 0, failed: 0 };
  log("INFO", "google_calendars_selected", { uid, selected: chosen.size, ...result });
  return c.json(result);
});

// Stops reading Google Calendar and withdraws the token. Bookings stay.
app.post("/calendar/disconnect", async (c) => {
  const uid = await requireUser(c);
  const state = await loadCalendarState(db, uid);
  if (state) {
    await releaseToken(state.refreshToken, uid, state.emailAddress);
    await removeCalendarState(db, uid, state.calendars.map((cal) => cal.id));
  }
  return c.body(null, 204);
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
    // One TripIt upload at a time per user, so its one-to-one matching holds
    // across them too (leases.ts); a second gets a 409 to try again.
    let counts;
    try {
      counts = await withUploadLease(db, uid, "tripit", randomBytes(12).toString("base64url"), (lease) =>
        importTripIt(uid, parsed, deps, { beforeEach: () => lease.assertHeld() }),
      );
    } catch (error) {
      if (error instanceof UploadRunning || error instanceof LeaseLost) throw new HTTPException(409, { message: error.message });
      throw error;
    }
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
  // Google calendars ride the same daily job: one user's failure is logged
  // and the rest carry on.
  const calendars = { users: 0, read: 0, failed: 0 };
  for (const uid of await calendarUsers(db)) {
    try {
      const state = await loadCalendarState(db, uid);
      if (state) {
        // New calendars the user made since appear in the picker. If the
        // list cannot be had, the reads below still run and record why
        // each chosen calendar failed, where its owner sees it.
        try {
          const listed = await listCalendars(calendarFor(oauth, state.refreshToken));
          await updateCalendars(db, uid, state.emailAddress, (current) => mergeCalendarList(current, listed));
        } catch (error) {
          log("WARNING", "google_calendar_list_failed", { uid, ...errorFields(error) });
        }
      }
      const counts = await readCalendars(uid);
      calendars.users += 1;
      calendars.read += counts.read;
      calendars.failed += counts.failed;
    } catch (error) {
      calendars.failed += 1;
      log("ERROR", "google_calendar_poll_failed", { uid, ...errorFields(error) });
    }
  }
  log("INFO", "google_calendars_polled", calendars);
  return c.json({ ...result, calendars });
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
