"use client";

import type { ParsedMessage } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { api } from "@/lib/api";
import { firestore } from "@/lib/firebase";
import { useSaveForOffline } from "@/lib/offline";
import { domainOf, effectiveDecision, learnSender } from "@/lib/patterns";
import { useParsedMessages, useSenderPatterns } from "@/lib/trips";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

const outcomeLabels: Record<ParsedMessage["outcome"], string> = {
  processing: "Processing",
  filtered: "Skipped before reading",
  not_booking: "Read, not a booking",
  imported: "Imported",
  failed: "Failed",
};

function ReviewList({ user }: { user: User }) {
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
    <section>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Recent emails and other imports that did not become bookings. Teach the importer about a sender, or import one anyway.
      </p>
      {records === undefined && <p className="mt-3 text-muted">Loading…</p>}
      {records && toReview.length === 0 && <p className="mt-3 text-sm text-muted">Nothing to review.</p>}
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
                {notice[record.messageId] && <span className="self-center text-muted">{notice[record.messageId]}</span>}
              </div>
            </li>
          );
        })}
      </ul>
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
