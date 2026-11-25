"use client";

import { journeyGapText, type JourneyGap, type LookedEmail, type LookResult } from "@travelmo/core";
import { useState } from "react";

const link = "underline hover:no-underline disabled:opacity-50";

// What came of an email a look read, in a few words.
const outcomeText: Record<LookedEmail["outcome"], string> = {
  imported: "Added",
  cancellation: "A cancellation, applied",
  already: "Already in Travelmo",
  not_booking: "Not a booking",
  filtered: "Not a booking",
  failed: "Couldn't be read",
  busy: "Being imported now",
};

// The journeys a trip seems to be missing (journeyGaps): each with Look for
// it (the person's mailbox searched for its emails, read a few at a time)
// and, for those who may, adding it by hand; and, when one is at the trip's
// ends, saying the trip goes one way.
export function JourneyGapNotice({
  gaps,
  onLook,
  onAdd,
  onOneWay,
}: {
  gaps: readonly JourneyGap[];
  onLook?: (gap: JourneyGap, next?: number) => Promise<LookResult>;
  onAdd?: (date: string) => void;
  onOneWay: () => void;
}) {
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950" data-testid="journey-gap">
      {gaps.map((gap) => (
        <Gap key={`${gap.direction}-${gap.date}-${gap.from}-${gap.to}`} gap={gap} onLook={onLook} onAdd={onAdd} />
      ))}
      {gaps.some((gap) => gap.direction !== "between") && (
        <p>
          <button type="button" onClick={onOneWay} className={link}>
            This trip is one way
          </button>
        </p>
      )}
    </div>
  );
}

function Gap({ gap, onLook, onAdd }: { gap: JourneyGap; onLook?: ((gap: JourneyGap, next?: number) => Promise<LookResult>) | undefined; onAdd?: ((date: string) => void) | undefined }) {
  // Every email looked at so far, and where to keep looking from.
  const [looked, setLooked] = useState<{ emails: LookedEmail[]; next?: number }>();
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<string>();
  const look = async () => {
    if (!onLook) return;
    setLooking(true);
    setError(undefined);
    try {
      const result = await onLook(gap, looked?.next);
      setLooked((before) => ({ emails: [...(before?.emails ?? []), ...result.emails], ...(result.next !== undefined ? { next: result.next } : {}) }));
    } catch (e) {
      console.error("Looking for a missing journey failed", e);
      setError((e as Error).message);
    } finally {
      setLooking(false);
    }
  };
  const copy = async (email: LookedEmail) => {
    try {
      await navigator.clipboard.writeText(email.report ?? "");
      setCopied(email.messageId);
    } catch (e) {
      console.error("Copying an import report failed", e);
      setError("Couldn't copy the report");
    }
  };
  // While there are more matches: a booking that fills the gap removes it,
  // and one that doesn't (another journey between the same places) leaves
  // it to keep looking.
  const more = !looked || looked.next !== undefined;
  return (
    <div>
      <p className="text-amber-800 dark:text-amber-300">{journeyGapText(gap)}</p>
      {looked && (
        <ul className="mt-1 space-y-1" data-testid="journey-gap-emails">
          {looked.emails.map((email) => (
            <li key={email.messageId}>
              {email.subject || "(no subject)"} <span className="text-muted">· {outcomeText[email.outcome]}</span>
              {email.report && email.outcome !== "imported" && email.outcome !== "cancellation" && (
                <>
                  {" "}
                  <button type="button" onClick={() => copy(email)} className={link}>
                    {copied === email.messageId ? "Report copied" : "Copy report"}
                  </button>
                </>
              )}
            </li>
          ))}
          {looked.emails.length === 0 && <li className="text-muted">No emails mention {gap.from} and {gap.to}</li>}
        </ul>
      )}
      {error && <p className="mt-1 text-danger">{error}</p>}
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {onLook && more && (
          <button type="button" onClick={look} disabled={looking} className={link}>
            {looking ? "Looking…" : looked ? "Keep looking" : "Look for it"}
          </button>
        )}
        {onAdd && (
          <button type="button" onClick={() => onAdd(gap.date)} className={link}>
            Add it yourself
          </button>
        )}
      </p>
    </div>
  );
}
