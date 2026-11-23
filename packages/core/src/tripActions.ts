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
