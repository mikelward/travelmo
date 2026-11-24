"use client";

import { dayRange, reviewDate, toReview, withLatest, type ParsedMessage, type ReviewSearch } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { api } from "@/lib/api";
import { firestore } from "@/lib/firebase";
import { useSaveForOffline } from "@/lib/offline";
import { domainOf, effectiveDecision, learnSender } from "@/lib/patterns";
import { isFromMailbox, recordSourceLabels } from "@/lib/sourceLinks";
import { useAllParsedMessages, useParsedMessages, useSenderPatterns } from "@/lib/trips";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

const fieldClass = "mt-1 rounded-lg border border-field bg-background px-3 py-2";

// How many records the list shows, newest first, until a search looks
// through them all.
const recent = 100;

const outcomeLabels: Record<ParsedMessage["outcome"], string> = {
  processing: "Processing",
  filtered: "Skipped before reading",
  not_booking: "Read, not a booking",
  imported: "Imported",
  failed: "Failed",
  cancellation: "Cancellation",
};

function ReviewList({ user }: { user: User }) {
  const [search, setSearch] = useState<ReviewSearch>({ keyword: "", from: "", to: "" });
  const searching = Boolean(search.keyword.trim() || search.from || search.to);
  const latest = useParsedMessages(user.uid, recent);
  const all = useAllParsedMessages(user.uid, searching);
  // A search's records are read once; the live latest show any read again since.
  const records = searching ? (all ? withLatest(all.records, latest ?? []) : undefined) : latest;
  const patterns = useSenderPatterns(user.uid);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<Record<string, string>>({});
  // After Import anyway, what was read and what the model said, to copy.
  const [reports, setReports] = useState<Record<string, string>>({});
  const copyReport = async (messageId: string, report: string) => {
    try {
      await navigator.clipboard.writeText(report);
      setNotice((n) => ({ ...n, [messageId]: "Report copied" }));
    } catch (e) {
      console.error("Copying an import report failed", e);
      setNotice((n) => ({ ...n, [messageId]: "Couldn't copy the report" }));
    }
  };
  // A row keeps its report to copy once Import anyway made a booking of it.
  const shown = records ? toReview(records, search.keyword, dayRange(search.from, search.to), new Set(Object.keys(reports))) : [];

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
    <section>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Recent emails and other imports that did not become bookings. Teach the importer about a sender, or import one anyway.
      </p>
      {records === undefined && <p className="mt-3 text-muted">Loading…</p>}
      <form role="search" className="mt-4 flex flex-wrap items-end gap-3 text-sm" onSubmit={(e) => e.preventDefault()}>
        <label className="flex flex-col">
          <span className="font-medium">Search</span>
          <input
            type="search"
            value={search.keyword}
            placeholder="Subject or sender"
            onChange={(e) => setSearch({ ...search, keyword: e.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col">
          <span className="font-medium">From</span>
          <input type="date" value={search.from} max={search.to || undefined} onChange={(e) => setSearch({ ...search, from: e.target.value })} className={fieldClass} />
        </label>
        <label className="flex flex-col">
          <span className="font-medium">To</span>
          <input type="date" value={search.to} min={search.from || undefined} onChange={(e) => setSearch({ ...search, to: e.target.value })} className={fieldClass} />
        </label>
        {searching && (
          <button type="button" className={buttonClass} onClick={() => setSearch({ keyword: "", from: "", to: "" })}>
            Clear
          </button>
        )}
      </form>
      {records && shown.length === 0 && (!searching || all?.done) && <p className="mt-3 text-sm text-muted">{searching ? "Nothing matches." : "Nothing to review."}</p>}
      <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
        {shown.map((record) => {
          // Records from other sources have no sender to teach and no email
          // to read again.
          const fromMailbox = isFromMailbox(record);
          const domain = fromMailbox && record.from ? domainOf(record.from) : undefined;
          const decision = domain ? effectiveDecision(patterns, domain) : undefined;
          return (
            <li key={record.messageId} className="py-3 text-sm">
              <p className="font-medium">{record.subject || "(no subject)"}</p>
              <p className="text-zinc-600 dark:text-zinc-400">
                {reviewDate(record)} · {record.from || "unknown sender"} · {recordSourceLabels[record.source ?? "gmail"]} ·{" "}
                {outcomeLabels[record.outcome]}
                {record.reason ? ` (${record.reason})` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {fromMailbox && (
                  <button
                    type="button"
                    disabled={busy === record.messageId}
                    className={buttonClass}
                    onClick={() =>
                      act(record, async () => {
                        const { outcome, report } = await api.reimport(user, record.messageId);
                        if (report) setReports((r) => ({ ...r, [record.messageId]: report }));
                        return outcome;
                      })
                    }
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
                {reports[record.messageId] && (
                  <button type="button" className={buttonClass} onClick={() => copyReport(record.messageId, reports[record.messageId]!)}>
                    Copy report
                  </button>
                )}
                {notice[record.messageId] && <span className="self-center text-muted">{notice[record.messageId]}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {!searching && latest && latest.length === recent && (
        <p className="mt-3 text-sm text-muted">Showing the {recent} most recent. Search to find older ones.</p>
      )}
      {searching && all && !all.done && <p className="mt-3 text-sm text-muted">Searching…</p>}
    </section>
  );
}

export default function ImportReviewPage() {
  useSaveForOffline();
  return (
    <SignInGate>
      {(user) => (
        <>
          <p className="mb-2 text-sm">
            <Link href="/settings" className="underline">
              Settings
            </Link>
          </p>
          <h1 className="mb-6 text-2xl font-semibold">Import review</h1>
          <ReviewList user={user} />
        </>
      )}
    </SignInGate>
  );
}
