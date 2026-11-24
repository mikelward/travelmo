import { fillAirports, fillCities, type Segment } from "@travelmo/core";
import { airportPlace } from "@travelmo/core/airportPlaces";
import { cityCountry } from "@travelmo/core/cityCountries";
import type { ImportDeps } from "./importer";

// Fills in what the airport and city tables know about a user's bookings
// (a flight's airports, a place in an unambiguous city), with no geocoder
// call, so a fix to the tables reaches bookings already filed at once rather
// than with the nightly sweep. Only a missing country or spot is filled;
// nothing a booking has is changed, and a hand-entered booking is left as
// its author wrote it. Like the sweep, it does not move a booking's
// revision: an unedited booking stays one.

// Firestore allows 500 writes a transaction; each booking is one, and its
// trip's revision another.
const writeBudget = 400;

export function placedFromTables(segment: Segment): Segment | undefined {
  if (segment.source === "manual") return undefined;
  const filled = fillCities(fillAirports(segment, airportPlace), cityCountry);
  const gained = (before: Segment["origin"], after: Segment["origin"]) =>
    !!after && (!!after.country !== !!before?.country || (after.lat !== undefined) !== (before?.lat !== undefined));
  return gained(segment.origin, filled.origin) || gained(segment.destination, filled.destination) ? (filled as Segment) : undefined;
}

export async function placeBookings(uid: string, deps: Pick<ImportDeps, "store" | "now" | "log">, budget = writeBudget): Promise<number> {
  let placed = 0;
  for (let pass = 0; pass < 50; pass++) {
    // Counted from what the transaction returns: Firestore may run it more
    // than once.
    const { more, count } = await deps.store.withUserLock(uid, async (tx) => {
      const trips = (await tx.listTrips()).filter((trip) => !trip.deleting);
      // Every read before any write, as a Firestore transaction requires.
      const plans = (
        await Promise.all(
          trips.map(async (trip) => ({
            trip,
            changed: (await tx.listSegments(trip.id)).flatMap((s) => {
              const filled = placedFromTables(s);
              return filled ? [filled] : [];
            }),
          })),
        )
      ).filter((p) => p.changed.length > 0);
      let writes = 0;
      let count = 0;
      for (const { trip, changed } of plans) {
        if (writes > 0 && writes + changed.length + 1 > budget) return { more: true, count };
        for (const segment of changed) tx.putSegment(segment);
        tx.touchTrip(trip.id, deps.now());
        writes += changed.length + 1;
        count += changed.length;
      }
      return { more: false, count };
    });
    placed += count;
    if (!more) {
      deps.log("bookings_placed", { uid, placed, passes: pass + 1 });
      return placed;
    }
  }
  throw new Error("placing bookings did not settle in 50 passes");
}
