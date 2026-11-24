"use client";

import { RideCompany, cleanSenderList, imapMailboxes, imapRedirect, imapServerFor, maxImapMailboxes, parseCountries, describeBackfill, describeDeletedTrips, gmailMailboxes, isReading, maxGmailMailboxes, pausedReason, describeRegroup, describeRefresh, groupSkips, refreshBlurb, refreshButton, failedEmailIds, failedEmailLine, failedEmailsReport, gmailSourceLink, moreFailedEmails, ParsedMessage, type RefreshProgress, type Trip, maxRideCompanies, paths, type BackfillProgress, type GmailConnection, type ImapConnection, type SenderPatterns, type SkipGroup } from "@travelmo/core";
import type { User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { AccountDeleted, DeleteAccountSection, useAccountDeletion } from "@/components/DeleteAccount";
import { EmailAddressesSection } from "@/components/EmailAddresses";
import { ReportDialog } from "@/components/ReportBug";
import { SegmentForm } from "@/components/SegmentForm";
import { addSegmentToFittingTrip } from "@/lib/edits";
import { TripRemindersSection } from "@/components/Checklist";
import { SignInGate } from "@/components/SignInGate";
import { api } from "@/lib/api";
import { exportLinks, useCalendarExport } from "@/lib/calendarExport";
import { useAuth } from "@/lib/auth";
import { firestore } from "@/lib/firebase";
import { useInstall } from "@/lib/install";
import { useSaveForOffline } from "@/lib/offline";
import { subscribePush, unsubscribePush, usePushState } from "@/lib/push";
import { describeCalendarResult, previewIcs } from "@/lib/ics";
import { describeTripItResult, previewTripIt } from "@/lib/tripit";
import { isFromMailbox } from "@/lib/sourceLinks";
import { useFeeds, useProfile, useSenderPatterns, useTrips } from "@/lib/trips";
import { countryName } from "@/lib/countries";
import { addRideCompany, removeRideCompany } from "@/lib/rides";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function GmailSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("gmail");
  const completion = params.get("state");
  const [busy, setBusy] = useState(status === "pending");
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string | undefined>(() => {
    if (status === "denied") return "Gmail access was not granted.";
    if (status === "error") return "Connecting Gmail failed. Try again.";
    return undefined;
  });

  // Google sent the browser back via the parser; finishing the connection
  // from here proves the signed-in user is the one who started it.
  const completed = useRef(false);
  useEffect(() => {
    if (status !== "pending" || !completion || completed.current) return;
    completed.current = true;
    api
      .completeGmail(user, completion)
      .then(({ emailAddress }) => setNotice(`Gmail connected as ${emailAddress}. Import your past bookings below.`))
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        router.replace("/settings");
      });
  }, [status, completion, user, router]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mailboxes = profile ? gmailMailboxes(profile) : [];
  const connect = () =>
    run(async () => {
      const { url } = await api.connectGmail(user);
      window.location.assign(url);
    });
  return (
    <section>
      <h2 className="text-lg font-medium">Gmail</h2>
      {profile === undefined && <p className="mt-2 text-muted">Loading…</p>}
      {profile && mailboxes.length === 0 && (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Travelmo reads booking confirmations from your inbox and turns them into trips. It asks for read-only
            access and only sends emails that look like bookings to the extraction model.
          </p>
          <button type="button" disabled={busy} className={`${buttonClass} mt-3`} onClick={connect}>
            Connect Gmail
          </button>
        </>
      )}
      {mailboxes.length > 0 && (
        <>
          <p className="mt-2 text-sm">
            New bookings import automatically; past ones come in when you import them, as far back as each mailbox goes.
          </p>
          <ul className="mt-3 space-y-4">
            {mailboxes.map((mailbox) => (
              <MailboxRow key={mailbox.emailAddress} user={user} mailbox={mailbox} busy={busy} run={run} />
            ))}
          </ul>
          {mailboxes.length < maxGmailMailboxes ? (
            <button type="button" disabled={busy} className={`${buttonClass} mt-4`} onClick={connect}>
              Connect another Gmail account
            </button>
          ) : (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              You can connect up to {maxGmailMailboxes} Gmail accounts. Disconnect one to connect another.
            </p>
          )}
        </>
      )}
      {notice && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{notice}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

// One connected mailbox: its address, how far reading its past emails has
// got, and its own Import past bookings and Disconnect. The parser reads
// the mailbox on its own once started, and records its progress on the
// profile, which the line below follows.
function MailboxRow({
  user,
  mailbox,
  busy,
  run,
}: {
  user: User;
  mailbox: GmailConnection;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const address = mailbox.emailAddress;
  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="gmail-mailbox">
      <p className="text-sm font-medium">{address}</p>
      <PastBookings
        progress={mailbox.backfill}
        busy={busy}
        testId="backfill-progress"
        onStart={(restart) => void run(async () => void (await api.startBackfill(user, address, restart)))}
        onStop={() => void run(() => api.stopBackfill(user, address))}
      >
        <button type="button" disabled={busy} className={buttonClass} onClick={() => run(() => api.disconnectGmail(user, address))}>
          Disconnect
        </button>
      </PastBookings>
    </li>
  );
}

// "Import past bookings" for a connected mailbox: start, continue, read again
// from the start or stop, with how far the parser has got. The parser reads
// the mailbox on its own once started, and records its progress on the
// profile, which the line below follows. `children` go beside the button.
function PastBookings({
  progress,
  busy,
  testId,
  onStart,
  onStop,
  children,
}: {
  progress: BackfillProgress | undefined;
  busy: boolean;
  testId: string;
  onStart: (restart: boolean) => void;
  onStop: () => void;
  children?: ReactNode;
}) {
  // The clock a stalled reading is judged by; a minute is fine enough.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const reading = isReading(progress, now);
  const paused = pausedReason(progress, reading);
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {reading ? (
          <button type="button" disabled={busy} className={buttonClass} onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" disabled={busy} className={buttonClass} onClick={() => onStart(!!progress?.done)}>
            {!progress ? "Import past bookings" : progress.done ? "Read again from the start" : "Continue reading past emails"}
          </button>
        )}
        {children}
      </div>
      {progress && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400" data-testid={testId}>
          {describeBackfill(progress, reading)}
        </p>
      )}
      {paused && <p className="mt-3 text-sm text-danger">{paused}</p>}
    </>
  );
}

// Where Fastmail makes API tokens.
const fastmailTokensUrl = "https://app.fastmail.com/settings/security/tokens";

// Fastmail has no sign-in for apps like this one, so the user makes a
// read-only API token there and pastes it here; the parser keeps it.
function FastmailSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [disconnected, setDisconnected] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(undefined);
    setDisconnected(false);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      // Logged without the message, which may quote the mailbox's address.
      console.error("A Fastmail action failed", { error: (e as Error).name });
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { emailAddress } = await api.connectFastmail(user, token.trim());
      setToken("");
      setNotice(`Fastmail connected as ${emailAddress}. Import your past bookings below.`);
    });
  };

  const fastmail = profile?.fastmail;
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Fastmail</h2>
      {profile === undefined && <p className="mt-2 text-muted">Loading…</p>}
      {profile && !fastmail && (
        <form onSubmit={connect}>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Imports booking confirmations from your Fastmail inbox, checking for new ones every few minutes.{" "}
            <a href={fastmailTokensUrl} target="_blank" rel="noreferrer" className="underline">
              Make a read-only API token
            </a>{" "}
            with Email access, then paste it here.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col">
              <span className="font-medium">API token</span>
              <input
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="mt-1 rounded-lg border border-field bg-background px-3 py-2"
              />
            </label>
            <button type="submit" disabled={busy || !token.trim()} className={buttonClass}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      )}
      {fastmail && (
        <>
          <p className="mt-2 text-sm">
            Connected as <span className="font-medium">{fastmail.emailAddress}</span>. New bookings import automatically;
            past ones come in when you import them, as far back as your mailbox goes.
          </p>
          <PastBookings
            progress={fastmail.backfill}
            busy={busy}
            testId="fastmail-backfill-progress"
            onStart={(restart) => run(async () => void (await api.startFastmailBackfill(user, restart)))}
            onStop={() => run(() => api.stopFastmailBackfill(user))}
          >
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() =>
                run(async () => {
                  await api.disconnectFastmail(user);
                  setDisconnected(true);
                })
              }
            >
              Disconnect
            </button>
          </PastBookings>
        </>
      )}
      {notice && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{notice}</p>}
      {disconnected && (
        <p className="mt-3 text-sm">
          Fastmail disconnected.{" "}
          <a href={fastmailTokensUrl} target="_blank" rel="noreferrer" className="underline">
            Delete the API token in Fastmail
          </a>{" "}
          too, as Travelmo can&apos;t.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

// Where iCloud and Yahoo explain making an app password.
const icloudAppPasswords = "https://support.apple.com/en-us/102654";
const yahooAppPasswords = "https://help.yahoo.com/kb/SLN15241.html";

// Any other mailbox, read over IMAP with an app password the user makes
// with their provider (iCloud, Yahoo and others offer apps like this one no
// sign-in of their own). The server is filled in for providers Travelmo
// knows; the parser keeps the password.
function ImapSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [disconnected, setDisconnected] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(undefined);
    setDisconnected(false);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      // Logged without the message, which may quote the mailbox's address.
      console.error("An IMAP action failed", { error: (e as Error).name });
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const typed = address.trim();
  const redirect = typed.includes("@") ? imapRedirect(typed) : undefined;
  const choice = imapServerFor(typed);
  const needsServer = typed.includes("@") && choice.kind === "other";
  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { emailAddress } = await api.connectImap(user, typed, password, needsServer ? server.trim() : undefined);
      setAddress("");
      setPassword("");
      setServer("");
      setNotice(`Connected ${emailAddress}. Import your past bookings below.`);
    });
  };

  const mailboxes = profile ? imapMailboxes(profile) : [];
  const field = "mt-1 rounded-lg border border-field bg-background px-3 py-2";
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Other email (IMAP)</h2>
      {profile === undefined && <p className="mt-2 text-muted">Loading…</p>}
      {mailboxes.length > 0 && (
        <ul className="mt-3 space-y-4">
          {mailboxes.map((mailbox) => (
            <ImapMailboxRow
              key={mailbox.emailAddress}
              user={user}
              mailbox={mailbox}
              busy={busy}
              run={run}
              onDisconnected={() => setDisconnected(true)}
            />
          ))}
        </ul>
      )}
      {profile && mailboxes.length >= maxImapMailboxes && (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          You can connect up to {maxImapMailboxes} mailboxes this way. To connect another, disconnect one; to give one a
          new app password, connect it again below.
        </p>
      )}
      {/* At the limit, the form still gives a connected mailbox a new app password; the parser refuses only a new address. */}
      {profile && (
        <form onSubmit={connect} data-testid="imap-connect">
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Imports booking confirmations from another inbox, such as iCloud or Yahoo, checking for new ones every few
            minutes. Use an app password, not your usual one:{" "}
            <a href={icloudAppPasswords} target="_blank" rel="noreferrer" className="underline">
              iCloud
            </a>
            ,{" "}
            <a href={yahooAppPasswords} target="_blank" rel="noreferrer" className="underline">
              Yahoo
            </a>
            .
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
            <label className="flex flex-col">
              <span className="font-medium">Email address</span>
              <input type="email" autoComplete="email" required value={address} onChange={(e) => setAddress(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col">
              <span className="font-medium">App password</span>
              <input
                type="password"
                autoComplete="off"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
            </label>
            {needsServer && (
              <label className="flex flex-col">
                <span className="font-medium">Server</span>
                <input
                  type="text"
                  autoComplete="off"
                  required
                  placeholder="imap.example.com"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className={field}
                />
              </label>
            )}
            <button type="submit" disabled={busy || !!redirect || !typed || !password.trim() || (needsServer && !server.trim())} className={buttonClass}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
          {redirect && <p className="mt-2 text-sm">{redirect}</p>}
        </form>
      )}
      {notice && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{notice}</p>}
      {disconnected && <p className="mt-3 text-sm">Disconnected. Delete the app password with your email provider too.</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

// One mailbox connected over IMAP, as a Gmail one: its address, its own
// Import past bookings and Disconnect, and whether its server turned the
// app password down.
function ImapMailboxRow({
  user,
  mailbox,
  busy,
  run,
  onDisconnected,
}: {
  user: User;
  mailbox: ImapConnection;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onDisconnected: () => void;
}) {
  const address = mailbox.emailAddress;
  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="imap-mailbox">
      <p className="text-sm font-medium">{address}</p>
      {mailbox.loginFailedAt && (
        <p className="mt-1 text-sm text-danger">The server turned down the app password. Connect again with a new one.</p>
      )}
      <PastBookings
        progress={mailbox.backfill}
        busy={busy}
        testId="imap-backfill-progress"
        onStart={(restart) => void run(async () => void (await api.startImapBackfill(user, address, restart)))}
        onStop={() => void run(() => api.stopImapBackfill(user, address))}
      >
        <button
          type="button"
          disabled={busy}
          className={buttonClass}
          onClick={() =>
            run(async () => {
              await api.disconnectImap(user, address);
              onDisconnected();
            })
          }
        >
          Disconnect
        </button>
      </PastBookings>
    </li>
  );
}

type FilePreview = { text: string; canImport: boolean; notImported?: SkipGroup[]; run: () => Promise<string> };

// Picks a file, shows what reading it in the browser found, and sends it
// only when the user presses Import.
// Files every booking again with the grouping imports use now, for trips
// imported before it knew where home was.
function RegroupSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  const regroup = async () => {
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    try {
      setResult(describeRegroup(await api.regroupTrips(user)));
    } catch (e) {
      console.error("Regrouping trips failed", e);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Deleting them all asks first, in the page, with how many will go.
  const own = useTrips(user)?.filter((t) => t.ownerUid === user.uid).length;
  const [confirming, setConfirming] = useState(false);
  const deleteAll = async () => {
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    try {
      setResult(describeDeletedTrips((await api.deleteAllTrips(user)).trips));
      setConfirming(false);
    } catch (e) {
      console.error("Deleting all trips failed", e);
      setError(`Couldn't delete your trips: ${(e as Error).message}. Try again.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Trips</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Rebuilds your trips from your bookings, keeping days out at home separate from trips away.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button type="button" disabled={busy} className={buttonClass} onClick={() => void regroup()}>
          {busy && !confirming ? "Regrouping…" : "Regroup trips"}
        </button>
        {!confirming && (
          <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="text-danger hover:underline disabled:opacity-50">
            Delete all trips
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span>
            Delete all your trips and their bookings? Your profile and connections stay. This cannot be undone.
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void deleteAll()}
            className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
          >
            {busy ? "Deleting…" : own === undefined ? "Delete" : `Delete ${own} trip${own === 1 ? "" : "s"}`}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={buttonClass}>
            Keep
          </button>
        </div>
      )}
      {result && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{result}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <RefreshFromEmail user={user} progress={profile?.refresh} mailboxes={profile ? gmailMailboxes(profile) : []} />
    </section>
  );
}

// "Refresh from email": the emails the user's bookings came from read again
// and those bookings updated, on the server, batch after batch; the line
// below follows its progress on the profile, as Import past bookings does.
function RefreshFromEmail({ user, progress, mailboxes }: { user: User; progress: RefreshProgress | undefined; mailboxes: GmailConnection[] }) {
  const trips = useTrips(user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The clock a stalled refresh is judged by; a minute is fine enough.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const reading = isReading(progress, now);
  const run = async (action: () => Promise<unknown>, what: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      console.error(`${what} failed`, e);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-6" data-testid="refresh">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{refreshBlurb}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {reading ? (
          <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(() => api.stopRefresh(user), "Stopping the refresh")}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className={buttonClass}
            onClick={() => void run(() => api.refreshFromEmail(user, !!progress?.done), "Refreshing from email")}
          >
            {refreshButton(progress)}
          </button>
        )}
      </div>
      {progress && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400" data-testid="refresh-progress">
          {describeRefresh(progress, reading)}
        </p>
      )}
      {progress && !reading && failedEmailIds(progress).length > 0 && (
        <FailedEmails
          uid={user.uid}
          progress={progress}
          mailboxes={mailboxes}
          busy={busy}
          onTryAgain={() => void run(() => api.refreshFromEmail(user, false, true), "Trying the failed emails again")}
          trips={trips}
        />
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}

// The emails a refresh couldn't read, by subject and sender: each Gmail one
// opens in Gmail, to check it; Add it yourself takes its booking by hand
// into the trip it falls in, or a new one; Try again reads them alone
// again, and Report a problem sends us their ids.
function FailedEmails(props: {
  uid: string;
  progress: RefreshProgress;
  mailboxes: GmailConnection[];
  busy: boolean;
  onTryAgain: () => void;
  trips: Trip[] | undefined;
}) {
  const [adding, setAdding] = useState<string>();
  const [added, setAdded] = useState<Map<string, { tripId: string; title: string }>>(new Map());
  const ids = failedEmailIds(props.progress);
  const key = ids.join(",");
  const [records, setRecords] = useState<Map<string, ParsedMessage>>(new Map());
  const [reporting, setReporting] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all(
      key.split(",").map(async (id) => {
        try {
          const snap = await getDoc(doc(firestore(), paths.parsedMessage(props.uid, id)));
          const parsed = ParsedMessage.safeParse(snap.data());
          return parsed.success ? ([id, parsed.data] as const) : undefined;
        } catch (e) {
          // Listed by id alone, as if the record were gone.
          console.warn("Reading a failed email's import record failed", e);
          return undefined;
        }
      }),
    ).then((found) => live && setRecords(new Map(found.filter((f) => f !== undefined))));
    return () => {
      live = false;
    };
  }, [props.uid, key]);
  const more = moreFailedEmails(props.progress);
  return (
    <div className="mt-2" data-testid="refresh-failed">
      <ul className="list-disc pl-5 text-sm">
        {ids.map((id) => {
          const record = records.get(id);
          const gmail = record && isFromMailbox(record) && (record.source ?? "gmail") === "gmail";
          return (
            <li key={id} className="py-0.5">
              {failedEmailLine(record)}
              {gmail && (
                <>
                  {" · "}
                  <a href={gmailSourceLink(id, props.mailboxes)} target="_blank" rel="noreferrer" className="underline hover:no-underline">
                    Open in Gmail
                  </a>
                </>
              )}
              {added.get(id) ? (
                <>
                  {" · Added to "}
                  <Link href={`/trips/${added.get(id)!.tripId}`} className="underline hover:no-underline">
                    {added.get(id)!.title}
                  </Link>
                </>
              ) : (
                props.trips &&
                adding !== id && (
                  <>
                    {" · "}
                    <button type="button" onClick={() => setAdding(id)} className="underline hover:no-underline">
                      Add it yourself
                    </button>
                  </>
                )
              )}
              {adding === id && props.trips && (
                <SegmentForm
                  defaultDate={(record?.sentAt ?? new Date().toISOString()).slice(0, 10)}
                  onSave={async (extracted) => {
                    const into = await addSegmentToFittingTrip(firestore(), props.uid, props.trips!, extracted);
                    setAdded((was) => new Map(was).set(id, into));
                    setAdding(undefined);
                  }}
                  onCancel={() => setAdding(undefined)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {more && <p className="mt-1 text-sm text-muted">{more}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={props.busy} className={buttonClass} onClick={props.onTryAgain}>
          Try again
        </button>
        <button type="button" className={buttonClass} onClick={() => setReporting(true)}>
          Report a problem
        </button>
      </div>
      {reporting && <ReportDialog initialText={failedEmailsReport(props.progress)} onClose={() => setReporting(false)} />}
    </div>
  );
}

function FileImportSection(props: { title: string; blurb: string; accept: string; label: string; preview: (text: string) => FilePreview }) {
  const [preview, setPreview] = useState<FilePreview>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();

  const choose = async (file: File | undefined) => {
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    if (!file) return;
    try {
      setPreview(props.preview(await file.text()));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importNow = async () => {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await preview.run());
      setPreview(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">{props.title}</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{props.blurb}</p>
      <input
        type="file"
        accept={props.accept}
        aria-label={props.label}
        disabled={busy}
        className="mt-3 block text-sm"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so picking the same file again reads it again: a large
          // calendar comes in over several uploads of one file.
          e.target.value = "";
          void choose(file);
        }}
      />
      {preview && (
        <div className="mt-3 text-sm">
          <p>{preview.text}</p>
          {preview.notImported && preview.notImported.length > 0 && (
            <details className="mt-2 text-zinc-600 dark:text-zinc-400">
              <summary>Not imported</summary>
              <ul className="mt-1 list-disc pl-5">
                {/* An old account has a hundred reservations TripIt kept only the name of: one line per reason, the names behind it. */}
                {preview.notImported.map((group) => (
                  <li key={group.reason}>
                    <details>
                      <summary>
                        {group.reason} ({group.titles.length})
                      </summary>
                      <ul className="mt-1 list-[circle] pl-5">
                        {group.titles.map((title, i) => (
                          <li key={i}>{title}</li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button type="button" disabled={busy || !preview.canImport} className={`${buttonClass} mt-3`} onClick={importNow}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      )}
      {result && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{result}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

function TripItSection({ user }: { user: User }) {
  return (
    <FileImportSection
      title="TripIt"
      blurb="Bring in your TripIt history from the JSON export TripIt support sends on request. You will see what is in it before anything is imported; importing the same file twice changes nothing."
      accept=".json,application/json"
      label="TripIt export file"
      preview={(text) => {
        const p = previewTripIt(text);
        return {
          text: p.text,
          canImport: p.parsed.trips.length + p.parsed.unfiled.length > 0 || p.hasProfile,
          notImported: groupSkips(p.parsed.skipped),
          run: async () => describeTripItResult(await api.importTripIt(user, p.json)),
        };
      }}
    />
  );
}

function CalendarSection({ user }: { user: User }) {
  return (
    <FileImportSection
      title="Calendar file"
      blurb="Import bookings from an .ics file, such as a trip exported from TripIt or a calendar app. Events that look like travel are read like booking emails; up to 100 per upload, and uploading the same file again carries on where the last one stopped."
      accept=".ics,text/calendar"
      label="Calendar file"
      preview={(text) => {
        const p = previewIcs(text);
        return {
          text: p.text,
          canImport: p.importable > 0,
          run: async () => describeCalendarResult(await api.importIcs(user, p.fileText)),
        };
      }}
    />
  );
}

// The link's host, enough to recognize a feed without showing its secret.
function feedHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // Stored links were checked when added; this is only for display.
    return url;
  }
}

// Google Calendar: one consent, then the user ticks the calendars that hold
// travel; those are read at once and every day after.
function GoogleCalendarSection({ user }: { user: User }) {
  const connection = useProfile(user.uid)?.googleCalendar;
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("calendar");
  const completion = params.get("state");
  const [busy, setBusy] = useState(status === "pending");
  const [draft, setDraft] = useState<Set<string>>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string | undefined>(() => {
    if (status === "denied") return "Google Calendar access was not granted.";
    if (status === "error") return "Connecting Google Calendar failed. Try again.";
    return undefined;
  });

  const completed = useRef(false);
  useEffect(() => {
    if (status !== "pending" || !completion || completed.current) return;
    completed.current = true;
    api
      .completeCalendar(user, completion)
      .then(() => setNotice("Google Calendar connected. Choose the calendars that hold your travel."))
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        router.replace("/settings");
      });
  }, [status, completion, user, router]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saved = new Set(connection?.calendars.filter((c) => c.selected).map((c) => c.id));
  const chosen = draft ?? saved;
  const changed = draft !== undefined && (draft.size !== saved.size || [...draft].some((id) => !saved.has(id)));
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDraft(next);
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Google Calendar</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Travelmo reads the calendars you choose every day, like a calendar feed, with read-only access. Events Gmail
        added from your emails are skipped when Gmail is connected to the same account.
      </p>
      {!connection && (
        <button
          type="button"
          disabled={busy}
          className={`${buttonClass} mt-3`}
          onClick={() =>
            run(async () => {
              const { url } = await api.connectCalendar(user);
              window.location.assign(url);
            })
          }
        >
          Connect Google Calendar
        </button>
      )}
      {connection && (
        <>
          <p className="mt-2 text-sm">
            Connected as <span className="font-medium">{connection.emailAddress}</span>.
          </p>
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {connection.calendars.map((cal) => (
              <li key={cal.id} className="py-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={chosen.has(cal.id)} disabled={busy} onChange={() => toggle(cal.id)} />
                  <span className="font-medium">{cal.summary}</span>
                </label>
                {cal.selected && (cal.lastReadAt || cal.lastError) && (
                  <p className={`ml-6 ${cal.lastError ? "text-danger" : "text-zinc-600 dark:text-zinc-400"}`}>
                    {cal.lastError ?? `Read ${cal.lastReadAt!.slice(0, 10)}${cal.lastResult ? ` · ${cal.lastResult}` : ""}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !changed}
              className={buttonClass}
              onClick={() =>
                run(async () => {
                  const { read } = await api.selectCalendars(user, [...chosen]);
                  setDraft(undefined);
                  setNotice(read ? "Saved; the newly chosen calendars were read." : "Saved.");
                })
              }
            >
              {busy && changed ? "Reading…" : "Save choice"}
            </button>
            <button type="button" disabled={busy} className={buttonClass} onClick={() => run(() => api.disconnectCalendar(user))}>
              Disconnect
            </button>
          </div>
        </>
      )}
      {notice && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{notice}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

function FeedsSection({ user }: { user: User }) {
  const feeds = useFeeds(user.uid);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    try {
      setResult(describeCalendarResult(await api.addFeed(user, url)));
      setUrl("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(undefined);
    try {
      await api.removeFeed(user, id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Calendar feeds</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Paste a calendar subscription link, such as the one in TripIt&apos;s settings, and Travelmo reads it every day:
        new trips come in, and a cancelled event removes its booking unless you edited it or it also came from an
        email. Bookings stay when you remove a feed.
      </p>
      <form onSubmit={add} className="mt-3 flex flex-wrap gap-2">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="webcal://… or https://…"
          aria-label="Calendar feed link"
          className="min-w-0 flex-1 rounded-lg border border-field bg-background px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy || !url.trim()} className={buttonClass}>
          {busy ? "Reading…" : "Add feed"}
        </button>
      </form>
      {result && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{result}</p>}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {feeds && feeds.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {feeds.map((feed) => (
            <li key={feed.id} className="flex items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{feed.label ?? feedHost(feed.url)}</p>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {feed.lastFetchedAt ? `Read ${feed.lastFetchedAt.slice(0, 10)}` : "Not read yet"}
                  {feed.lastResult && !feed.lastError ? ` · ${feed.lastResult}` : ""}
                </p>
                {feed.lastError && <p className="text-danger">{feed.lastError}</p>}
              </div>
              <button type="button" className={buttonClass} onClick={() => remove(feed.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The user's own companies for cars and rides: a minicab firm near home for
// the airport run, or a rental company they like. Trip pages offer them on
// flights with no car or ride booked (rideNeeds in packages/core).
function RideCompaniesSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const companies = profile?.rideCompanies ?? [];
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [near, setNear] = useState<RideCompany["near"]>("home");
  const [countries, setCountries] = useState("");
  const [error, setError] = useState<string>();

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const where = parseCountries(countries);
    if ("unknown" in where) {
      setError(`${where.unknown} isn't a country.`);
      return;
    }
    const parsed = RideCompany.safeParse({ name, url, near, ...(where.countries.length ? { countries: where.countries } : {}) });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.path[0] === "name" ? "Enter a name." : "Use a link that starts with https://.");
      return;
    }
    try {
      await addRideCompany(user.uid, parsed.data);
      setName("");
      setUrl("");
      setCountries("");
    } catch (err) {
      console.error("Adding a ride company failed", err);
      setError((err as Error).message);
    }
  };

  const remove = async (company: RideCompany) => {
    setError(undefined);
    try {
      await removeRideCompany(user.uid, company);
    } catch (err) {
      console.error("Removing a ride company failed", err);
      setError((err as Error).message);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Car and ride companies</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Add your own airport transfer, taxi, and rental car companies.
      </p>
      <form onSubmit={add} className="mt-3 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          aria-label="Company name"
          className="min-w-0 flex-1 basis-32 rounded-lg border border-field bg-background px-3 py-2 text-sm"
        />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          aria-label="Booking page"
          className="min-w-0 flex-[2] basis-48 rounded-lg border border-field bg-background px-3 py-2 text-sm"
        />
        <select
          value={near}
          onChange={(e) => setNear(e.target.value as RideCompany["near"])}
          aria-label="Suggest for"
          className="rounded-lg border border-field bg-background px-3 py-2 text-sm"
        >
          <option value="home">Rides to and from home</option>
          <option value="anywhere">Cars wherever I land</option>
        </select>
        <input
          value={countries}
          onChange={(e) => setCountries(e.target.value)}
          placeholder="Countries (all if blank)"
          aria-label="Countries"
          className="min-w-0 flex-1 basis-48 rounded-lg border border-field bg-background px-3 py-2 text-sm"
        />
        <button type="submit" disabled={!name.trim() || !url.trim() || companies.length >= maxRideCompanies} className={buttonClass}>
          Add
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {companies.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="Your companies">
          {companies.map((c, i) => (
            <li key={`${c.name}|${c.url}|${i}`} className="flex items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <a href={c.url} target="_blank" rel="noreferrer" className="font-medium underline">
                  {c.name}
                </a>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {[c.near === "home" ? "Rides to and from home" : "Cars wherever I land", c.countries?.map(countryName).join(", ")].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button type="button" className={buttonClass} onClick={() => remove(c)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PatternsSection({ user }: { user: User }) {
  const saved = useSenderPatterns(user.uid);
  const [draft, setDraft] = useState<SenderPatterns>();
  const [status, setStatus] = useState<string>();
  const patterns = draft ?? saved;

  const save = async () => {
    if (!patterns) return;
    const next = { allow: cleanSenderList(patterns.allow), deny: cleanSenderList(patterns.deny) };
    try {
      await setDoc(doc(firestore(), paths.senderPatterns(user.uid)), next);
      setDraft(undefined);
      setStatus("Saved");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const field = (key: keyof SenderPatterns, label: string, hint: string) => (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <span className="ml-2 text-muted">{hint}</span>
      <textarea
        rows={3}
        value={(patterns?.[key] ?? []).join("\n")}
        onChange={(e) => setDraft({ allow: [], deny: [], ...patterns, [key]: e.target.value.split("\n") })}
        className="mt-1 w-full rounded-lg border border-field bg-background px-3 py-2 font-mono text-sm"
      />
    </label>
  );

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Sender rules</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        One domain per line. Always-import senders skip the subject check; never-import senders are dropped before
        anything is read.
      </p>
      <div className="mt-3 space-y-3">
        {field("allow", "Always import", "e.g. cove.example")}
        {field("deny", "Never import", "e.g. newsletters.example")}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={!draft} className={buttonClass} onClick={save}>
          Save
        </button>
        {status && <span className="text-sm text-muted">{status}</span>}
      </div>
    </section>
  );
}

// Reminders by email before a trip: an opt-in, mailed to the signed-in
// address by the parser's daily job.
function RemindersSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const [status, setStatus] = useState<string>();
  // The box follows the tap at once; the stored value catches up.
  const [chosen, setChosen] = useState<boolean>();
  const on = chosen ?? profile?.reminders?.email === true;
  const toggle = async (email: boolean) => {
    setStatus(undefined);
    setChosen(email);
    try {
      await setDoc(doc(firestore(), paths.user(user.uid)), { reminders: { email } }, { merge: true });
      setStatus(email ? "On" : "Off");
    } catch (e) {
      setChosen(undefined);
      setStatus((e as Error).message);
    }
  };
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Reminders</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        A month before a trip, and as things change, an email about passports or visas that run out too soon and what each
        country asks of your passport: the same warnings the trip page shows, each sent once.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => void toggle(e.target.checked)} />
        <span>
          Email me before a trip{user.email ? <span className="text-muted"> (to {user.email})</span> : null}
        </span>
      </label>
      {status && <p className="mt-2 text-sm text-muted">{status}</p>}
      <PushSwitch uid={user.uid} />
    </section>
  );
}

// The same reminders as notifications in this browser. Each browser
// subscribes for itself, so the switch is per browser, not per account.
function PushSwitch({ uid }: { uid: string }) {
  const initial = usePushState(uid);
  const [state, setState] = useState<"on" | "off">();
  const [note, setNote] = useState<string>();
  const current = state ?? initial;
  if (!current || current === "unsupported") return null;
  // The box follows the tap at once and comes back if the browser says no.
  const toggle = async (on: boolean) => {
    setNote(undefined);
    setState(on ? "on" : "off");
    try {
      if (!on) await unsubscribePush(uid);
      else if ((await subscribePush(uid)) === "denied") {
        setState("off");
        setNote("This browser blocks notifications from Travelmo; allow them in its site settings first.");
      }
    } catch (e) {
      setState(on ? "off" : "on");
      setNote((e as Error).message);
    }
  };
  return (
    <>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={current === "on"} onChange={(e) => void toggle(e.target.checked)} />
        <span>Notify me in this browser</span>
      </label>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
    </>
  );
}

// The list itself has its own page; Settings only points to it.
function ReviewSection() {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Import review</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Emails and other imports that did not become bookings.{" "}
        <Link href="/settings/review" className="underline">
          Review them
        </Link>
      </p>
    </section>
  );
}

// Shown only where installing is possible and not yet done.
function InstallSection() {
  const { hint, install } = useInstall();
  if (hint === "installed" || hint === "none") return null;
  return (
    <section className="mb-10">
      <h2 className="text-lg font-medium">Install Travelmo</h2>
      {hint === "prompt" ? (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Add Travelmo to your home screen or desktop: it opens in its own window, and trips you have opened stay
            readable offline.
          </p>
          <button type="button" className={`${buttonClass} mt-3`} onClick={() => void install()}>
            Install
          </button>
        </>
      ) : (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          To add Travelmo to your Home Screen, tap Share in Safari, then Add to Home Screen. It then opens on its own,
          and trips you have opened stay readable offline.
        </p>
      )}
    </section>
  );
}

function CalendarExportSection({ user }: { user: User }) {
  const record = useCalendarExport(user.uid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const links = record ? exportLinks(record.token) : undefined;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.https);
      setCopied(true);
    } catch (err) {
      setError(`Couldn't copy the link: ${(err as Error).message}. Select it and copy it instead.`);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Calendar export</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Show your trips and bookings in Google Calendar, Apple Calendar or Outlook through a link they check for
        changes, a few times a day. Anyone with the link can see your trips, confirmation numbers included, so keep it
        to yourself; replacing it stops the old one working.
      </p>
      {record === null && (
        <button type="button" disabled={busy} className={`${buttonClass} mt-3`} onClick={() => run(() => api.issueCalendarExport(user))}>
          {busy ? "Creating…" : "Create calendar link"}
        </button>
      )}
      {links && (
        <>
          <input
            readOnly
            value={links.https}
            aria-label="Calendar link"
            onFocus={(e) => e.target.select()}
            className="mt-3 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <a href={links.google} target="_blank" rel="noopener noreferrer" className={buttonClass}>
              Add to Google Calendar
            </a>
            <a href={links.webcal} className={buttonClass}>
              Open in Apple Calendar
            </a>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => {
                if (confirm("Replace the link? Calendars subscribed to the old one stop updating.")) void run(() => api.issueCalendarExport(user));
              }}
            >
              Replace link
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => {
                if (confirm("Turn off the calendar link? Calendars subscribed to it stop updating.")) void run(() => api.stopCalendarExport(user));
              }}
            >
              Turn off
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

// Settings is the one place the forwarding address appears; hidden when the
// deployment has no forwarding domain.
const forwardDomain = process.env.NEXT_PUBLIC_FORWARD_DOMAIN || undefined;

function ForwardSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const record = profile?.forward;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    setCopied(false);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!record) return;
    try {
      await navigator.clipboard.writeText(record.address);
      setCopied(true);
    } catch (err) {
      setError(`Couldn't copy the address: ${(err as Error).message}. Select it and copy it instead.`);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Forward by email</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        No Gmail, or a confirmation in another mailbox? Forward it to your own Travelmo address and it is read like any
        booking email, within a minute. The address is yours alone: anyone who has it can add bookings to your trips, so
        replace it if it gets out. Attachments are not read, so forward the email itself rather than a PDF.
      </p>
      {profile && !record && (
        <button type="button" disabled={busy} className={`${buttonClass} mt-3`} onClick={() => run(() => api.issueForward(user))}>
          {busy ? "Creating…" : "Create forwarding address"}
        </button>
      )}
      {record && (
        <>
          <input
            readOnly
            value={record.address}
            aria-label="Forwarding address"
            onFocus={(e) => e.target.select()}
            className="mt-3 w-full rounded-lg border border-field bg-background px-3 py-2 text-sm"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={copy}>
              {copied ? "Copied" : "Copy address"}
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => {
                if (confirm("Replace the address? Emails sent to the old one bounce from now on.")) void run(() => api.issueForward(user));
              }}
            >
              Replace address
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => {
                if (confirm("Turn off the forwarding address? Emails sent to it bounce from now on.")) void run(() => api.stopForward(user));
              }}
            >
              Turn off
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

function SignOutSection() {
  const { signOut } = useAuth();
  const [error, setError] = useState<string>();
  const signOutNow = async () => {
    setError(undefined);
    try {
      await signOut();
    } catch (e) {
      console.error("Signing out failed", e);
      setError(`Couldn't sign out: ${(e as Error).message}. Try again.`);
    }
  };
  return (
    <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <button type="button" onClick={() => void signOutNow()} className={buttonClass}>
        Sign out
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}

export default function SettingsPage() {
  useSaveForOffline();
  const { deleted, onDeleted } = useAccountDeletion();
  if (deleted) return <AccountDeleted />;
  return (
    <SignInGate>
      {(user) => (
        <>
          <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
          <InstallSection />
          <Suspense fallback={<p className="text-muted">Loading…</p>}>
            <GmailSection user={user} />
          </Suspense>
          <FastmailSection user={user} />
          <ImapSection user={user} />
          <RegroupSection user={user} />
          <TripItSection user={user} />
          <CalendarSection user={user} />
          <FeedsSection user={user} />
          {forwardDomain && <ForwardSection user={user} />}
          <Suspense fallback={null}>
            <GoogleCalendarSection user={user} />
          </Suspense>
          <CalendarExportSection user={user} />
          <EmailAddressesSection user={user} />
          <RemindersSection user={user} />
          <TripRemindersSection uid={user.uid} />
          <RideCompaniesSection user={user} />
          <PatternsSection user={user} />
          <ReviewSection />
          <DeleteAccountSection user={user} onDeleted={onDeleted} />
          <SignOutSection />
        </>
      )}
    </SignInGate>
  );
}
