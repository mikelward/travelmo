// First, so every module below reads the trimmed environment.
import "./envTrim";
import { serve } from "@hono/node-server";
import { GoogleGenAI } from "@google/genai";
import {
  NotACalendar,
  NotATripItExport,
  extractTripItProfile,
  isEmptyProfile,
  parseIcs,
  parseTripItExport,
  imapRedirect,
  imapServerFor,
  mailboxKey,
  maxGmailMailboxes,
  maxImapMailboxes,
  parseImapRecordId,
  imapRecordKey,
  parseImapServer,
  paths,
  sourceMailbox,
  type GmailState,
  type ImapState,
  type GoogleCalendarChoice,
  type ImportedProfile,
  type LinkRefusal,
  type ParsedMessage,
  bugReportLimits,
  bugReportPath,
  checkBugReport,
} from "@travelmo/core";
import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { DecodedIdToken } from "firebase-admin/auth";
import { approvedUid, gateLinking, gateUser, grandfatherOnStart, onlyApproved, settleAccess, verifiedEmailOf } from "./access";
import { deleteAccount } from "./account";
import { LinkRefused, addressesOf, confirmLink, removeLink, requestLink, uidForAddress } from "./emails";
import {
  MailboxConflict,
  TooManyMailboxes,
  calendarUsers,
  createOAuthState,
  loadCalendarState,
  loadEventAliases,
  loadMailbox,
  loadMailboxes,
  mailboxOwner,
  moveLegacyMailboxes,
  resolveMailbox,
  removeCalendarState,
  removeConnection,
  revocable,
  saveCalendarState,
  saveEventAliases,
  saveConnection,
  savePending,
  takeOAuthState,
  takePending,
  changeBackfill,
  updateCalendars,
  updateHistoryId,
  updateWatch,
} from "./connections";
import { AccountDeletedError, deletedAccountText } from "./deleted";
import { optionalEnv, requireEnv } from "./env";
import { geminiEmbedder, geminiExtractor } from "./extract";
import { cachedGeocoder, defaultDailyLimit, firestoreGeocodeStore, googleGeocoder } from "./geocode";
import { firestoreBackfillScan, firestoreRetryStore, queueGeocodeBackfill, sweepGeocodeRetries } from "./geocodeSweep";
import { smtpConfig, smtpMailer } from "./mail";
import { isPng, sendBugReport } from "./bugReports";
import { fcmSender } from "./fcm";
import { pushConfig, webPushSender } from "./push";
import { firestoreReminderIo, sendReminders } from "./reminders";
import { firestoreChecklistIo, sendChecklistReminders, type ChecklistRun } from "./checklist";
import { aeroApiLookup } from "./aeroapi";
import { firestoreCheckInIo, sendCheckInReminders } from "./checkIn";
import { canSeeTrip, checkFlights, defaultFlightStatusDailyLimit, firestoreFlightIo, retryPendingNews, type FlightOptions } from "./flightStatus";
import { airportPlace } from "@travelmo/core/airportPlaces";
import { visaTable } from "@travelmo/core/visaRules";
import { app as firebaseApp, auth, db } from "./firebase";
import { getMessaging } from "firebase-admin/messaging";
import {
  currentHistoryId,
  gmailFor,
  gmailPacer,
  gmailScopes,
  withRateLimitRetry,
  isNotFound,
  listAddedSince,
  oauthClient,
  stopWatch,
  watch,
  type EmailMessage,
  type OAuthConfig,
  recordedAs,
} from "./gmail";
import { importCalendar, importMessage, importMessages, importTripIt, type ImportDeps, type ImportOptions } from "./importer";
import { regroupTrips } from "./regroup";
import { resetTrips } from "./tripsReset";
import { loadHomeOverrides } from "./homeOverrides";
import { errorFields, errorKind, log } from "./log";
import { BadPushEnvelope, parseGmailPush, processNotification, type GmailNotification } from "./pubsub";
import { firestoreStore } from "./store";
import { FeedLimitReached, addFeed, feedFailure, firestoreFeeds, pollAllFeeds, type FeedIo } from "./feeds";
import { FeedUrlRefused, fetchFeed } from "./safefetch";
import { runBackfillBatch } from "./backfill";
import { gmailSource, type MailSource, type Pace } from "./mailSource";
import {
  JmapHttpError,
  JmapMethodError,
  backfillFilter,
  currentEmailState,
  fastmailRecordId,
  fastmailRecordPrefix,
  fastmailSource,
  inboxCreatedSince,
  jmapClient,
  jmapSession,
  mailboxRoles,
  type Jmap,
} from "./jmap";
import {
  OtherMailboxConnected,
  changeFastmailBackfill,
  fastmailUsers,
  loadFastmailState,
  removeFastmailConnection,
  saveFastmailConnection,
  updateFastmailLive,
} from "./fastmailConnection";
import { pollNewMail } from "./newMailPoll";
import {
  TooManyImapMailboxes,
  changeImapBackfill,
  imapMailboxesToPoll,
  loadImapMailbox,
  loadImapMailboxes,
  markImapLoginFailed,
  removeImapConnection,
  saveImapConnection,
  updateImapLive,
} from "./imapConnection";
import {
  ImapLoginPaused,
  ImapServerRefused,
  connectMailbox,
  inLoginBackoff,
  currentMailboxState,
  imapFlowClient,
  imapRecordPrefix,
  imapSource,
  isImapAuthFailure,
  newSince,
  openInbox,
  closeInbox,
  type ImapSource,
} from "./imap";
import { continueBackfill, parseContinuePush, startBackfill, stopBackfill, type ChainIo, type ContinueMessage } from "./backfillChain";
import { refreshRecord, runRefreshBatch } from "./refresh";
import { changeRefresh } from "./refreshStore";
import { pubsubPublisher } from "./publish";
import { sealStoredCredentials } from "./sealStored";
import { reviseFoundLoyaltyOnce } from "./loyaltyRevision";
import { dropAccessRequests } from "./dropAccessRequests";
import { googleKmsClient, kmsSealer, useSealer } from "./sealing";

// How long one backfill request may spend waiting its turn and importing.
// Leaves two minutes of Cloud Run's default five for the last message and
// saving progress.
const backfillBudgetMs = 3 * 60 * 1000;
// The share of a user's Gmail quota (6,000 units a minute) a mailbox reading
// spends, about 66 full messages a minute; the rest is left for new mail
// arriving meanwhile and for opening emails from the app.
const backfillUnitsPerMinute = 4000;
// How long a notification's import waits out Gmail's rate limit before it
// fails, and Pub/Sub delivers it again later; within its 120-second
// acknowledgement deadline.
const notificationRateLimitWaitMs = 60 * 1000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
import { LeaseLost, UploadRunning, withUploadLease } from "./leases";
import { calendarForToken, firestoreExportIo, hashToken, issueExport, stopExport } from "./calendarExport";
import {
  defaultForwardDailyLimit,
  firestoreForwardStore,
  forwardRecord,
  inboundMaxBytes,
  newForwardToken,
  receiveForwarded,
  secretMatches,
} from "./inbound";
import { saveImportedProfile } from "./travelProfile";
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
// Where each batch of a mailbox reading queues the next (deploy/pubsub.sh).
const publishBackfill = pubsubPublisher(requireEnv("BACKFILL_PUBSUB_TOPIC"));
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

// Stored mail credentials are sealed with this Cloud KMS key (sealing.ts,
// deploy/kms.sh), its full resource name; without one they are stored as
// they are, for local runs.
const credentialsKey = optionalEnv("CREDENTIALS_KMS_KEY", "");
if (credentialsKey) useSealer(kmsSealer(credentialsKey, googleKmsClient()));
else log("WARNING", "credentials_unencrypted", { reason: "CREDENTIALS_KMS_KEY is not set" });

// Forward-to-import (inbound.ts) is on when the forwarding domain and the
// relay's secret are both set; without them Settings offers no address and
// the inbound route answers 404.
const forwardDomain = process.env.FORWARD_DOMAIN;
const inboundSecret = process.env.INBOUND_SECRET;
const forwardDailyLimit = Number(optionalEnv("FORWARD_DAILY_LIMIT", String(defaultForwardDailyLimit)));
if (!Number.isInteger(forwardDailyLimit) || forwardDailyLimit < 0) throw new Error("FORWARD_DAILY_LIMIT must be a whole number");
const forwarding = forwardDomain && inboundSecret ? { domain: forwardDomain, secret: inboundSecret } : undefined;

// Without a Geocoding API key, places keep whatever country their source gave.
const geocodingKey = process.env.GEOCODING_API_KEY;
const geocodeDailyLimit = Number(optionalEnv("GEOCODE_DAILY_LIMIT", String(defaultDailyLimit)));
if (!Number.isInteger(geocodeDailyLimit) || geocodeDailyLimit < 0) throw new Error("GEOCODE_DAILY_LIMIT must be a whole number");

const deps: ImportDeps = {
  store: firestoreStore(db),
  extract: geminiExtractor(genai, geminiModel),
  embed: geminiEmbedder(genai, embeddingModel),
  ...(geocodingKey
    ? {
        geocode: cachedGeocoder({
          store: firestoreGeocodeStore(db),
          geocoder: googleGeocoder(geocodingKey),
          limit: geocodeDailyLimit,
          now: () => new Date().toISOString(),
          log: (event, fields) => log("INFO", event, fields),
        }),
      }
    : {}),
  // Without a geocoder the queue still gets the airport and city tables'
  // answers, in the daily sweep.
  geocodeRetries: firestoreRetryStore(db),
  homeOverrides: (uid) => loadHomeOverrides(db, uid, (event, fields) => log("WARNING", event, fields)),
  now: () => new Date().toISOString(),
  log: (event, fields, severity) => log(severity ?? "INFO", event, fields),
};

type Env = { Variables: { uid: string } };
const app = new Hono<Env>();

app.use("/gmail/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/fastmail/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/imap/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/import/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/calendar/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/feeds/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/export/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/forward/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/account/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/trips/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/flights/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/access/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use("/emails/*", cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));
app.use(bugReportPath, cors({ origin: webOrigin, allowHeaders: ["Authorization", "Content-Type"] }));

app.get("/healthz", (c) => c.text("ok"));

function bearer(c: Context<Env>): string {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw new HTTPException(401, { message: "Missing bearer token" });
  return header.slice(7);
}

async function requireIdToken(c: Context<Env>): Promise<DecodedIdToken> {
  const token = bearer(c);
  try {
    return await auth.verifyIdToken(token);
  } catch (error) {
    log("WARNING", "bad_id_token", errorFields(error));
    throw new HTTPException(401, { message: "Invalid token" });
  }
}

// Every user endpoint but /account/delete, /access/check and adding and
// confirming an email address (requireLinkingToken): a sign-in
// token stays valid for up to an hour after its account is deleted, so a
// deleted account is refused here before any handler can write for it
// again; and an account not approved to use the app is refused (SPEC
// "Access").
async function requireUser(c: Context<Env>): Promise<string> {
  return (await requireApprovedToken(c)).uid;
}

// A deleted account's refusal; it says so when the deletion stopped part
// way, so the apps can offer to finish it (deleted.ts).
async function accountGone(uid: string): Promise<HTTPException> {
  const signInExists = async (id: string) => {
    try {
      await auth.getUser(id);
      return true;
    } catch (error) {
      if ((error as { code?: unknown }).code === "auth/user-not-found") return false;
      throw error;
    }
  };
  return new HTTPException(410, { message: await deletedAccountText(db, uid, deps.now(), signInExists, log) });
}

// requireUser for a handler that needs the token's claims too.
async function requireApprovedToken(c: Context<Env>): Promise<Awaited<ReturnType<typeof requireIdToken>>> {
  const token = await requireIdToken(c);
  const gate = await gateUser(db, token, log);
  if (gate === "deleted") throw await accountGone(token.uid);
  if (gate === "unapproved") {
    log("INFO", "user_not_approved", { uid: token.uid, path: c.req.path });
    throw new HTTPException(403, { message: "This account is not approved yet" });
  }
  return token;
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
  const connections = [...(await loadMailboxes(db, uid)), await loadCalendarState(db, uid)];
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
  try {
    await savePending(db, completion, { uid: state.uid, refreshToken: tokens.refresh_token, createdAt: new Date().toISOString(), purpose });
  } catch (error) {
    if (!(error instanceof AccountDeletedError)) throw error;
    // The account was deleted while Google was answering: the new grant
    // goes back rather than being kept for no one.
    log("INFO", "consent_after_account_deleted", { uid: state.uid, purpose });
    await revokeQuietly(tokens.refresh_token, state.uid);
    return c.redirect(`${webOrigin}/settings?${purpose}=error`);
  }
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
  // Another mailbox joins those connected, up to the limit; one already
  // connected is connected again with the new token.
  const connected = await loadMailboxes(db, uid);
  const again = connected.some((m) => m.emailAddress.toLowerCase() === profile.emailAddress.toLowerCase());
  if (!again && connected.length >= maxGmailMailboxes) {
    await releaseToken(pending.refreshToken, uid, profile.emailAddress);
    throw new HTTPException(409, { message: new TooManyMailboxes().message });
  }
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
    if (error instanceof MailboxConflict || error instanceof TooManyMailboxes) {
      throw new HTTPException(409, { message: error.message });
    }
    if (error instanceof AccountDeletedError) throw await accountGone(uid);
    throw error;
  }
  log("INFO", "gmail_connected", { uid, mailbox: mailboxKey(profile.emailAddress), mailboxes: again ? connected.length : connected.length + 1 });
  return c.json({ emailAddress: profile.emailAddress });
});

async function disconnect(uid: string, state: GmailState): Promise<void> {
  try {
    await stopWatch(gmailFor(oauth, state.refreshToken));
  } catch (error) {
    // Google may already have withdrawn the grant; the connection goes anyway.
    log("WARNING", "stop_watch_failed", { uid, mailbox: mailboxKey(state.emailAddress), ...errorKind(error) });
  }
  await releaseToken(state.refreshToken, uid, state.emailAddress);
  await removeConnection(db, uid, state.emailAddress);
}

// The mailbox a Settings request names (`emailAddress`); a client from
// before there could be several names none, and means the only one.
async function requestedMailbox(uid: string, body: { emailAddress?: unknown }): Promise<GmailState | undefined> {
  if (typeof body.emailAddress === "string" && body.emailAddress) return loadMailbox(db, uid, body.emailAddress);
  const all = await loadMailboxes(db, uid);
  if (all.length > 1) throw new HTTPException(400, { message: "Say which Gmail account" });
  return all[0];
}

app.post("/gmail/disconnect", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { emailAddress?: unknown };
  const state = await requestedMailbox(uid, body);
  if (state) await disconnect(uid, state);
  log("INFO", "gmail_disconnected", { uid, found: state !== undefined });
  return c.body(null, 204);
});

// Fastmail's answer to a token it does not take, as the user should hear it.
function fastmailRefusal(error: unknown): HTTPException | undefined {
  if (error instanceof JmapHttpError && (error.status === 401 || error.status === 403)) {
    return new HTTPException(400, { message: "Fastmail didn't accept that API token. Check it, or make a new one." });
  }
  if (error instanceof JmapMethodError && error.type === "noMailAccount") {
    return new HTTPException(400, { message: "That API token can't read email. Make one with Email access." });
  }
  return undefined;
}

// Connects a Fastmail mailbox with an API token the user made in Fastmail's
// settings. Only a read-only token is taken: one that could change or
// delete mail is refused rather than stored.
app.post("/fastmail/connect", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) throw new HTTPException(400, { message: "Paste your Fastmail API token" });
  let session;
  let emailState;
  try {
    session = await jmapSession(token);
    if (!session.readOnly) {
      throw new HTTPException(400, { message: "That API token can change your mail. Make a read-only one instead." });
    }
    emailState = await currentEmailState(jmapClient(token, session));
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw fastmailRefusal(error) ?? error;
  }
  try {
    await saveFastmailConnection(db, uid, {
      token,
      accountId: session.accountId,
      emailAddress: session.username,
      connectedAt: new Date().toISOString(),
      emailState,
    });
  } catch (error) {
    if (error instanceof OtherMailboxConnected) throw new HTTPException(409, { message: error.message });
    if (error instanceof AccountDeletedError) throw await accountGone(uid);
    throw error;
  }
  log("INFO", "fastmail_connected", { uid });
  return c.json({ emailAddress: session.username });
});

// Forgets the token; the user deletes it in Fastmail's settings.
app.post("/fastmail/disconnect", async (c) => {
  const uid = await requireUser(c);
  await stopBackfill(backfillIo(uid, { provider: "fastmail" }));
  await removeFastmailConnection(db, uid);
  log("INFO", "fastmail_disconnected", { uid });
  return c.body(null, 204);
});

// What the user should hear when an IMAP server would not let Travelmo read.
function imapRefusal(error: unknown): HTTPException | undefined {
  if (isImapAuthFailure(error)) {
    return new HTTPException(400, { message: "The server didn't accept that address and app password. Check them, or make a new app password." });
  }
  if (error instanceof ImapLoginPaused) {
    return new HTTPException(409, { message: "The server turned down the app password. Connect this mailbox again with a new one." });
  }
  if (error instanceof ImapServerRefused || error instanceof FeedUrlRefused) {
    return new HTTPException(400, { message: "Travelmo can't connect to that server." });
  }
  // A name that does not resolve, a refused or timed out connection, a
  // failed TLS handshake (a server without implicit TLS): all codes.
  const { code, tlsFailed } = (error ?? {}) as { code?: unknown; tlsFailed?: unknown };
  if (tlsFailed === true || (typeof code === "string" && /^(E[A-Z]+|CONNECT_TIMEOUT|GREETING_TIMEOUT|ClosedAfterConnect\w*|ERR_SSL\w*|ERR_TLS\w*|\w*CERT\w*|DEPTH_ZERO_SELF_SIGNED_CERT)$/.test(code))) {
    return new HTTPException(400, { message: "Couldn't reach that server securely. Check its name, and that it takes TLS connections (usually port 993)." });
  }
  return undefined;
}

// A connection to a mailbox's server with its stored password, refused
// passwords recorded (imap.ts's connectMailbox).
function imapMailSource(uid: string, state: ImapState, background = false): ImapSource {
  const key = mailboxKey(state.emailAddress);
  const onError = (error: unknown) => log("WARNING", "imap_connection_error", { uid, mailbox: key, ...errorKind(error) });
  return imapSource(imapRecordKey(state.emailAddress, state.host, state.port), () =>
    connectMailbox({
      loginFailedAt: state.loginFailedAt,
      background,
      nowMs: Date.now(),
      open: () => openInbox(imapFlowClient({ host: state.host, port: state.port, user: state.emailAddress, password: state.password }, onError)),
      loginFailed: async () => {
        // Never the password: the mailbox by key, and the server.
        log("WARNING", "imap_login_failed", { uid, mailbox: key, host: state.host });
        try {
          await markImapLoginFailed(db, uid, state, new Date().toISOString());
        } catch (error) {
          log("ERROR", "imap_login_failed_not_recorded", { uid, mailbox: key, ...errorKind(error) });
        }
      },
    }),
  );
}

// Connects a mailbox over IMAP with an app password the user made with
// their provider: the server is filled in for known providers, otherwise
// the user's (`server`, host or host:port). Implicit TLS only. The login is
// tried, the inbox opened read-only, and only then is the password stored.
app.post("/imap/connect", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { emailAddress?: unknown; password?: unknown; server?: unknown };
  const emailAddress = typeof body.emailAddress === "string" ? body.emailAddress.trim() : "";
  // App passwords are often shown in groups with spaces; spaces never belong.
  const password = typeof body.password === "string" ? body.password.replace(/\s+/g, "") : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddress)) throw new HTTPException(400, { message: "Enter your email address" });
  const redirect = imapRedirect(emailAddress);
  if (redirect) throw new HTTPException(400, { message: redirect });
  if (!password) throw new HTTPException(400, { message: "Enter an app password" });
  const choice = imapServerFor(emailAddress);
  const server = choice.kind === "known" ? { host: choice.provider.host, port: choice.provider.port } : parseImapServer(typeof body.server === "string" ? body.server : "");
  if (!server) throw new HTTPException(400, { message: "Enter your mail server, such as imap.example.com" });
  const connected = await loadImapMailboxes(db, uid);
  const again = connected.some((m) => m.emailAddress.toLowerCase() === emailAddress.toLowerCase());
  if (!again && connected.length >= maxImapMailboxes) throw new HTTPException(409, { message: new TooManyImapMailboxes().message });
  const key = mailboxKey(emailAddress);
  let mailboxState: string;
  try {
    const onError = (error: unknown) => log("WARNING", "imap_connection_error", { uid, mailbox: key, ...errorKind(error) });
    const inbox = await openInbox(imapFlowClient({ ...server, user: emailAddress, password }, onError));
    mailboxState = currentMailboxState(inbox);
    await closeInbox(inbox.client);
  } catch (error) {
    const refusal = imapRefusal(error);
    log(refusal ? "INFO" : "ERROR", isImapAuthFailure(error) ? "imap_login_failed" : "imap_connect_failed", { uid, mailbox: key, host: server.host, ...errorKind(error) });
    throw refusal ?? error;
  }
  try {
    await saveImapConnection(db, uid, { emailAddress, password, ...server, connectedAt: new Date().toISOString(), mailboxState });
  } catch (error) {
    if (error instanceof TooManyImapMailboxes) throw new HTTPException(409, { message: error.message });
    if (error instanceof AccountDeletedError) throw await accountGone(uid);
    throw error;
  }
  log("INFO", "imap_connected", { uid, mailbox: key, provider: choice.kind === "known" ? choice.provider.name : "other", mailboxes: again ? connected.length : connected.length + 1 });
  return c.json({ emailAddress });
});

// The IMAP mailbox a Settings request names (`emailAddress`).
async function requestedImapMailbox(uid: string, body: { emailAddress?: unknown }): Promise<ImapState | undefined> {
  if (typeof body.emailAddress !== "string" || !body.emailAddress) throw new HTTPException(400, { message: "Say which mailbox" });
  return loadImapMailbox(db, uid, { emailAddress: body.emailAddress });
}

// Forgets the password; deleting it with the provider revokes it.
app.post("/imap/disconnect", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { emailAddress?: unknown };
  const state = await requestedImapMailbox(uid, body);
  if (state) {
    await stopBackfill(backfillIo(uid, { provider: "imap", emailAddress: state.emailAddress }));
    await removeImapConnection(db, uid, state.emailAddress);
  }
  log("INFO", "imap_disconnected", { uid, found: state !== undefined, ...(state ? { mailbox: mailboxKey(state.emailAddress) } : {}) });
  return c.body(null, 204);
});

// Imports new mail by id, waiting out Gmail's rate limit for up to a minute.
function importIds(uid: string, source: MailSource, ids: readonly string[], options: ImportOptions = {}) {
  const deadline = Date.now() + notificationRateLimitWaitMs;
  const retry = { timeLeftMs: () => deadline - Date.now(), sleep, log: (event: string, fields: Record<string, unknown>) => log("WARNING", event, { uid, ...fields }) };
  return importMessages(uid, ids, (id) => withRateLimitRetry(() => source.fetch(id), retry), deps, { ...options, source: source.provider });
}

// A connected Gmail mailbox as a MailSource: its emails recorded under the
// mailbox's id prefix (none for the account's first).
function gmailMailSource(state: GmailState, pace?: Pace): MailSource {
  const source = gmailSource(gmailFor(oauth, state.refreshToken), pace);
  return { ...source, fetch: recordedAs(state.idPrefix, source.fetch) };
}

// A Fastmail mailbox's JMAP client: the session says where its API is.
async function fastmailJmap(state: { token: string }): Promise<Jmap> {
  return jmapClient(state.token, await jmapSession(state.token));
}

// A connection's mailbox, reached once something is read.
function fastmailMailSource(state: { token: string }, jmap?: () => Promise<Jmap>): MailSource {
  return fastmailSource(jmap ?? (() => fastmailJmap(state)));
}

// Reading the whole mailbox runs on the server (backfillChain.ts): each
// batch carries on from where the last stopped, records how far it got on
// the connection, where Settings shows it, and queues the next on Pub/Sub.
// One reading per mailbox, each on its own: a Gmail mailbox by its address,
// the user's Fastmail mailbox, or an IMAP mailbox by its address.
type BackfillTarget = { emailAddress: string } | { provider: "fastmail" } | { provider: "imap"; emailAddress: string };

function backfillIo(uid: string, target: BackfillTarget): ChainIo<MailSource> {
  // Stop importing well before Cloud Run's request limit, leaving time to
  // save progress; the next batch carries on. Time spent waiting for the
  // batch's turn comes out of it.
  const deadline = Date.now() + backfillBudgetMs;
  return {
    change: async (fn) => {
      if ("provider" in target && target.provider === "imap") {
        const changed = await changeImapBackfill(db, uid, target.emailAddress, fn);
        return changed && { ...changed, state: imapMailSource(uid, changed.state, true) };
      }
      if ("provider" in target) {
        const changed = await changeFastmailBackfill(db, uid, fn);
        return changed && { ...changed, state: fastmailMailSource(changed.state) };
      }
      const changed = await changeBackfill(db, uid, target.emailAddress, fn);
      const pace = gmailPacer(backfillUnitsPerMinute, { nowMs: Date.now, sleep });
      return changed && { ...changed, state: gmailMailSource(changed.state, pace) };
    },
    runBatch: async (source, from, generation) => {
      try {
        return await readBatch(source, from, generation);
      } finally {
        await source.close?.();
      }
    },
    publish: (message: ContinueMessage) => publishBackfill("provider" in target ? { ...message, provider: target.provider } : message),
    now: () => new Date().toISOString(),
    log: (severity, event, fields) => log(severity, event, fields),
    sleep,
    newWake: () => randomBytes(12).toString("base64url"),
    finished: async () => {
      const result = await regroupTrips(uid, deps);
      log("INFO", "backfill_regrouped", { uid, ...result });
    },
  };

  function readBatch(source: MailSource, from: Parameters<ChainIo<MailSource>["runBatch"]>[1], generation: number) {
    return runBackfillBatch(from, false, {
      timeLeftMs: () => deadline - Date.now(),
      sleep,
      page: source.searchPage,
      // An email whose import failed (the model was down, say) is read
      // again when the reading passes it again, as after starting over.
      // Gmail's rate limit is waited out by the batch, within its time.
      importIds: (ids) => importMessages(uid, ids, source.fetch, deps, { retryFailed: true, generation, source: source.provider }),
      isStaleCursor: source.isStaleCursor,
      now: () => new Date().toISOString(),
      log: (event, fields) => log("WARNING", event, { uid, ...fields }),
    });
  }
}

// Starts reading the whole mailbox (`restart: true` from the beginning) and
// returns at once; the batches run on the server, so closing the page does
// not stop them.
app.post("/gmail/backfill", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { restart?: unknown; emailAddress?: unknown };
  const restart = body.restart === true;
  const mailbox = await requestedMailbox(uid, body);
  if (!mailbox) throw new HTTPException(409, { message: "Gmail not connected" });
  const key = mailboxKey(mailbox.emailAddress);
  const result = await startBackfill(uid, randomBytes(12).toString("base64url"), restart, backfillIo(uid, { emailAddress: mailbox.emailAddress }), key);
  if (result.kind === "disconnected") throw new HTTPException(409, { message: "Gmail not connected" });
  if (result.kind === "busy") throw new HTTPException(409, { message: "A batch is still being read. Try again in a few minutes." });
  log("INFO", "backfill_started", { uid, mailbox: key, restart, joined: result.kind === "joined", run: result.progress.run });
  const { cursor: _cursor, after: _after, ...progress } = result.progress;
  return c.json({ progress });
});

// Stop: the batch under way saves its place, and no more are queued.
app.post("/gmail/backfill/stop", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { emailAddress?: unknown };
  const mailbox = await requestedMailbox(uid, body);
  const stopped = mailbox ? await stopBackfill(backfillIo(uid, { emailAddress: mailbox.emailAddress })) : false;
  log("INFO", "backfill_stopped", { uid, ...(mailbox ? { mailbox: mailboxKey(mailbox.emailAddress) } : {}), stopped });
  return c.body(null, 204);
});

app.post("/fastmail/backfill", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { restart?: unknown };
  const restart = body.restart === true;
  let result;
  try {
    result = await startBackfill(uid, randomBytes(12).toString("base64url"), restart, backfillIo(uid, { provider: "fastmail" }));
  } catch (error) {
    throw fastmailRefusal(error) ?? error;
  }
  if (result.kind === "disconnected") throw new HTTPException(409, { message: "Fastmail not connected" });
  if (result.kind === "busy") throw new HTTPException(409, { message: "A batch is still being read. Try again in a few minutes." });
  log("INFO", "backfill_started", { uid, provider: "fastmail", restart, joined: result.kind === "joined", run: result.progress.run });
  const { cursor: _cursor, after: _after, ...progress } = result.progress;
  return c.json({ progress });
});

app.post("/fastmail/backfill/stop", async (c) => {
  const uid = await requireUser(c);
  const stopped = await stopBackfill(backfillIo(uid, { provider: "fastmail" }));
  log("INFO", "backfill_stopped", { uid, provider: "fastmail", stopped });
  return c.body(null, 204);
});

// An IMAP mailbox's reading, as Gmail's: the mailbox by `emailAddress`.
app.post("/imap/backfill", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { restart?: unknown; emailAddress?: unknown };
  const restart = body.restart === true;
  const mailbox = await requestedImapMailbox(uid, body);
  if (!mailbox) throw new HTTPException(409, { message: "That mailbox isn't connected" });
  const key = mailboxKey(mailbox.emailAddress);
  const result = await startBackfill(uid, randomBytes(12).toString("base64url"), restart, backfillIo(uid, { provider: "imap", emailAddress: mailbox.emailAddress }), key);
  if (result.kind === "disconnected") throw new HTTPException(409, { message: "That mailbox isn't connected" });
  if (result.kind === "busy") throw new HTTPException(409, { message: "A batch is still being read. Try again in a few minutes." });
  log("INFO", "backfill_started", { uid, provider: "imap", mailbox: key, restart, joined: result.kind === "joined", run: result.progress.run });
  const { cursor: _cursor, after: _after, ...progress } = result.progress;
  return c.json({ progress });
});

app.post("/imap/backfill/stop", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { emailAddress?: unknown };
  const mailbox = await requestedImapMailbox(uid, body);
  const stopped = mailbox ? await stopBackfill(backfillIo(uid, { provider: "imap", emailAddress: mailbox.emailAddress })) : false;
  log("INFO", "backfill_stopped", { uid, provider: "imap", ...(mailbox ? { mailbox: mailboxKey(mailbox.emailAddress) } : {}), stopped });
  return c.body(null, 204);
});

// Rebuilds the signed-in user's trips from their bookings with the grouping
// imports use now, keeping days out at home apart from trips away.
app.post("/trips/regroup", async (c) => {
  const uid = await requireUser(c);
  const result = await regroupTrips(uid, deps);
  return c.json(result);
});

// Deletes every trip the signed-in user owns, with its bookings, and their
// import records, so they can import again from scratch. Trips shared with
// them, their profile and their connections stay.
app.post("/trips/delete-all", async (c) => {
  const uid = await requireUser(c);
  const result = await resetTrips(db, uid, (severity, event, fields) => log(severity, event, fields));
  return c.json(result);
});

// The connected mailbox an import record's email is in, and the id it is
// fetched by; undefined when that mailbox isn't connected. The record's id
// says which: Fastmail's and IMAP ones carry their prefix (an IMAP one its
// mailbox's key too), Gmail's name their mailbox (gmail.ts's
// sourceMailbox). `background`: an IMAP mailbox whose login last failed is
// not tried again yet (imap.ts's connectMailbox).
// `mailbox` names the mailbox, so a caller reading many emails can keep one
// source a mailbox; `pace` spaces a Gmail mailbox's calls out.
async function recordMailbox(
  uid: string,
  messageId: string,
  background = false,
  pace?: Pace,
): Promise<{ source: MailSource; id: string; mailbox: string } | undefined> {
  if (messageId.startsWith(imapRecordPrefix)) {
    // By its record key: the address on the server it was read from.
    const parsed = parseImapRecordId(messageId);
    const state = parsed && (await loadImapMailboxes(db, uid)).find((m) => imapRecordKey(m.emailAddress, m.host, m.port) === parsed.key);
    return state ? { source: imapMailSource(uid, state, background), id: messageId, mailbox: `imap:${parsed.key}` } : undefined;
  }
  if (messageId.startsWith(fastmailRecordPrefix)) {
    const state = await loadFastmailState(db, uid);
    return state ? { source: fastmailMailSource(state), id: messageId, mailbox: "fastmail" } : undefined;
  }
  const state = sourceMailbox(messageId, await loadMailboxes(db, uid));
  return state
    ? { source: gmailMailSource(state, pace), id: messageId.slice((state.idPrefix ?? "").length), mailbox: `gmail:${mailboxKey(state.emailAddress)}` }
    : undefined;
}

// A second look at one message the user picked from the review list: the
// pre-filter is skipped, and an earlier non-booking outcome no longer stands
// in the way. An import already under way, or already done, does.
// `messageId` is the import record's id, which names the mailbox the email
// is in (packages/core's parseGmailSourceId).
app.post("/gmail/reimport", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { messageId?: string };
  if (!body.messageId) throw new HTTPException(400, { message: "Missing messageId" });
  // Which kind of mailbox, for what to say when it fails (recordMailbox).
  const fastmail = body.messageId.startsWith(fastmailRecordPrefix);
  const imap = body.messageId.startsWith(imapRecordPrefix);
  const name = fastmail ? "Fastmail" : imap ? "that mailbox" : "Gmail";
  const mailbox = await recordMailbox(uid, body.messageId);
  if (!mailbox) {
    const message = imap ? "The mailbox this email is in isn't connected" : fastmail ? "Fastmail not connected" : "The Gmail account this email is in isn't connected";
    throw new HTTPException(409, { message });
  }
  const { source, id } = mailbox;
  let message;
  try {
    message = await source.fetch(id);
  } catch (error) {
    if (source.isNotFound(error)) throw new HTTPException(404, { message: `That email is no longer in ${name}` });
    throw (fastmail ? fastmailRefusal(error) : imap ? imapRefusal(error) : undefined) ?? error;
  } finally {
    await source.close?.();
  }
  const outcome = await importMessage(uid, message, deps, { force: true, reclaim: true, source: source.provider });
  log("INFO", "reimport", { uid, messageId: message.id, outcome });
  if (outcome === "skipped") {
    throw new HTTPException(409, { message: "That email is already imported or being imported right now" });
  }
  return c.json({ outcome });
});

// "Refresh from email" (refresh.ts): the emails the user's bookings came
// from, read again batch after batch on the server, on the same chain as a
// mailbox reading (backfillChain.ts), its progress on the user's document
// (refreshStore.ts). Each batch keeps one source a mailbox, paces Gmail as
// a mailbox reading does, and stops before Cloud Run's request limit. The
// last batch regroups the trips.
function refreshIo(uid: string): ChainIo<undefined> {
  const deadline = Date.now() + backfillBudgetMs;
  const timeLeftMs = () => deadline - Date.now();
  const warn = (event: string, fields: Record<string, unknown>) => log("WARNING", event, { uid, ...fields });
  return {
    change: (fn) => changeRefresh(db, uid, fn),
    runBatch: async (_state, from, generation) => {
      const pace = gmailPacer(backfillUnitsPerMinute, { nowMs: Date.now, sleep });
      const sources = new Map<string, MailSource>();
      // The record's email, or undefined when it is gone or its mailbox is
      // not connected or cannot be signed in to.
      const fetch = async (record: ParsedMessage): Promise<EmailMessage | undefined> => {
        const found = await recordMailbox(uid, record.messageId, true, pace);
        if (!found) return undefined;
        let source = sources.get(found.mailbox);
        if (source) await found.source.close?.();
        else sources.set(found.mailbox, (source = found.source));
        const reading = source;
        try {
          return await withRateLimitRetry(() => reading.fetch(found.id), { timeLeftMs, sleep, log: warn });
        } catch (error) {
          if (reading.isNotFound(error)) return undefined;
          if (error instanceof ImapLoginPaused || isImapAuthFailure(error)) {
            warn("refresh_mailbox_unreachable", { provider: reading.provider, ...errorKind(error) });
            return undefined;
          }
          throw error;
        }
      };
      try {
        return await runRefreshBatch(from, {
          records: (after, limit) => deps.store.importedRecords(uid, after, limit),
          snapshot: () => deps.store.listUserSegments(uid),
          refresh: (record, snapshot) => refreshRecord(uid, record, deps, { generation, snapshot, fetch }),
          timeLeftMs,
          now: () => new Date().toISOString(),
          log: warn,
        });
      } finally {
        for (const source of sources.values()) await source.close?.();
      }
    },
    publish: (message: ContinueMessage) => publishBackfill({ ...message, kind: "refresh" }),
    now: () => new Date().toISOString(),
    log: (severity, event, fields) => log(severity, event, fields),
    sleep,
    newWake: () => randomBytes(12).toString("base64url"),
    finished: async () => {
      const result = await regroupTrips(uid, deps);
      log("INFO", "refresh_regrouped", { uid, ...result });
    },
  };
}

// Starts a refresh (`restart: true` from the first email again) and returns
// at once; closing the page does not stop it.
app.post("/trips/refresh", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { restart?: unknown };
  const restart = body.restart === true;
  const connected = (await loadMailboxes(db, uid)).length + (await loadImapMailboxes(db, uid)).length + ((await loadFastmailState(db, uid)) ? 1 : 0);
  if (connected === 0) throw new HTTPException(409, { message: "Connect the mailbox your bookings came from first." });
  const result = await startBackfill(uid, randomBytes(12).toString("base64url"), restart, refreshIo(uid));
  if (result.kind === "disconnected") throw new HTTPException(409, { message: "Sign out, sign in again and try again." });
  if (result.kind === "busy") throw new HTTPException(409, { message: "A batch is still being read. Try again in a few minutes." });
  log("INFO", "refresh_started", { uid, restart, joined: result.kind === "joined", run: result.progress.run });
  const { cursor: _cursor, after: _after, ...progress } = result.progress;
  return c.json({ progress });
});

// Stop: the batch under way saves its place, and no more are queued.
app.post("/trips/refresh/stop", async (c) => {
  const uid = await requireUser(c);
  const stopped = await stopBackfill(refreshIo(uid));
  log("INFO", "refresh_stopped", { uid, stopped });
  return c.body(null, 204);
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
  const mailboxes = await loadMailboxes(db, uid);
  const io = calendarIo(uid, state.refreshToken, mailboxes.some((m) => sameAccount(m.emailAddress, state.emailAddress)));
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
  try {
    await saveCalendarState(db, uid, {
      refreshToken: pending.refreshToken,
      emailAddress,
      connectedAt: new Date().toISOString(),
      calendars: mergeCalendarList(kept, listed),
    });
  } catch (error) {
    if (!(error instanceof AccountDeletedError)) throw error;
    await revokeQuietly(pending.refreshToken, uid);
    throw await accountGone(uid);
  }
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
    let profile: ImportedProfile;
    try {
      parsed = parseTripItExport(body?.export);
      profile = extractTripItProfile(body?.export);
    } catch (error) {
      if (error instanceof NotATripItExport) throw new HTTPException(400, { message: error.message });
      throw error;
    }
    // One TripIt upload at a time per user, so its one-to-one matching holds
    // across them too (leases.ts); a second gets a 409 to try again.
    let counts;
    try {
      counts = await withUploadLease(db, uid, "tripit", randomBytes(12).toString("base64url"), async (lease) => {
        const imported = await importTripIt(uid, parsed, deps, { beforeEach: () => lease.assertHeld() });
        // The traveler's own details ride the same upload (travelProfile.ts).
        if (!isEmptyProfile(profile)) {
          lease.assertHeld();
          await saveImportedProfile(db, uid, (await auth.getUser(uid)).email, profile, new Date().toISOString());
        }
        return imported;
      });
    } catch (error) {
      if (error instanceof UploadRunning || error instanceof LeaseLost) throw new HTTPException(409, { message: error.message });
      throw error;
    }
    const result = {
      ...counts,
      notImported: parsed.skipped.length,
      travelers: profile.travelers.length,
      loyaltyPrograms: profile.loyalty.length,
      documents: profile.documents.length,
    };
    // Counts only: the profile's contents never reach the logs.
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

// The calendar export: a link the owner subscribes to from Google or Apple
// Calendar. Issuing again replaces the link; the old one stops working.
app.post("/export/calendar", async (c) => {
  const uid = await requireUser(c);
  const record = await issueExport(db, uid, deps.now());
  log("INFO", "calendar_export_issued", { uid });
  return c.json(record);
});

app.post("/export/calendar/stop", async (c) => {
  const uid = await requireUser(c);
  await stopExport(db, uid);
  log("INFO", "calendar_export_stopped", { uid });
  return c.body(null, 204);
});

// The user's forward-to-import address (inbound.ts): issuing again replaces
// it, and the old one bounces from then on.
const forwardStore = forwarding ? firestoreForwardStore(db, forwarding.domain) : undefined;

app.post("/forward/issue", async (c) => {
  const uid = await requireUser(c);
  if (!forwarding || !forwardStore) throw new HTTPException(503, { message: "Forwarding is not set up on this server" });
  const token = newForwardToken();
  const record = forwardRecord(token, forwarding.domain, deps.now());
  await forwardStore.issue(uid, record, hashToken(token), record.createdAt);
  log("INFO", "forward_address_issued", { uid });
  return c.json(record);
});

app.post("/forward/stop", async (c) => {
  const uid = await requireUser(c);
  if (!forwardStore) throw new HTTPException(503, { message: "Forwarding is not set up on this server" });
  await forwardStore.stop(uid);
  log("INFO", "forward_address_stopped", { uid });
  return c.body(null, 204);
});

// The Email Worker (apps/inbound) relays each message for the forwarding
// domain here as it arrived, with the shared secret; the answer tells it
// whether to accept the message or bounce it with a reason.
app.post(
  "/inbound/cloudflare",
  bodyLimit({
    maxSize: inboundMaxBytes,
    onError: () => {
      throw new HTTPException(413, { message: "Message too large" });
    },
  }),
  async (c) => {
    if (!forwarding || !forwardStore) throw new HTTPException(404, { message: "Not found" });
    if (!secretMatches(bearer(c), forwarding.secret)) {
      log("WARNING", "bad_inbound_secret", {});
      throw new HTTPException(403, { message: "Forbidden" });
    }
    const to = c.req.header("X-Envelope-To") ?? "";
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const received = await receiveForwarded(
      { to, raw },
      { store: forwardStore, domain: forwarding.domain, limit: forwardDailyLimit, deps, approved: (uid) => approvedUid(db, uid, verifiedEmail, log) },
    );
    switch (received.status) {
      case "unknown_address":
        log("INFO", "forward_unknown_address", { bytes: raw.length });
        return c.text("No such address", 404);
      case "unapproved":
        // Bounced as an unknown address is: the account may not use the app.
        log("INFO", "forward_unapproved_user", { uid: received.uid, bytes: raw.length });
        return c.text("No such address", 404);
      case "limit":
        log("WARNING", "forward_limit_reached", { uid: received.uid, limit: forwardDailyLimit });
        return c.text("Daily forwarding limit reached", 429);
      case "failed":
        // Not acknowledged: the Worker fails and the sending server retries.
        log("ERROR", "forward_import_failed", { uid: received.uid, messageId: received.messageId });
        return c.text("Import failed; it will be retried", 503);
      case "pending":
        log("INFO", "forward_import_pending", { uid: received.uid, messageId: received.messageId });
        return c.text("Import in progress; it will be retried", 503);
      case "accepted":
        log("INFO", "forward_received", { uid: received.uid, messageId: received.messageId, outcome: received.outcome, bytes: raw.length });
        return c.body(null, 204);
    }
  },
);

// Deletes the caller's account and everything they own (account.ts). The
// email comes from the token rather than the Auth user, so a retry after
// the user is gone still finds the trips that name them; only a verified
// one, as sharing keys on.
app.post("/account/delete", async (c) => {
  const token = await requireIdToken(c);
  const email = token.email_verified && token.email ? token.email.toLowerCase() : undefined;
  await deleteAccount(token.uid, email, {
    db,
    stopWatch: (refreshToken) => stopWatch(gmailFor(oauth, refreshToken)),
    revoke: async (refreshToken) => {
      await oauthClient(oauth).revokeToken(refreshToken);
    },
    deleteAuthUser: async (uid) => {
      try {
        await auth.deleteUser(uid);
      } catch (error) {
        if ((error as { code?: unknown }).code !== "auth/user-not-found") throw error;
        // Gone already: an earlier run got this far.
        log("INFO", "account_delete_auth_user_gone", { uid });
      }
    },
    now: deps.now,
    log,
  });
  return c.body(null, 204);
});

// Only a sign-in Google verified counts for the trips shared with a user,
// as in the rules.
async function verifiedEmail(uid: string): Promise<string | undefined> {
  const record = await auth.getUser(uid);
  return record.emailVerified && record.email ? record.email.toLowerCase() : undefined;
}
// Every address that is the user's, for the trips and profiles shared
// with them (SPEC "Linked email addresses").
const addresses = (uid: string) => addressesOf(db, uid, verifiedEmail);
// The account that signs in with an address Google verified, if any.
async function signInOwner(email: string): Promise<string | undefined> {
  try {
    const record = await auth.getUserByEmail(email);
    return record.emailVerified ? record.uid : undefined;
  } catch (error) {
    // Shared with an address nobody has signed in with.
    if ((error as { code?: string }).code === "auth/user-not-found") return undefined;
    throw error;
  }
}
// Whose an address is: the account signing in with it, else the one that
// linked it or connected it as its Gmail.
const uidForEmail = uidForAddress(db, signInOwner);
// A revoked account's link answers as an unknown one does.
const exportIo = firestoreExportIo(db, addresses, async (uid) => {
  const approved = await approvedUid(db, uid, verifiedEmail, log);
  if (!approved) log("INFO", "calendar_export_unapproved_owner", { uid });
  return approved;
});

// Fetched by calendar apps, which send no credentials: the token in the
// link is the credential.
app.get("/cal/:file", async (c) => {
  const file = c.req.param("file");
  const token = file.endsWith(".ics") ? file.slice(0, -4) : file;
  let text: string | undefined;
  try {
    text = await calendarForToken(token, exportIo, { now: deps.now(), tripUrl: (id) => `${webOrigin}/trips/${id}` });
  } catch (error) {
    // Logged here rather than by onError, whose path would carry the
    // token; the calendar app asks again later.
    log("ERROR", "calendar_export_failed", errorFields(error));
    return c.text("This calendar is unavailable right now.", 503);
  }
  if (text === undefined) {
    log("INFO", "calendar_export_unknown_link", {});
    return c.text("This calendar link is not in use.", 404);
  }
  return c.body(text, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'inline; filename="travelmo.ics"',
    // A shared cache must never hold someone's trips.
    "Cache-Control": "private, max-age=900",
  });
});

// Cloud Scheduler calls this daily (deploy/scheduler.sh).
app.post("/internal/poll-feeds", async (c) => {
  await requireInternalCaller(c);
  // Nobody's feeds or calendars are read once they may not use the app.
  const isApproved = (uid: string) => approvedUid(db, uid, verifiedEmail, log);
  const result = await pollAllFeeds({ ...feedIo, feeds: { ...feedIo.feeds, all: async () => onlyApproved(await feedIo.feeds.all(), isApproved, log) } });
  log("INFO", "feeds_polled", result);
  // Google calendars ride the same daily job: one user's failure is logged
  // and the rest carry on.
  const calendars = { users: 0, read: 0, failed: 0 };
  const calendarUids = (await onlyApproved((await calendarUsers(db)).map((uid) => ({ uid })), isApproved, log)).map(({ uid }) => uid);
  for (const uid of calendarUids) {
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

// Reminders by email go out only with SMTP settings, to browsers only with
// VAPID keys; without them those switches in Settings have no effect. To
// phones they go through Cloud Messaging with the Admin credential, so that
// channel is always on (the service account needs the Messaging role; README
// "Deploy").
const smtp = smtpConfig(process.env);
const vapid = pushConfig(process.env);
const reminderChannels = {
  ...(smtp ? { mail: smtpMailer(smtp) } : {}),
  ...(vapid ? { push: webPushSender(vapid) } : {}),
  fcm: fcmSender(getMessaging(firebaseApp)),
};
// Reminders stop for anyone no longer approved.
const allReminderIo = firestoreReminderIo(db, verifiedEmail, addresses);
const reminderIo = {
  ...allReminderIo,
  users: async () => onlyApproved(await allReminderIo.users(), (uid) => approvedUid(db, uid, verifiedEmail, log), log),
};

// The traveler's own reminders before a trip (checklist.ts), to the same
// people: those with reminders on, and approved.
const allChecklistIo = firestoreChecklistIo(db, allReminderIo, log);
const checklistIo = {
  ...allChecklistIo,
  users: async () => onlyApproved(await allChecklistIo.users(), (uid) => approvedUid(db, uid, verifiedEmail, log), log),
};

// Cloud Scheduler calls this daily (deploy/scheduler.sh): the document
// warnings and entry requirements of trips starting within a month, sent
// once each to everyone who asked, by email and to their browsers and phones,
// and then each of their own reminders before a trip that is due.
app.post("/internal/reminders", async (c) => {
  await requireInternalCaller(c);
  const now = deps.now();
  const run = await sendReminders(reminderIo, reminderChannels, {
    now,
    origin: webOrigin,
    lookups: { airportPlace, visaTable },
    log: (event, fields) => log(event === "reminder_failed" ? "ERROR" : "INFO", event, fields),
  });
  log("INFO", "reminders_sent", run);
  let checklist: ChecklistRun | undefined;
  try {
    checklist = await sendChecklistReminders(checklistIo, reminderChannels, { now, clock: deps.now, origin: webOrigin, lookup: airportPlace, log });
    log("INFO", "checklist_reminders_sent", checklist);
  } catch (error) {
    // The document reminders went; these wait for tomorrow's run.
    log("ERROR", "checklist_reminders_failed", errorFields(error));
  }
  return c.json({ enabled: true, ...run, ...(checklist ? { checklist } : {}) });
});

// Linked email addresses (emails.ts; SPEC "Linked email addresses"). A
// refusal answers with its reason, which the apps put in words.
const refusalStatus: Record<LinkRefusal, 400 | 403 | 409 | 410 | 429> = {
  invalid: 400,
  yours: 400,
  full: 400,
  limit: 429,
  taken: 409,
  expired: 410,
  notInvited: 403,
};
const emailDeps = {
  db,
  mail: reminderChannels.mail,
  origin: webOrigin,
  now: deps.now,
  log,
  signInOwner,
};
// Runs one of the linking routes, logging why it failed by the operation
// and the account, never the address or the token, and turning a refusal
// into its status.
async function linking<T>(operation: "add" | "confirm" | "remove", uid: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LinkRefused) {
      log("INFO", "email_route_refused", { operation, uid, reason: error.refusal });
      throw new HTTPException(refusalStatus[error.refusal], {
        res: new Response(JSON.stringify({ refusal: error.refusal }), {
          status: refusalStatus[error.refusal],
          headers: { "Content-Type": "application/json" },
        }),
      });
    }
    if (error instanceof AccountDeletedError) {
      log("INFO", "email_link_account_deleted", { operation, uid });
      throw await accountGone(uid);
    }
    // The error's name and code, not its message, which may name the
    // address (a mail server's refusal, a parse error).
    log("ERROR", "email_route_failed", { operation, uid, error: (error as Error).name, code: (error as { code?: unknown }).code });
    // Answered here rather than rethrown: `onError` would log the message.
    throw new HTTPException(500, { message: "Something went wrong. Try again later." });
  }
}
const emailBody = async (c: Context<Env>, field: "email" | "token"): Promise<string> => {
  const body = (await c.req.json().catch((error: unknown) => {
    // Answered as a missing field below.
    // The error's name only: a parse error's message quotes the body.
    log("INFO", "email_body_unreadable", { field, error: (error as Error).name });
    return {};
  })) as Record<string, unknown>;
  const value = body[field];
  if (typeof value !== "string" || !value || value.length > 512) throw new HTTPException(400, { message: `Missing ${field}` });
  return value;
};

// Adding and confirming take an account not approved yet too, so the
// invite-only page can link the address it was invited at (gateLinking);
// requestLink and confirmLink hold such an account to addresses that let it
// in. A deleted account, or one whose sign-in was declined, is refused as
// requireUser refuses it.
async function requireLinkingToken(c: Context<Env>): Promise<{ token: DecodedIdToken; approved: boolean }> {
  const token = await requireIdToken(c);
  const gate = await gateLinking(db, token, log);
  if (gate === "deleted") throw await accountGone(token.uid);
  if (gate === "declined") {
    log("INFO", "user_not_approved", { uid: token.uid, path: c.req.path });
    throw new HTTPException(403, { message: "This account is not approved yet" });
  }
  return { token, approved: gate === "ok" };
}

// Sends a confirmation link to an address the user wants to link.
app.post("/emails/add", async (c) => {
  const { token, approved } = await requireLinkingToken(c);
  const email = await emailBody(c, "email");
  if (!emailDeps.mail) throw new HTTPException(503, { message: "Email is not set up on this server" });
  return c.json(await linking("add", token.uid, () => requestLink(emailDeps, token.uid, verifiedEmailOf(token), email, approved)));
});

// The confirmation link's page calls this, signed in; only the account
// that asked can confirm.
app.post("/emails/confirm", async (c) => {
  const { token: idToken, approved } = await requireLinkingToken(c);
  const token = await emailBody(c, "token");
  return c.json(await linking("confirm", idToken.uid, () => confirmLink(emailDeps, idToken.uid, token, approved)));
});

app.post("/emails/remove", async (c) => {
  const uid = await requireUser(c);
  const email = await emailBody(c, "email");
  await linking("remove", uid, () => removeLink(emailDeps, uid, email));
  return c.body(null, 204);
});

// The one endpoint an account not yet approved may call (SPEC "Access"):
// the app calls it when it finds the account not approved. It lets in an
// account from before approvals or one someone already shared with, and
// answers where the account stands.
app.post("/access/check", async (c) => {
  const token = await requireIdToken(c);
  if ((await db.doc(paths.deletedAccount(token.uid)).get()).exists) throw await accountGone(token.uid);
  const status = await settleAccess(
    {
      db,
      now: deps.now,
      log,
      verifiedEmail,
    },
    token,
  );
  return c.json({ status });
});

// Bug reports from the apps (bugReports.ts; SPEC "Bug reports"), emailed
// to BUG_REPORT_TO; without it or SMTP the route answers 503. The body is
// a screenshot's base64 and a log at most, with room for JSON's escapes.
const bugReportTo = process.env.BUG_REPORT_TO?.trim() || undefined;
const bugReportMaxBytes = Math.ceil((bugReportLimits.screenshotBytes * 4) / 3) + 2 * (bugReportLimits.log + bugReportLimits.tripJson) + 64 * 1024;

app.post(
  bugReportPath,
  bodyLimit({
    maxSize: bugReportMaxBytes,
    onError: () => {
      throw new HTTPException(413, { message: "The report is too large" });
    },
  }),
  async (c) => {
    const token = await requireApprovedToken(c);
    const mail = reminderChannels.mail;
    if (!mail || !bugReportTo) throw new HTTPException(503, { message: "Bug reports are not set up on this server" });
    const body = await c.req.json().catch((error: unknown) => {
      // The error's name only: a parse error's message quotes the body.
      log("INFO", "bug_report_unreadable", { uid: token.uid, error: (error as Error).name });
      return undefined;
    });
    const checked = checkBugReport(body);
    if (!checked.ok) {
      log("INFO", "bug_report_refused", { uid: token.uid, status: checked.status, reason: checked.reason });
      throw new HTTPException(checked.status, { message: checked.reason });
    }
    const screenshot = checked.report.screenshot ? new Uint8Array(Buffer.from(checked.report.screenshot, "base64")) : undefined;
    if (screenshot && !isPng(screenshot)) throw new HTTPException(400, { message: "The screenshot is not a PNG" });
    let sent;
    try {
      sent = await sendBugReport(
        { db, mail, to: bugReportTo, now: deps.now, newId: () => randomBytes(12).toString("base64url"), log },
        token.uid,
        verifiedEmailOf(token),
        checked.report,
        screenshot,
      );
    } catch (error) {
      if (error instanceof AccountDeletedError) throw new HTTPException(410, { message: "This account was deleted" });
      throw error;
    }
    if (sent.status === "limit") throw new HTTPException(429, { message: "Too many reports today" });
    if (sent.status === "mail_failed") throw new HTTPException(502, { message: "The report could not be emailed" });
    return c.json({ id: sent.id });
  },
);

// Cloud Scheduler calls this daily (deploy/scheduler.sh): the places a spent
// geocoding budget put off get their second chance, and the next page of
// bookings imported before geocoding began joins them.
app.post("/internal/geocode-sweep", async (c) => {
  await requireInternalCaller(c);
  if (deps.geocodeRetries) {
    try {
      const backfill = await queueGeocodeBackfill(firestoreBackfillScan(db), deps.geocodeRetries, deps.now());
      log("INFO", "geocode_backfill", backfill);
    } catch (error) {
      // The sweep goes ahead; the walk resumes from its cursor tomorrow.
      log("ERROR", "geocode_backfill_failed", errorFields(error));
    }
  }
  const result = await sweepGeocodeRetries(deps);
  log("INFO", "geocode_sweep", { ...result, enabled: Boolean(deps.geocode) });
  return c.json(result);
});

// Live gates and carousels (flightStatus.ts) are on with an AeroAPI key.
const aeroApiKey = process.env.AEROAPI_KEY;
const flightStatusDailyLimit = Number(optionalEnv("FLIGHT_STATUS_DAILY_LIMIT", String(defaultFlightStatusDailyLimit)));
if (!Number.isInteger(flightStatusDailyLimit) || flightStatusDailyLimit < 0) throw new Error("FLIGHT_STATUS_DAILY_LIMIT must be a whole number");
const flightLookup = aeroApiKey ? aeroApiLookup(aeroApiKey) : undefined;
const flightIo = firestoreFlightIo(db, {
  // Only a sign-in Google verified counts, or an address its account
  // confirmed, as for sharing itself.
  uidForEmail,
  pushSubscriptions: reminderIo.pushSubscriptions,
  removePushSubscription: reminderIo.removePushSubscription,
  devices: reminderIo.devices,
  removeDevice: reminderIo.removeDevice,
});
const flightOptions = (): FlightOptions | undefined =>
  flightLookup && {
    lookup: flightLookup,
    limit: flightStatusDailyLimit,
    now: deps.now(),
    clock: deps.now,
    origin: webOrigin,
    channels: { ...(reminderChannels.push ? { push: reminderChannels.push } : {}), fcm: reminderChannels.fcm },
    log: (level, event, fields) => log(level, event, fields),
    approved: (uid) => approvedUid(db, uid, verifiedEmail, log),
  };

// Check-in reminders (checkIn.ts) ride the flight-status job: they need
// its minute to go out when check-in opens, not the daily reminder run's
// morning, and the same bookings query and index. They need no AeroAPI key.
const checkInIo = firestoreCheckInIo(db, {
  flightSegments: flightIo.flightSegments,
  trip: flightIo.trip,
  uidForEmail: flightIo.uidForEmail,
  verifiedEmail,
  pushSubscriptions: reminderIo.pushSubscriptions,
  removePushSubscription: reminderIo.removePushSubscription,
  devices: reminderIo.devices,
  removeDevice: reminderIo.removeDevice,
});

async function remindCheckIns(): Promise<Record<string, unknown>> {
  try {
    const run = await sendCheckInReminders(checkInIo, {
      now: deps.now(),
      clock: deps.now,
      origin: webOrigin,
      channels: reminderChannels,
      log: (level, event, fields) => log(level, event, fields),
      approved: (uid) => approvedUid(db, uid, verifiedEmail, log),
    });
    if (run.reminded || run.failed || run.swept) log("INFO", "check_in_reminders_sent", run);
    return run;
  } catch (error) {
    // Logged, and the flights still get their look; the next minute tries again.
    log("ERROR", "check_in_reminders_failed", errorFields(error));
    return { failed: true };
  }
}

// Cloud Scheduler calls this every minute (deploy/scheduler.sh): flights
// whose online check-in opened get their reminder, flights near departure
// or arrival get their look, and their news goes out.
app.post("/internal/flight-status", async (c) => {
  await requireInternalCaller(c);
  const checkIn = await remindCheckIns();
  const options = flightOptions();
  if (!options) return c.json({ enabled: false, checkIn });
  const retried = await retryPendingNews(flightIo, options);
  const run = await checkFlights(flightIo, options);
  if (run.checked || run.failed || run.capped || retried.delivered || retried.dropped) log("INFO", "flight_status_checked", { ...run, retried });
  return c.json({ enabled: true, ...run, retried, checkIn });
});

// An open trip page asks for its flights now, at most once a minute each;
// what it learns is news for everyone on the flight, as from the job.
app.post("/flights/refresh", async (c) => {
  const uid = await requireUser(c);
  const body = (await c.req.json().catch(() => ({}))) as { tripId?: unknown };
  if (typeof body.tripId !== "string" || !body.tripId) throw new HTTPException(400, { message: "Missing tripId" });
  const trip = await flightIo.trip(body.tripId);
  if (!trip || !canSeeTrip(trip, uid, await addresses(uid))) throw new HTTPException(404, { message: "No such trip" });
  const options = flightOptions();
  if (!options) return c.json({ enabled: false });
  const run = await checkFlights(flightIo, options, { tripId: trip.id });
  if (run.checked || run.failed) log("INFO", "flight_status_refreshed", { uid, tripId: trip.id, ...run });
  return c.json({ enabled: true, checked: run.checked });
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
    if (!(await approvedUid(db, uid, verifiedEmail, log))) {
      // Revoked since connecting: the mail stays unread, and the stored
      // history id lets a later approval pick up from where it stopped.
      log("INFO", "notification_for_unapproved_user", { uid, pubsubMessageId });
      return c.body(null, 204);
    }
    const result = await processNotification(notification.historyId, {
      resetGeneration: () => deps.store.resetGeneration(uid),
      loadState: () => loadMailbox(db, uid, notification.emailAddress),
      listAdded: (state, since) => listAddedSince(gmailFor(oauth, state.refreshToken), since),
      importIds: (state, ids, generation) => importIds(uid, gmailMailSource(state), ids, { generation }),
      saveHistoryId: (state, historyId, generation) => updateHistoryId(db, uid, state.emailAddress, historyId, generation),
    });
    if (result.kind === "disconnected") {
      log("WARNING", "notification_for_disconnected_user", { uid });
      return c.body(null, 204);
    }
    if (result.kind === "expired") {
      log("WARNING", "history_expired", { uid, since: result.since });
      return c.body(null, 204);
    }
    const fields = { uid, pubsubMessageId, deliveryAttempt, messages: result.messages, ...result.counts };
    if (result.kind === "superseded") {
      // Trips were reset while this ran: fail it so Pub/Sub delivers it
      // again and the emails are read under the new generation.
      log("WARNING", "notification_superseded", fields);
      return c.body(null, 503);
    }
    log("INFO", "notification_processed", fields);
    return c.body(null, 204);
  } catch (error) {
    log("ERROR", "notification_failed", { pubsubMessageId, deliveryAttempt, ...errorFields(error) });
    throw error;
  }
});

// The next batch of a mailbox reading, queued by the one before. A non-2xx
// response makes Pub/Sub try again with backoff, and its attempts run out
// within minutes, so only an error gets one: a batch that failed (its next
// attempt waits for the email claims it left to lapse), or one read but
// whose next batch could not be queued (the next attempt queues it). A
// batch that must wait (its earlier copy still reads, a failed batch's
// claims hold, Gmail rate limited the last) waits here up to a minute, then
// hands the reading on to a fresh message. A message the stored progress no
// longer expects (a newer start, Stop, a reset, a copy of a batch already
// read, a copy another message carries on for) is acknowledged and dropped.
app.post("/internal/backfill", async (c) => {
  await requireInternalCaller(c);
  let message: ReturnType<typeof parseContinuePush>;
  try {
    message = parseContinuePush(await c.req.json());
  } catch (error) {
    if (error instanceof BadPushEnvelope) throw new HTTPException(400, { message: error.message });
    throw error;
  }
  const { uid, mailbox, provider, kind, run, step, wake, pubsubMessageId, deliveryAttempt } = message;
  const fields = { uid, mailbox, provider, kind, run, step, wake, pubsubMessageId, deliveryAttempt };
  const continued: ContinueMessage = {
    uid,
    ...(mailbox ? { mailbox } : {}),
    ...(provider ? { provider } : {}),
    ...(kind ? { kind } : {}),
    run,
    step,
    ...(wake ? { wake } : {}),
  };
  try {
    if (kind === "refresh") return await continueChain(c, continued, refreshIo(uid), fields);
    let target: BackfillTarget;
    if (provider === "fastmail") {
      target = { provider };
    } else if (provider === "imap") {
      const state = mailbox ? await loadImapMailbox(db, uid, { key: mailbox }) : undefined;
      if (!state) {
        log("WARNING", "backfill_for_disconnected_user", fields);
        return c.body(null, 204);
      }
      target = { provider, emailAddress: state.emailAddress };
    } else {
      // A Gmail batch queued before there could be several mailboxes names
      // none: it reads the user's first.
      const state = await resolveMailbox(db, uid, mailbox);
      if (!state) {
        log("WARNING", "backfill_for_disconnected_user", fields);
        return c.body(null, 204);
      }
      target = { emailAddress: state.emailAddress };
    }
    return await continueChain(c, continued, backfillIo(uid, target), fields);
  } catch (error) {
    log("ERROR", "backfill_batch_failed", { ...fields, ...errorFields(error) });
    throw error;
  }
});

// One batch of a chain (a mailbox reading or a refresh), as /internal/backfill
// answers for it.
async function continueChain<S>(c: Context<Env>, continued: ContinueMessage, io: ChainIo<S>, fields: Record<string, unknown>) {
  const { uid, run } = continued;
  if (!(await approvedUid(db, uid, verifiedEmail, log))) {
    // Marked stopped where it got to, so Settings shows Continue at once
    // if access comes back, rather than a reading nothing is doing.
    const stopped = await stopBackfill(io, continued);
    log("INFO", "backfill_for_unapproved_user", { ...fields, stopped });
    return c.body(null, 204);
  }
  const result = await continueBackfill(continued, io);
  switch (result.kind) {
    case "disconnected":
      log("WARNING", "backfill_for_disconnected_user", fields);
      return c.body(null, 204);
    case "stale":
      log("INFO", "backfill_message_dropped", { ...fields, reason: result.reason });
      return c.body(null, 204);
    case "requeued":
      log("WARNING", "backfill_requeued", fields);
      return c.body(null, 204);
    case "deferred":
      log("INFO", "backfill_deferred", { ...fields, until: result.until });
      return c.body(null, 204);
    case "superseded":
      log("WARNING", "backfill_progress_not_saved", { ...fields, candidates: result.batch.candidates, ...result.batch.counts });
      return c.body(null, 204);
    case "ran": {
      const { cursor: _cursor, after: _after, ...progress } = result.progress;
      log("INFO", "backfill", {
        ...fields,
        candidates: result.batch.candidates,
        rateLimited: result.batch.rateLimited === true,
        ...result.batch.counts,
        ...progress,
      });
      if (!result.progress.running) log("INFO", "backfill_ended", { uid, run, done: result.progress.done, failed: result.batch.counts.failed });
      return c.body(null, 204);
    }
  }
}

// New mail in polled mailboxes, every five minutes (deploy/scheduler.sh):
// Fastmail's and those connected over IMAP. One mailbox's failure is logged
// and the rest carry on; its next poll reads it again.
// `/internal/poll-fastmail` is the path the job called before IMAP.
async function pollMail(c: Context<Env>) {
  await requireInternalCaller(c);
  const isApproved = (uid: string) => approvedUid(db, uid, verifiedEmail, log);
  const fastmail = await pollFastmailUsers(isApproved);
  const imap = await pollImapMailboxes(isApproved);
  log("INFO", "fastmail_polled", fastmail);
  log("INFO", "imap_polled", imap);
  return c.json({ fastmail, imap });
}
app.post("/internal/poll-mail", pollMail);
app.post("/internal/poll-fastmail", pollMail);

async function pollFastmailUsers(isApproved: (uid: string) => Promise<boolean>) {
  const uids = (await onlyApproved((await fastmailUsers(db)).map((uid) => ({ uid })), isApproved, log)).map(({ uid }) => uid);
  const totals = { users: uids.length, messages: 0, failed: 0 };
  for (const uid of uids) {
    try {
      let jmap: Jmap | undefined;
      const client = async (state: { token: string }) => (jmap ??= await fastmailJmap(state));
      const result = await pollNewMail({
        resetGeneration: () => deps.store.resetGeneration(uid),
        loadState: async () => loadFastmailState(db, uid),
        stateOf: (state) => state.emailState,
        currentState: async (state) => currentEmailState(await client(state)),
        createdSince: async (state, since) => {
          const api = await client(state);
          return inboxCreatedSince(api, since, (await mailboxRoles(api)).inbox);
        },
        importIds: async (state, ids, generation) =>
          importIds(uid, fastmailMailSource(state, () => client(state)), ids.map(fastmailRecordId), { generation }),
        saveState: (state, emailState, generation) =>
          updateFastmailLive(db, uid, state.emailAddress, { emailState, lastPolledAt: new Date().toISOString() }, generation),
      });
      if (result.kind === "processed" || result.kind === "superseded") {
        totals.messages += result.messages;
        if (result.messages > 0 || result.kind === "superseded") log("INFO", `fastmail_poll_${result.kind}`, { uid, messages: result.messages, ...result.counts });
      } else if (result.kind === "expired") {
        log("WARNING", "fastmail_changes_expired", { uid, since: result.since });
      }
    } catch (error) {
      totals.failed += 1;
      const rejected = error instanceof JmapHttpError && (error.status === 401 || error.status === 403);
      log(rejected ? "WARNING" : "ERROR", rejected ? "fastmail_token_rejected" : "fastmail_poll_failed", { uid, ...errorFields(error) });
    }
  }
  return totals;
}

// Each IMAP mailbox on one connection: the inbox opened read-only, the
// UIDs above the last one read imported, and the place moved on. A
// mailbox whose password the server refused within the hour is skipped,
// so the provider sees no stream of failed logins.
async function pollImapMailboxes(isApproved: (uid: string) => Promise<boolean>) {
  const mailboxes = await onlyApproved(await imapMailboxesToPoll(db), isApproved, log);
  const totals = { mailboxes: mailboxes.length, messages: 0, failed: 0, paused: 0 };
  for (const { uid, emailAddress } of mailboxes) {
    const key = mailboxKey(emailAddress);
    let source: ImapSource | undefined;
    try {
      const stored = await loadImapMailbox(db, uid, { emailAddress });
      if (!stored) continue;
      if (inLoginBackoff(stored, Date.now())) {
        totals.paused += 1;
        continue;
      }
      const opened = imapMailSource(uid, stored, true);
      source = opened;
      const result = await pollNewMail({
        resetGeneration: () => deps.store.resetGeneration(uid),
        loadState: async () => stored,
        stateOf: (state) => state.mailboxState,
        currentState: async () => currentMailboxState(await opened.inbox()),
        createdSince: async (_state, since) => opened.newSince(since),
        importIds: async (_state, ids, generation) => importIds(uid, opened, ids, { generation }),
        saveState: (state, mailboxState, generation) =>
          updateImapLive(
            db,
            uid,
            state,
            { mailboxState, lastPolledAt: new Date().toISOString(), ...(state.loginFailedAt ? { loginFailedAt: null } : {}) },
            generation,
          ),
      });
      if (result.kind === "processed" || result.kind === "superseded") {
        totals.messages += result.messages;
        if (result.messages > 0 || result.kind === "superseded") log("INFO", `imap_poll_${result.kind}`, { uid, mailbox: key, messages: result.messages, ...result.counts });
      } else if (result.kind === "expired") {
        // UIDVALIDITY changed: the old UIDs name nothing now.
        log("WARNING", "imap_uidvalidity_changed", { uid, mailbox: key });
      }
    } catch (error) {
      totals.failed += 1;
      // A refused password was logged (imap_login_failed) where it happened.
      if (!isImapAuthFailure(error)) log("ERROR", "imap_poll_failed", { uid, mailbox: key, ...errorKind(error) });
    } finally {
      await source?.close();
    }
  }
  return totals;
}

// Gmail watches last seven days; Cloud Scheduler calls this daily.
app.post("/internal/renew-watches", async (c) => {
  await requireInternalCaller(c);
  const soon = Date.now() + 2 * 24 * 60 * 60 * 1000;
  const accounts = await db.collection("gmailAccounts").get();
  let renewed = 0;
  for (const doc of accounts.docs) {
    const uid = (doc.data() as { uid: string }).uid;
    // Keyed by the mailbox's address, as Gmail gives it.
    const state = await loadMailbox(db, uid, doc.id);
    if (!state) continue;
    if (state.watchExpiration && Date.parse(state.watchExpiration) > soon) continue;
    try {
      const watched = await watch(gmailFor(oauth, state.refreshToken), pubsubTopic);
      if (await updateWatch(db, uid, state.emailAddress, watched.expiration)) renewed += 1;
      else log("WARNING", "renewed_watch_for_disconnected_user", { uid, mailbox: mailboxKey(state.emailAddress) });
    } catch (error) {
      log("ERROR", "renew_watch_failed", { uid, mailbox: mailboxKey(state.emailAddress), ...errorKind(error) });
    }
  }
  log("INFO", "watches_renewed", { renewed, accounts: accounts.size });
  return c.json({ renewed });
});

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (c.req.path !== "/internal/pubsub/gmail" && c.req.path !== "/internal/backfill") log("ERROR", "unhandled", { path: c.req.path, ...errorFields(error) });
  return c.text("Internal error", 500);
});

// Accounts from before approvals are let in before this revision serves
// (SPEC "Access"); a first run that fails stops the start, so Cloud Run
// keeps the previous revision and CI deploys no rules.
try {
  await grandfatherOnStart({ db, now: deps.now, log, verifiedEmail });
} catch (error) {
  log("ERROR", "access_grandfather_first_run_failed", errorFields(error));
  process.exit(1);
}

// Mailboxes connected before there could be several move to where each is
// kept now (connections.ts). Every reader reads both places meanwhile, and
// any user's mailboxes move when next loaded, so this runs alongside
// serving rather than before it.
// Then, with a key, credentials stored before there was one are sealed
// (sealStored.ts); every reader takes either meanwhile.
void moveLegacyMailboxes(db, log)
  .then((result) => log("INFO", "gmail_moved", result))
  .catch((error: unknown) => log("ERROR", "gmail_move_failed", errorKind(error)))
  .then(async () => {
    if (!credentialsKey) return;
    try {
      log("INFO", "credentials_sealed", await sealStoredCredentials(db, log));
    } catch (error) {
      log("ERROR", "credentials_seal_failed", errorKind(error));
    }
  })
  // Then, once per revision, loyalty numbers kept by earlier versions are
  // filed as they would be now (loyaltyRevision.ts), reading again only
  // the emails that need it.
  .then(async () => {
    try {
      const result = await reviseFoundLoyaltyOnce({ db, extract: deps.extract, mailbox: (uid, messageId) => recordMailbox(uid, messageId, true), now: deps.now, log });
      if (result) log("INFO", "found_loyalty_revised", result);
    } catch (error) {
      log("ERROR", "found_loyalty_revision_failed", errorKind(error));
    }
  })
  // Then, once, the requests for access left from before invite-only go
  // (dropAccessRequests.ts).
  .then(async () => {
    try {
      await dropAccessRequests(db, log);
    } catch (error) {
      log("ERROR", "access_requests_drop_failed", errorKind(error));
    }
  });

const port = Number(optionalEnv("PORT", "8080"));
serve({ fetch: app.fetch, port }, () => log("INFO", "listening", { port, geminiModel, embeddingModel }));
