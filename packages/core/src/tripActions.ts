// What Settings' trip actions (SPEC "Home": regrouping; "Deleting all
// trips") did, in a line, as the web and Android say it.

// The parser's paths for them.
export const regroupPath = "/trips/regroup";
export const deleteAllTripsPath = "/trips/delete-all";

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
