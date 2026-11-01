import { serve } from "@hono/node-server";
import { GoogleGenAI } from "@google/genai";
import { GmailState, paths, type GmailConnection } from "@travelmo/core";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { optionalEnv, requireEnv } from "./env";
import { geminiExtractor } from "./extract";
import { auth, db } from "./firebase";
import {
  currentHistoryId,
  fetchMessage,
  gmailFor,
  gmailScopes,
  listAddedSince,
  oauthClient,
  searchMessageIds,
  stopWatch,
  watch,
  type OAuthConfig,
} from "./gmail";
import { importMessage, type ImportDeps, type ImportOutcome } from "./importer";
import { errorFields, log } from "./log";
import { firestoreStore } from "./store";

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
const genai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : new GoogleGenAI({
      vertexai: true,
      project: requireEnv("GOOGLE_CLOUD_PROJECT"),
      location: optionalEnv("GOOGLE_CLOUD_LOCATION", "europe-west1"),
    });

const backfillQuery =
  "newer_than:3y -in:spam -in:trash {subject:booking subject:reservation subject:confirmation subject:confirmed subject:itinerary subject:ticket subject:tickets subject:flight subject:hotel subject:rental subject:check-in subject:\"boarding pass\"}";
const backfillMax = 300;
const oauthStateTtlMs = 10 * 60 * 1000;

const deps: ImportDeps = {
  store: firestoreStore(db),
  extract: geminiExtractor(genai, geminiModel),
  now: () => new Date().toISOString(),
  log: (event, fields) => log("INFO", event, fields),
};

type Env = { Variables: { uid: string } };
const app = new Hono<Env>();

app.use("/gmail/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));

app.get("/healthz", (c) => c.text("ok"));

async function requireUser(c: Context<Env>): Promise<string> {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw new HTTPException(401, { message: "Missing bearer token" });
  try {
    return (await auth.verifyIdToken(token)).uid;
  } catch (error) {
    log("WARNING", "bad_id_token", errorFields(error));
    throw new HTTPException(401, { message: "Invalid token" });
  }
}

async function requireInternalCaller(c: Context<Env>): Promise<void> {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw new HTTPException(401, { message: "Missing bearer token" });
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

async function gmailState(uid: string) {
  const snap = await db.doc(paths.gmailState(uid)).get();
  return snap.exists ? GmailState.parse(snap.data()) : undefined;
}

async function saveConnection(uid: string, state: GmailState): Promise<void> {
  const { refreshToken: _token, ...publicState } = state;
  const connection: GmailConnection = publicState;
  const batch = db.batch();
  batch.set(db.doc(paths.gmailState(uid)), state);
  batch.set(db.doc(paths.user(uid)), { gmail: connection }, { merge: true });
  batch.set(db.doc(paths.gmailAccount(state.emailAddress)), { uid });
  await batch.commit();
}

app.post("/gmail/connect", async (c) => {
  const uid = await requireUser(c);
  const nonce = randomBytes(24).toString("base64url");
  await db.doc(paths.oauthState(nonce)).set({ uid, createdAt: new Date().toISOString() });
  const url = oauthClient(oauth).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: gmailScopes,
    state: nonce,
  });
  return c.json({ url });
});

app.get("/gmail/callback", async (c) => {
  const code = c.req.query("code");
  const nonce = c.req.query("state");
  const denied = c.req.query("error");
  if (denied) return c.redirect(`${webOrigin}/settings?gmail=denied`);
  if (!code || !nonce) throw new HTTPException(400, { message: "Missing code or state" });

  const stateRef = db.doc(paths.oauthState(nonce));
  const stateSnap = await stateRef.get();
  const state = stateSnap.data() as { uid: string; createdAt: string } | undefined;
  await stateRef.delete();
  if (!state || Date.now() - Date.parse(state.createdAt) > oauthStateTtlMs) {
    throw new HTTPException(400, { message: "Unknown or expired state" });
  }

  const client = oauthClient(oauth);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    log("ERROR", "no_refresh_token", { uid: state.uid });
    return c.redirect(`${webOrigin}/settings?gmail=error`);
  }
  const gmail = gmailFor(oauth, tokens.refresh_token);
  const profile = await currentHistoryId(gmail);
  const watched = await watch(gmail, pubsubTopic);
  await saveConnection(state.uid, {
    refreshToken: tokens.refresh_token,
    emailAddress: profile.emailAddress,
    connectedAt: new Date().toISOString(),
    historyId: watched.historyId,
    watchExpiration: watched.expiration,
  });
  log("INFO", "gmail_connected", { uid: state.uid });
  return c.redirect(`${webOrigin}/settings?gmail=connected`);
});

app.post("/gmail/disconnect", async (c) => {
  const uid = await requireUser(c);
  const state = await gmailState(uid);
  if (state) {
    const gmail = gmailFor(oauth, state.refreshToken);
    try {
      await stopWatch(gmail);
      await oauthClient(oauth).revokeToken(state.refreshToken);
    } catch (error) {
      log("WARNING", "disconnect_cleanup_failed", { uid, ...errorFields(error) });
    }
    const batch = db.batch();
    batch.delete(db.doc(paths.gmailState(uid)));
    batch.delete(db.doc(paths.gmailAccount(state.emailAddress)));
    batch.set(db.doc(paths.user(uid)), { gmail: FieldValue.delete() }, { merge: true });
    await batch.commit();
  }
  return c.body(null, 204);
});

type Counts = Record<ImportOutcome, number>;
const emptyCounts = (): Counts => ({ skipped: 0, filtered: 0, not_booking: 0, imported: 0, failed: 0 });

async function importIds(uid: string, gmail: ReturnType<typeof gmailFor>, ids: readonly string[]): Promise<Counts> {
  const counts = emptyCounts();
  for (const id of ids) {
    const message = await fetchMessage(gmail, id);
    counts[await importMessage(uid, message, deps)] += 1;
  }
  return counts;
}

app.post("/gmail/backfill", async (c) => {
  const uid = await requireUser(c);
  const state = await gmailState(uid);
  if (!state) throw new HTTPException(409, { message: "Gmail not connected" });
  const body = (await c.req.json().catch(() => ({}))) as { query?: string; max?: number };
  const max = Math.min(backfillMax, Math.max(1, body.max ?? backfillMax));
  const gmail = gmailFor(oauth, state.refreshToken);
  const ids = await searchMessageIds(gmail, body.query ?? backfillQuery, max);
  const counts = await importIds(uid, gmail, ids);
  log("INFO", "backfill", { uid, candidates: ids.length, ...counts });
  return c.json({ candidates: ids.length, ...counts });
});

app.post("/internal/pubsub/gmail", async (c) => {
  await requireInternalCaller(c);
  const envelope = (await c.req.json()) as { message?: { data?: string; messageId?: string } };
  const data = envelope.message?.data;
  if (!data) throw new HTTPException(400, { message: "No Pub/Sub message data" });
  const notification = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as {
    emailAddress: string;
    historyId: number | string;
  };

  const account = await db.doc(paths.gmailAccount(notification.emailAddress)).get();
  const uid = (account.data() as { uid?: string } | undefined)?.uid;
  if (!uid) {
    log("WARNING", "notification_for_unknown_account", { pubsubMessageId: envelope.message?.messageId });
    return c.body(null, 204);
  }
  const state = await gmailState(uid);
  if (!state) return c.body(null, 204);

  const gmail = gmailFor(oauth, state.refreshToken);
  const since = state.historyId ?? String(notification.historyId);
  const result = await listAddedSince(gmail, since);
  if (result === "expired") {
    log("WARNING", "history_expired", { uid, since });
    await db.doc(paths.gmailState(uid)).set({ historyId: String(notification.historyId) }, { merge: true });
    return c.body(null, 204);
  }
  const counts = await importIds(uid, gmail, result.messageIds);
  await db.doc(paths.gmailState(uid)).set({ historyId: result.historyId }, { merge: true });
  log("INFO", "notification_processed", { uid, messages: result.messageIds.length, ...counts });
  return c.body(null, 204);
});

// Gmail watches last seven days; Cloud Scheduler calls this daily.
app.post("/internal/renew-watches", async (c) => {
  await requireInternalCaller(c);
  const soon = Date.now() + 2 * 24 * 60 * 60 * 1000;
  const accounts = await db.collection("gmailAccounts").get();
  let renewed = 0;
  for (const doc of accounts.docs) {
    const uid = (doc.data() as { uid: string }).uid;
    const state = await gmailState(uid);
    if (!state) continue;
    if (state.watchExpiration && Date.parse(state.watchExpiration) > soon) continue;
    try {
      const watched = await watch(gmailFor(oauth, state.refreshToken), pubsubTopic);
      await saveConnection(uid, { ...state, watchExpiration: watched.expiration });
      renewed += 1;
    } catch (error) {
      log("ERROR", "renew_watch_failed", { uid, ...errorFields(error) });
    }
  }
  log("INFO", "watches_renewed", { renewed, accounts: accounts.size });
  return c.json({ renewed });
});

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  log("ERROR", "unhandled", { path: c.req.path, ...errorFields(error) });
  return c.text("Internal error", 500);
});

const port = Number(optionalEnv("PORT", "8080"));
serve({ fetch: app.fetch, port }, () => log("INFO", "listening", { port, geminiModel }));
