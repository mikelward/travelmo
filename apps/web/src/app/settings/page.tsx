"use client";

import { paths, type ParsedMessage, type SenderPatterns } from "@travelmo/core";
import type { User } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { api } from "@/lib/api";
import { exportLinks, useCalendarExport } from "@/lib/calendarExport";
import { describeBackfill, pausedReason, readWholeMailbox } from "@/lib/backfill";
import { firestore } from "@/lib/firebase";
import { useInstall } from "@/lib/install";
import { useSaveForOffline } from "@/lib/offline";
import { domainOf, effectiveDecision, learnSender } from "@/lib/patterns";
import { describeCalendarResult, previewIcs } from "@/lib/ics";
import { describeTripItResult, previewTripIt } from "@/lib/tripit";
import { useFeeds, useParsedMessages, useProfile, useSenderPatterns } from "@/lib/trips";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function GmailSection({ user }: { user: User }) {
  const profile = useProfile(user.uid);
  const [reading, setReading] = useState(false);
  const stopReading = useRef(false);
  // Leaving the page stops a reading after its current batch, as Stop does;
  // its saved position lets it continue later.
  useEffect(
    () => () => {
      stopReading.current = true;
    },
    [],
  );
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

  // Reads batch after batch; progress lands on the profile, so the line
  // below follows it, and it survives closing the page.
  const readMailbox = (restart: boolean) =>
    run(async () => {
      stopReading.current = false;
      setReading(true);
      try {
        const last = await readWholeMailbox((r) => api.backfill(user, r), {
          restart,
          onBatch: () => {},
          stopped: () => stopReading.current,
        });
        const paused = pausedReason(last);
        if (paused) setError(paused);
      } finally {
        setReading(false);
      }
    });

  const gmail = profile?.gmail;
  const progress = gmail?.backfill;
  return (
    <section>
      <h2 className="text-lg font-medium">Gmail</h2>
      {profile === undefined && <p className="mt-2 text-zinc-500">Loading…</p>}
      {profile && !gmail && (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Travelmo reads booking confirmations from your inbox and turns them into trips. It asks for read-only
            access and only sends emails that look like bookings to the extraction model.
          </p>
          <button
            type="button"
            disabled={busy}
            className={`${buttonClass} mt-3`}
            onClick={() =>
              run(async () => {
                const { url } = await api.connectGmail(user);
                window.location.assign(url);
              })
            }
          >
            Connect Gmail
          </button>
        </>
      )}
      {gmail && (
        <>
          <p className="mt-2 text-sm">
            Connected as <span className="font-medium">{gmail.emailAddress}</span>. New bookings import automatically;
            past ones come in when you read your mailbox, in batches of 300 emails, as far back as it goes.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {reading ? (
              <button type="button" className={buttonClass} onClick={() => (stopReading.current = true)}>
                Stop
              </button>
            ) : (
              <button type="button" disabled={busy} className={buttonClass} onClick={() => readMailbox(!!progress?.done)}>
                {!progress ? "Import past bookings" : progress.done ? "Read again from the start" : "Continue reading past emails"}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => run(() => api.disconnectGmail(user))}
            >
              Disconnect
            </button>
          </div>
          {progress && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400" data-testid="backfill-progress">
              {describeBackfill(progress, reading)}
            </p>
          )}
        </>
      )}
      {notice && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{notice}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}

type FilePreview = { text: string; canImport: boolean; notImported?: { title: string; reason: string }[]; run: () => Promise<string> };

// Picks a file, shows what reading it in the browser found, and sends it
// only when the user presses Import.
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
                {preview.notImported.map((item, i) => (
                  <li key={i}>
                    {item.title}: {item.reason}
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
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
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
          notImported: p.parsed.skipped,
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
                  <p className={`ml-6 ${cal.lastError ? "text-red-600" : "text-zinc-600 dark:text-zinc-400"}`}>
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
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
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
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        />
        <button type="submit" disabled={busy || !url.trim()} className={buttonClass}>
          {busy ? "Reading…" : "Add feed"}
        </button>
      </form>
      {result && <p className="mt-3 text-sm text-green-700 dark:text-green-500">{result}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
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
                {feed.lastError && <p className="text-red-600">{feed.lastError}</p>}
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

function PatternsSection({ user }: { user: User }) {
  const saved = useSenderPatterns(user.uid);
  const [draft, setDraft] = useState<SenderPatterns>();
  const [status, setStatus] = useState<string>();
  const patterns = draft ?? saved;

  const save = async () => {
    if (!patterns) return;
    const clean = (list: string[]) => [...new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean))];
    const next = { allow: clean(patterns.allow), deny: clean(patterns.deny) };
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
      <span className="ml-2 text-zinc-500">{hint}</span>
      <textarea
        rows={3}
        value={(patterns?.[key] ?? []).join("\n")}
        onChange={(e) => setDraft({ allow: [], deny: [], ...patterns, [key]: e.target.value.split("\n") })}
        className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-zinc-700"
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
        {status && <span className="text-sm text-zinc-500">{status}</span>}
      </div>
    </section>
  );
}

const outcomeLabels: Record<ParsedMessage["outcome"], string> = {
  processing: "Processing",
  filtered: "Skipped before reading",
  not_booking: "Read, not a booking",
  imported: "Imported",
  failed: "Failed",
};

function ReviewSection({ user }: { user: User }) {
  const records = useParsedMessages(user.uid);
  const patterns = useSenderPatterns(user.uid);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<Record<string, string>>({});
  const toReview = records?.filter((r) => r.outcome !== "imported" && r.outcome !== "processing") ?? [];

  const act = async (record: ParsedMessage, action: () => Promise<string>) => {
    setBusy(record.messageId);
    try {
      const result = await action();
      setNotice((n) => ({ ...n, [record.messageId]: result }));
    } catch (e) {
      setNotice((n) => ({ ...n, [record.messageId]: (e as Error).message }));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Import review</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Recent emails and other imports that did not become bookings. Teach the importer about a sender, or import one anyway.
      </p>
      {records === undefined && <p className="mt-3 text-zinc-500">Loading…</p>}
      {records && toReview.length === 0 && <p className="mt-3 text-sm text-zinc-500">Nothing to review.</p>}
      <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
        {toReview.map((record) => {
          // Records from other sources have no sender to teach and no email
          // to read again.
          const fromGmail = (record.source ?? "gmail") === "gmail";
          const domain = fromGmail && record.from ? domainOf(record.from) : undefined;
          const decision = domain ? effectiveDecision(patterns, domain) : undefined;
          return (
            <li key={record.messageId} className="py-3 text-sm">
              <p className="font-medium">{record.subject || "(no subject)"}</p>
              <p className="text-zinc-600 dark:text-zinc-400">
                {record.from || "unknown sender"} · {outcomeLabels[record.outcome]}
                {record.reason ? ` (${record.reason})` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {fromGmail && (
                  <button
                    type="button"
                    disabled={busy === record.messageId}
                    className={buttonClass}
                    onClick={() => act(record, async () => (await api.reimport(user, record.messageId)).outcome)}
                  >
                    Import anyway
                  </button>
                )}
                {domain && decision !== "allow" && (
                  <button
                    type="button"
                    disabled={busy === record.messageId}
                    className={buttonClass}
                    onClick={() => act(record, async () => (await learnSender(firestore(), user.uid, domain, "allow"), `Always importing ${domain}`))}
                  >
                    Always import {domain}
                  </button>
                )}
                {domain && decision !== "deny" && (
                  <button
                    type="button"
                    disabled={busy === record.messageId}
                    className={buttonClass}
                    onClick={() => act(record, async () => (await learnSender(firestore(), user.uid, domain, "deny"), `Never importing ${domain}`))}
                  >
                    Never import {domain}
                  </button>
                )}
                {notice[record.messageId] && <span className="self-center text-zinc-500">{notice[record.messageId]}</span>}
              </div>
            </li>
          );
        })}
      </ul>
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
            className="mt-3 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
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
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}

export default function SettingsPage() {
  useSaveForOffline();
  return (
    <SignInGate>
      {(user) => (
        <>
          <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
          <InstallSection />
          <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
            <GmailSection user={user} />
          </Suspense>
          <TripItSection user={user} />
          <CalendarSection user={user} />
          <FeedsSection user={user} />
          <Suspense fallback={null}>
            <GoogleCalendarSection user={user} />
          </Suspense>
          <CalendarExportSection user={user} />
          <PatternsSection user={user} />
          <ReviewSection user={user} />
        </>
      )}
    </SignInGate>
  );
}
