import { compareInstants } from "./instant";
import type { ExtractedSegment, Place, SegmentType } from "./schema";

// Where someone lives, over time. Nobody types it in: it is worked out from
// their journeys, since a round trip leaves from home and comes back to it.
// People move, so it is a timeline of periods, not one place. A period's
// bounds are calendar dates, inclusive; the first has no `from` and the last
// no `until`, as the bookings say nothing about before or after them.
export type HomePeriod = {
  city: string;
  country?: string;
  from?: string;
  until?: string;
};

type Booking = Pick<ExtractedSegment, "type" | "start" | "end" | "origin" | "destination">;

const journeyTypes: ReadonlySet<SegmentType> = new Set(["flight", "train", "bus", "ferry"]);

// A place's town, for telling home from away: the city where the source gave
// one, otherwise its name (an airport or station named without a city).
function town(place: Place | undefined): { city: string; country?: string } | undefined {
  const city = place?.city ?? place?.name;
  if (!city) return undefined;
  return place?.country ? { city, country: place.country } : { city };
}

// Two towns match on the city, ignoring case, and on the country when both
// give one.
function sameTown(a: { city: string; country?: string }, b: { city: string; country?: string }): boolean {
  if (a.city.trim().toLowerCase() !== b.city.trim().toLowerCase()) return false;
  return !a.country || !b.country || a.country.toUpperCase() === b.country.toUpperCase();
}

const localDate = (instant: string) => instant.slice(0, 10);

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// The round trips in a run of journeys: each leaves from a town and ends
// with the first journey back into it, however many legs lie between. A
// chain that never returns (a one-way move, or bookings missing) gives no
// round trip, and the next journey starts afresh. Legs go in the order they
// leave, by instant, since local times misorder them across the date line;
// a journey within one town (a river bus) goes nowhere and says nothing.
function roundTrips(segments: readonly Booking[]): { base: { city: string; country?: string }; start: string }[] {
  const journeys = segments
    .filter((s) => {
      const from = town(s.origin);
      const to = town(s.destination);
      return journeyTypes.has(s.type) && from && to && !sameTown(from, to);
    })
    .sort((a, b) => compareInstants(a.start, b.start));
  const trips: { base: { city: string; country?: string }; start: string }[] = [];
  let i = 0;
  while (i < journeys.length) {
    const base = town(journeys[i]!.origin)!;
    const back = journeys.findIndex((j, k) => k >= i && sameTown(town(j.destination)!, base));
    if (back < 0) {
      i++;
      continue;
    }
    trips.push({ base, start: localDate(journeys[i]!.start) });
    i = back + 1;
  }
  return trips;
}

// Home over time from someone's bookings. The base of the first round trip
// is home until another base holds for two round trips in a row: that is a
// move, dated from the first of them. A single trip from somewhere else (a
// holiday flight home from a relative's) is not.
export function homeTimeline(segments: readonly Booking[]): HomePeriod[] {
  const trips = roundTrips(segments);
  const periods: HomePeriod[] = [];
  let current: { city: string; country?: string } | undefined;
  for (let i = 0; i < trips.length; i++) {
    const { base, start } = trips[i]!;
    if (!current) {
      current = base;
      periods.push({ ...base });
      continue;
    }
    if (sameTown(base, current)) continue;
    const next = trips[i + 1];
    if (!next || !sameTown(next.base, base)) continue;
    periods[periods.length - 1]!.until = dayBefore(start);
    periods.push({ ...base, from: start });
    current = base;
  }
  return periods.map(({ city, country, from, until }) => ({
    city,
    ...(country ? { country } : {}),
    ...(from ? { from } : {}),
    ...(until ? { until } : {}),
  }));
}

const covers = (period: HomePeriod, date: string) =>
  (!period.from || period.from <= date) && (!period.until || date <= period.until);

// Home on a date. A correction the person made (`overrides`) wins over what
// was worked out for the dates it covers.
export function homeAt(periods: readonly HomePeriod[], date: string, overrides: readonly HomePeriod[] = []): HomePeriod | undefined {
  return overrides.find((p) => covers(p, date)) ?? periods.find((p) => covers(p, date));
}

// Whether a booking that is not a journey (a stay, a ticket, a car) happens
// in the home of its day: a day out, not part of a trip away.
export function isAtHome(
  segment: Pick<ExtractedSegment, "type" | "start" | "destination">,
  periods: readonly HomePeriod[],
  overrides: readonly HomePeriod[] = [],
): boolean {
  if (journeyTypes.has(segment.type)) return false;
  const place = town(segment.destination);
  const home = homeAt(periods, localDate(segment.start), overrides);
  return !!place && !!home && sameTown(place, home);
}
