import type { RefreshProgress } from "./schema";

// What Settings' trip actions (SPEC "Home": regrouping; "Refresh from
// email"; "Deleting all trips") did, in a line, as the web and Android say
// it (TripActions.kt is the Kotlin twin).

// The parser's paths for them.
export const regroupPath = "/trips/regroup";
export const deleteAllTripsPath = "/trips/delete-all";
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

// What "Refresh from email" does, under its button.
export const refreshBlurb = "Reads the emails your bookings came from again and updates those bookings. Bookings you edited stay as you left them.";

// The parts of the refresh's progress (`refresh` on the user document) that
// Settings shows.
export type ShownRefresh = Pick<
  RefreshProgress,
  "scanned" | "done" | "failed" | "lastFailed" | "total" | "updated" | "added" | "removed" | "merged" | "kept" | "missing"
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
  if (progress.failed) lines.push(`${plural(progress.failed, "email", "emails")} couldn't be read; refresh again to try ${progress.failed === 1 ? "it" : "them"}.`);
  return lines.join(" ");
}

// Why a refresh stopped on its own, if it did.
export function refreshPausedReason(progress: (ShownRefresh & { lastFailed?: number }) | undefined, reading: boolean): string | undefined {
  if (!progress?.lastFailed || reading || progress.done) return undefined;
  return "Refresh paused: an email couldn't be read right now. Continue when ready.";
}
