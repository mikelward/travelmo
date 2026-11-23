import { covers, type ForgetSenderResult } from "@travelmo/core";
import { settlingTripDates, type ImportDeps } from "./importer";

// Most writes one pass makes: Firestore allows 500 in a transaction.
const writeBudget = 400;

// "Never import this sender", with its bookings deleted: every booking an
// email from `domain` (or one of its subdomains) made in the user's own
// trips, and each trip that has none left. A trip already empty is left
// alone, and so is one being deleted. Runs in the import's per-user
// transaction, a pass at a time while the writes fit, so no import files
// into a trip as it goes.
export async function forgetSender(
  uid: string,
  domain: string,
  deps: Pick<ImportDeps, "store" | "now" | "log">,
  budget = writeBudget,
): Promise<ForgetSenderResult> {
  const pattern = domain.trim().toLowerCase();
  const result: ForgetSenderResult = { bookings: 0, trips: 0 };
  for (let pass = 0; pass < 50; pass++) {
    const more = await deps.store.withUserLock(uid, async (lockTx) => {
      const timestamp = deps.now();
      const tx = settlingTripDates(lockTx, timestamp);
      const trips = (await tx.listTrips()).filter((trip) => trip.ownerUid === uid && !trip.deleting);
      const segmentsByTrip = new Map(await Promise.all(trips.map(async (trip) => [trip.id, await tx.listSegments(trip.id)] as const)));
      let writes = 0;
      let left = false;
      const counts = { bookings: 0, trips: 0 };
      for (const trip of trips) {
        const segments = segmentsByTrip.get(trip.id) ?? [];
        const doomed = segments.filter((s) => s.sender !== undefined && covers(pattern, s.sender.toLowerCase()));
        if (doomed.length === 0) continue;
        // Its bookings and one write for the trip, or as many as fit.
        const room = budget - writes - 1;
        if (room <= 0) {
          left = true;
          break;
        }
        const batch = doomed.slice(0, room);
        for (const s of batch) tx.deleteSegment(trip.id, s.id);
        writes += batch.length + 1;
        counts.bookings += batch.length;
        if (batch.length < doomed.length) {
          tx.touchTrip(trip.id, timestamp);
          left = true;
          break;
        }
        if (batch.length === segments.length) {
          tx.deleteTrip(trip.id);
          counts.trips += 1;
        } else {
          tx.touchTrip(trip.id, timestamp);
        }
      }
      // When the person now travels on each trip left (liveBounds).
      tx.settle(trips, (tripId) => segmentsByTrip.get(tripId) ?? []);
      return { left, counts };
    }).then(({ left, counts }) => {
      result.bookings += counts.bookings;
      result.trips += counts.trips;
      return left;
    });
    if (!more) {
      deps.log("sender_forgotten", { uid, ...result, passes: pass + 1 });
      return result;
    }
  }
  throw new Error("deleting a sender's bookings did not settle in 50 passes");
}
