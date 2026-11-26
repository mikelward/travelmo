import type { RefreshProgress } from "./schema";

// What Settings' trip actions (SPEC "Home": regrouping; "Refresh from
// email"; "Deleting all trips") did, in a line, as the web and Android say
// it (TripActions.kt is the Kotlin twin).

// The parser's paths for them.
export const regroupPath = "/trips/regroup";
export const deleteAllTripsPath = "/trips/delete-all";
export const startOverPath = "/trips/start-over";
export const refreshPath = "/trips/refresh";
export const refreshStopPath = "/trips/refresh/stop";

// What regrouping did, in a line for the Settings page: `placed` counts the
// bookings it first gave a country or a spot from the airport and city
// tables (absent from a parser older than that).
export type RegroupResult = { changed: number; deleted: number; placed?: number };

export function describeRegroup({ changed, deleted, placed = 0 }: RegroupResult): string {
  if (changed === 0 && deleted === 0 && placed === 0) return "Your trips were already grouped this way.";
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
  const parts = [
    changed ? `${count(changed, "trip")} rebuilt` : "",
    deleted ? `${count(deleted, "trip")} merged away` : "",
    placed ? `${count(placed, "booking")} placed` : "",
  ].filter(Boolean);
  return `Done: ${parts.join(", ")}.`;
}

// What deleting all trips did, with the next step.
export function describeDeletedTrips(trips: number): string {
  if (trips === 0) return "You had no trips to delete.";
  return `Deleted ${trips} trip${trips === 1 ? "" : "s"}. Import past bookings to start again.`;
}

// What "Delete everything and start over" did, with what happens next.
export function describeStartOver({ trips, mailboxes }: { trips: number; mailboxes: number }): string {
  const deleted = trips === 0 ? "You had no trips to delete." : `Deleted ${trips} trip${trips === 1 ? "" : "s"}.`;
  if (mailboxes === 0) return `${deleted} Connect a mailbox, or import past bookings, to start again.`;
  return `${deleted} Reading your email again from the start.`;
}

// What "Refresh from email" does, under its button.
export const refreshBlurb = "Reads your travel emails again and updates your bookings. Bookings you edited stay as you left them.";

// The parts of the refresh's progress (`refresh` on the user document) that
// Settings shows.
export type ShownRefresh = Pick<
  RefreshProgress,
  "scanned" | "done" | "failed" | "failedIds" | "retrying" | "total" | "updated" | "added" | "removed" | "merged" | "kept" | "missing"
>;

const count = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, one: string, many: string) => `${count(x)} ${x === 1 ? one : many}`;

// The refresh's button while none is running: start one, or carry on with
// one that stopped part way.
export function refreshButton(progress: ShownRefresh | undefined): string {
  return progress && !progress.done ? "Continue refreshing" : "Refresh from email";
}

// How far a refresh has got, or what it did once done.
export function describeRefresh(progress: ShownRefresh, reading: boolean): string {
  const read =
    progress.total !== undefined ? `${count(progress.scanned)} of ${plural(progress.total, "email", "emails")}` : plural(progress.scanned, "email", "emails");
  if (!progress.done) {
    const again = progress.retrying?.length;
    if (again) {
      const these = plural(again, "email that couldn't be read", "emails that couldn't be read");
      return reading ? `Refreshing your bookings… trying ${these} again. You can close this page.` : `Stopped part way: ${these} still to try again. Continue to try ${again === 1 ? "it" : "them"}.`;
    }
    return reading ? `Refreshing your bookings… ${read} read so far. You can close this page.` : `Stopped part way: ${read} read. Continue to refresh the rest.`;
  }
  const changes = [
    progress.updated ? `${plural(progress.updated, "booking", "bookings")} updated` : "",
    progress.added ? `${count(progress.added)} added` : "",
    progress.merged ? `${plural(progress.merged, "duplicate", "duplicates")} merged` : "",
    progress.removed ? `${count(progress.removed)} removed` : "",
  ].filter(Boolean);
  const lines = [`Refreshed ${plural(progress.scanned, "email", "emails")}: ${changes.length ? `${changes.join(", ")}.` : "your bookings were already up to date."}`];
  if (progress.kept) lines.push(`${plural(progress.kept, "booking you edited was", "bookings you edited were")} left as you left ${progress.kept === 1 ? "it" : "them"}.`);
  if (progress.missing) lines.push(`${plural(progress.missing, "email is", "emails are")} no longer in a connected mailbox.`);
  // The list of them follows (failedEmailIds); a refresh from before their
  // ids were kept has none to show, so it says how to find them.
  if (progress.failed) {
    const which = progress.failedIds?.length ? ":" : ". Refresh again to see which.";
    lines.push(`${plural(progress.failed, "email", "emails")} couldn't be read, even on a second try${which}`);
  }
  return lines.join(" ");
}

// The emails a finished refresh couldn't read, which Settings lists under
// what it did (describeRefresh), each with what can be done about it.
export const failedEmailsShown = 10;

export function failedEmailIds(progress: ShownRefresh | undefined): string[] {
  return progress?.done ? (progress.failedIds ?? []).slice(0, failedEmailsShown) : [];
}

// How many more couldn't be read than the list shows.
export function moreFailedEmails(progress: ShownRefresh): string | undefined {
  const more = (progress.failed ?? 0) - failedEmailIds(progress).length;
  return more > 0 ? `and ${plural(more, "more", "more")}` : undefined;
}

// One email in that list, by what the import record kept of it.
export function failedEmailLine(record: { subject?: string | undefined; from?: string | undefined } | undefined): string {
  const subject = record?.subject?.trim() || "(no subject)";
  return record?.from ? `${subject} · ${record.from}` : subject;
}

// The bug report "Report a problem" starts from: what happened and the
// emails' ids, which the maintainer finds them by in the logs.
export function failedEmailsReport(progress: ShownRefresh): string {
  const ids = progress.failedIds ?? [];
  return `"Refresh from email" couldn't read ${plural(progress.failed ?? ids.length, "email", "emails")}: ${ids.slice(0, 50).join(", ")}`;
}
