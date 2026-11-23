import { homeAt, inHomeTown, nearHub, rideFromArrival, rideToDeparture, type HomePeriod } from "./home";
import type { RideCompany, Segment } from "./schema";
import { liveSegments } from "./trips";

// The rental companies every car suggestion offers, at their own sites:
// plain links, so nothing about the trip leaves the app.
export const rentalCompanies: readonly { name: string; url: string }[] = [
  { name: "Avis", url: "https://www.avis.com/" },
  { name: "Enterprise", url: "https://www.enterprise.com/" },
  { name: "Hertz", url: "https://www.hertz.com/" },
  { name: "Budget", url: "https://www.budget.com/" },
  { name: "Sixt", url: "https://www.sixt.com/" },
  { name: "National", url: "https://www.nationalcar.com/" },
  { name: "Alamo", url: "https://www.alamo.com/" },
];

// What a flight is missing: a ride to the airport from home, a ride home
// from it, or a car where it lands.
export type RideNeedKind = "toAirport" | "fromAirport" | "car";
export type RideNeed = { segmentId: string; kind: RideNeedKind };

// A connection: the next journey leaves the airport within this long.
const connectionHours = 12;
// A car hired this soon after landing is for that flight.
const carDays = 2;

const journeyTypes = new Set(["flight", "train", "bus", "ferry"]);
const sameCode = (a: Segment["origin"], b: Segment["origin"]) =>
  !!a?.code && !!b?.code && a.code.toUpperCase() === b.code.toUpperCase();
const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;
const localDate = (instant: string) => instant.slice(0, 10);

/**
 * The flights on a trip with no way to or from their airport booked:
 * - leaving home with no transfer to the airport ("toAirport"),
 * - landing at home with no transfer from it ("fromAirport"),
 * - landing away, as the last leg there, with no transfer from it and no car
 *   hired there within two days ("car").
 * A leg that connects to another journey at the same airport needs nothing.
 * Without a home on the date, only a landing that is not the trip's last
 * journey can be told to be away. Only what is still ahead of `now` is
 * asked for; `hidden` holds the `rideNeedKey`s the traveler dismissed.
 */
export function rideNeeds(
  segments: readonly Segment[],
  { periods, overrides = [], hidden = [], now }: { periods: readonly HomePeriod[]; overrides?: readonly HomePeriod[]; hidden?: readonly string[]; now: string },
): RideNeed[] {
  const live = liveSegments(segments);
  const journeys = live.filter((s) => journeyTypes.has(s.type)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const last = journeys[journeys.length - 1];
  const rides = live.filter((s) => s.type === "car_rental" || s.type === "other");
  const needs: RideNeed[] = [];
  for (const flight of journeys) {
    if (flight.type !== "flight") continue;
    const landed = flight.end ?? flight.start;
    const arrivesFrom = journeys.some(
      (j) => j !== flight && sameCode(j.destination, flight.origin) && hours(j.end ?? j.start, flight.start) >= 0 && hours(j.end ?? j.start, flight.start) <= connectionHours,
    );
    const leavesOnward = journeys.some(
      (j) => j !== flight && sameCode(j.origin, flight.destination) && hours(landed, j.start) >= 0 && hours(landed, j.start) <= connectionHours,
    );
    // A taxi to the airport says nothing about getting on from the other end.
    const toCovered = rides.some((r) => rideToDeparture(r, flight) !== undefined);
    const fromCovered = rides.some((r) => rideFromArrival(r, flight) !== undefined);
    if (Date.parse(landed) <= Date.parse(now)) continue;
    if (!arrivesFrom && !toCovered && Date.parse(flight.start) > Date.parse(now) && inHomeTown(flight.origin, localDate(flight.start), periods, overrides)) {
      needs.push({ segmentId: flight.id, kind: "toAirport" });
    }
    if (leavesOnward || fromCovered) continue;
    const atHome = inHomeTown(flight.destination, localDate(landed), periods, overrides);
    if (atHome) {
      needs.push({ segmentId: flight.id, kind: "fromAirport" });
      continue;
    }
    // Home on the landing date: a timeline that starts later says nothing.
    const homeKnown = homeAt(periods, localDate(landed), overrides) !== undefined;
    if (!homeKnown && flight === last) continue;
    // A car collected where the flight lands, around when it lands.
    const hasCar = live.some(
      (s) =>
        s.type === "car_rental" &&
        nearHub(s.origin ?? s.destination, flight.destination) &&
        hours(landed, s.start) >= -connectionHours &&
        hours(landed, s.start) <= carDays * 24,
    );
    if (!hasCar) needs.push({ segmentId: flight.id, kind: "car" });
  }
  return needs.filter((n) => !hidden.includes(rideNeedKey(n)));
}

// How a dismissed suggestion is remembered on the user's profile.
export const rideNeedKey = (need: RideNeed) => `${need.segmentId}/${need.kind}`;

// The companies a suggestion offers: for a car, the rental companies then
// the traveler's own; for a ride at home, only the traveler's own near home
// (there is nobody to suggest in their town otherwise).
export function rideCompaniesFor(kind: RideNeedKind, own: readonly RideCompany[]): { name: string; url: string }[] {
  const mine = own.filter((c) => (kind === "car" ? c.near === "anywhere" : c.near === "home")).map(({ name, url }) => ({ name, url }));
  return kind === "car" ? [...rentalCompanies, ...mine] : mine;
}
