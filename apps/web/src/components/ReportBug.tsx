"use client";

import { bugReportLimits, type ReportedTrip, type Segment, type Trip } from "@travelmo/core";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Report a bug (SPEC "Bug reports"): a link at the foot of every page for
// a signed-in, approved account, opening a dialog that says what the
// maintainer will see and sends what the user wrote, the page's address,
// the browser and the build to the parser, which emails it. Sent from a
// trip's page, the trip's bookings always go too: the page registers them
// here (useReportTrip).

type TripOnPage = { trip: Trip; segments: Segment[] };

const ReportTripContext = createContext<{ getCurrent: () => TripOnPage | undefined; set: (trip: TripOnPage | undefined) => void } | undefined>(undefined);

export function BugReportProvider({ children }: { children: ReactNode }) {
  const currentRef = useRef<TripOnPage | undefined>(undefined);
  const value = useMemo(
    () => ({
      getCurrent: () => currentRef.current,
      set: (trip: TripOnPage | undefined) => {
        currentRef.current = trip;
      },
    }),
    [],
  );
  return <ReportTripContext value={value}>{children}</ReportTripContext>;
}

// The trip page's trip and its bookings, for a report sent from it; gone
// when the page is.
export function useReportTrip(trip: Trip | null | undefined, segments: Segment[] | undefined): void {
  const set = useContext(ReportTripContext)?.set;
  useEffect(() => {
    if (!set) return;
    set(trip && segments ? { trip, segments } : undefined);
    return () => set(undefined);
  }, [set, trip, segments]);
}

// Built into the bundle when it is: which version of the web app sent it.
const version = process.env.NEXT_PUBLIC_BUILT_AT ? `built ${process.env.NEXT_PUBLIC_BUILT_AT}` : "development";

function reportedTrip({ trip, segments }: TripOnPage): ReportedTrip {
  return { id: trip.id, title: trip.title, bookings: segments };
}

type Sending = { state: "idle" } | { state: "sending" } | { state: "sent" } | { state: "failed"; reason: string };

const buttonClass = "rounded-lg border border-zinc-300 px-3 py-2  dark:border-zinc-700";
const primaryClass = "rounded-lg bg-zinc-900 px-3 py-2  font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

// The dialog, from the footer's link or a page's own "Report a problem"
// (`initialText`: what the page knows went wrong, which the user can add to).
export function ReportDialog({ onClose, initialText = "" }: { onClose: () => void; initialText?: string }) {
  const { user } = useAuth();
  const getCurrent = useContext(ReportTripContext)?.getCurrent;
  const [onTrip] = useState<TripOnPage | undefined>(() => getCurrent?.());
  const page = usePathname();
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initialText);
  const [sending, setSending] = useState<Sending>({ state: "idle" });
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !text.trim()) return;
    setSending({ state: "sending" });
    try {
      await api.sendBugReport(user, {
        text: text.trim(),
        page,
        app: "web",
        version,
        userAgent: navigator.userAgent,
        ...(onTrip ? { trip: reportedTrip(onTrip) } : {}),
      });
      setSending({ state: "sent" });
    } catch (error) {
      console.error("Sending the bug report failed", error);
      setSending({ state: "failed", reason: (error as Error).message });
    }
  };
  const sent = sending.state === "sent";
  return (
    <dialog
      ref={ref}
      aria-label="Report a bug"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-background p-0 text-foreground backdrop:bg-black/40 dark:border-zinc-800"
    >
      <form onSubmit={send} className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-medium">Report a bug</h2>
        <label className="flex flex-col gap-1">
          What went wrong?
          <textarea
            rows={4}
            required
            maxLength={bugReportLimits.text}
            value={text}
            disabled={sending.state === "sending" || sent}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg border border-field bg-background px-3 py-2"
          />
        </label>
        <p className="text-muted">
          {onTrip
            ? "We'll see this trip's bookings, including addresses, confirmation numbers and names, plus this page's address and your browser."
            : "We'll see this page's address and your browser."}{" "}
          We use them only to fix the problem.
        </p>
        {sending.state === "sending" && <p className="">Sending…</p>}
        {sent && <p className="">Sent. We&apos;ll reply by email.</p>}
        {sending.state === "failed" && <p className="text-danger">Couldn&apos;t send the report. {sending.reason}</p>}
        <div className="flex justify-end gap-2">
          {sent ? (
            <button type="button" onClick={onClose} className={buttonClass}>
              Close
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className={buttonClass}>
                Cancel
              </button>
              <button type="submit" disabled={!text.trim() || sending.state === "sending"} className={primaryClass}>
                Send
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}

// The footer's link, for an account that may use the app.
export function ReportBug() {
  const { user, access } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user || access.state !== "approved") return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hover:underline">
        Report a bug
      </button>
      {open && <ReportDialog onClose={() => setOpen(false)} />}
    </>
  );
}
