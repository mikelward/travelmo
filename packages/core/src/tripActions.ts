// What Settings' trip actions (SPEC "Home": regrouping; "Deleting all
// trips") did, in a line, as the web and Android say it.

// The parser's paths for them.
export const regroupPath = "/trips/regroup";
export const deleteAllTripsPath = "/trips/delete-all";

// What regrouping did, in a line for the Settings page.
export type RegroupResult = { changed: number; deleted: number };

export function describeRegroup({ changed, deleted }: RegroupResult): string {
  if (changed === 0 && deleted === 0) return "Your trips were already grouped this way.";
  const trips = (n: number) => `${n} trip${n === 1 ? "" : "s"}`;
  const parts = [changed ? `${trips(changed)} rebuilt` : "", deleted ? `${trips(deleted)} merged away` : ""].filter(Boolean);
  return `Done: ${parts.join(", ")}.`;
}

// What deleting all trips did, with the next step.
export function describeDeletedTrips(trips: number): string {
  if (trips === 0) return "You had no trips to delete.";
  return `Deleted ${trips} trip${trips === 1 ? "" : "s"}. Import past bookings to start again.`;
}

// "Never import this sender" on a booking: the parser deletes the bookings
// that sender's emails made, in the user's own trips, and each trip that
// leaves empty.
export const forgetSenderPath = "/senders/forget";
export type ForgetSenderResult = { bookings: number; trips: number };

// What "Never import this sender" did, in a line; `deleted` when its
// bookings were deleted too.
export function describeNeverImport(domain: string, deleted?: ForgetSenderResult): string {
  if (!deleted) return `Never importing ${domain}.`;
  const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
  if (deleted.bookings === 0) return `Never importing ${domain}. It had no bookings to delete.`;
  const trips = deleted.trips ? ` and ${count(deleted.trips, "empty trip")}` : "";
  return `Never importing ${domain}. Deleted ${count(deleted.bookings, "booking")}${trips}.`;
}
