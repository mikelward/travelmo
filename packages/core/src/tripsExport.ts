import { countryName } from "./countries";
import { countryCode, homeAt, inHomeTown, sameCity, type HomePeriod } from "./home";
import { compareInstants } from "./instant";
import { placeCountry, type PlaceLookup } from "./reports";
import type { ExtractedSegment, Place, SegmentType, Trip } from "./schema";
import { displayBounds, tripCancelled, liveSegments, localDate, withoutValidityEnds } from "./trips";

// A summary of where the user has been, to download from Reports as CSV for
// visa and settlement forms: one row per trip, or one per place stayed in,
// from the journeys, stays and cars alone (an event or a ticket says
// nothing about where someone slept).

export type SummaryTrip = {
  trip: Pick<Trip, "id" | "title" | "start" | "end" | "cancelledAt"> & { liveStart?: string | undefined; liveEnd?: string | undefined };
  segments: readonly ExtractedSegment[];
};

export type ExportOptions = {
  // The last day to include: trips that start after it are left out
  // (today by default in the apps; later takes in planned trips).
  until: string;
  // Home over time, for leaving out the home town and for `international`.
  periods: readonly HomePeriod[];
  lookup?: PlaceLookup;
  // Only what was outside the home country of its day.
  international?: boolean;
  // The trip's name as the app shows it, else its own title.
  titles?: ReadonlyMap<string, string>;
};

const journeys: ReadonlySet<SegmentType> = new Set(["flight", "train", "bus", "ferry"]);
const counted: ReadonlySet<SegmentType> = new Set([...journeys, "lodging", "car_rental"]);

type Stop = { at: string; date: string; place: Place; type: SegmentType; until?: string };

// Where a trip took someone, in order: where each journey arrives, and each
// stay and car's place, never where a journey leaves from.
function stops(segments: readonly ExtractedSegment[]): Stop[] {
  // A ticket's validity read as its arrival is no arrival (withoutValidityEnds).
  return withoutValidityEnds(liveSegments(segments))
    .filter((s) => counted.has(s.type))
    .flatMap((s): Stop[] => {
      if (journeys.has(s.type)) {
        const at = s.end ?? s.start;
        return s.destination ? [{ at, date: localDate(at), place: s.destination, type: s.type }] : [];
      }
      const place = s.type === "car_rental" ? (s.origin ?? s.destination) : (s.destination ?? s.origin);
      return place ? [{ at: s.start, date: localDate(s.start), place, type: s.type, ...(s.end ? { until: localDate(s.end) } : {}) }] : [];
    })
    .sort((a, b) => compareInstants(a.at, b.at));
}

const cityOf = (place: Place) => (place.city ?? place.name).trim();

// The town to show for a stop: its own, or for a journey the station or port
// it arrives at; a stay or a car with no town shows none, not the hotel's or
// the rental desk's name.
const shownCity = (stop: Stop): string | undefined => stop.place.city?.trim() || (journeys.has(stop.type) ? stop.place.name.trim() : undefined);

// A place's country, as an ISO code where it is known.
function countryOf(stop: Stop, lookup?: PlaceLookup): string | undefined {
  const c = placeCountry(stop.place, stop.type, lookup);
  return c ? countryCode(c) : undefined;
}

// A trip's stops, each with its country: its own, its airport's, or failing
// those another booking's on the trip for the same town.
function located(segments: readonly ExtractedSegment[], lookup?: PlaceLookup): (Stop & { country?: string | undefined })[] {
  const all = stops(segments).map((s) => ({ ...s, country: countryOf(s, lookup) }));
  return all.map((s) => (s.country ? s : { ...s, country: all.find((o) => o.country && sameCity(cityOf(o.place), cityOf(s.place)))?.country }));
}

// Whether a stop is in the home town of its day, judged with its country
// as worked out (an airport's), so London, Canada is not London, UK.
const atHome = (place: Place, country: string | undefined, date: string, periods: readonly HomePeriod[]) =>
  inHomeTown(country ? { ...place, country } : place, date, periods);

function abroad(country: string | undefined, date: string, periods: readonly HomePeriod[]): boolean {
  const home = homeAt(periods, date)?.country;
  // With home's country unknown, nothing can be left out as domestic.
  return !home || !country || country !== countryCode(home);
}

const unique = (values: readonly string[]) => [...new Set(values.filter(Boolean))];

// Each town once, by the first spelling met: a town's local and English names
// ("München", "Munich") are one town (sameCity).
const uniqueTowns = (values: readonly string[]) =>
  values.filter(Boolean).reduce<string[]>((kept, town) => (kept.some((k) => sameCity(k, town)) ? kept : [...kept, town]), []);

// The trips to list: begun by `until` and not wholly cancelled.
const taken = (trips: readonly SummaryTrip[], until: string) =>
  trips.filter(({ trip, segments }) => displayBounds(trip).start <= until && !tripCancelled(trip, segments));

// One town, not two of a name in different countries.
const sameStop = (a: { place: Place; country?: string }, b: { place: Place; country?: string }) =>
  sameCity(cityOf(a.place), cityOf(b.place)) && (!a.country || !b.country || a.country === b.country);

export type TripRow = { trip: string; start: string; end: string; cities: string[]; countries: string[] };

// One row per trip, oldest first: its dates and the towns and countries it
// went to, home left out.
export function tripRows(trips: readonly SummaryTrip[], options: ExportOptions): TripRow[] {
  return taken(trips, options.until)
    .flatMap(({ trip, segments }): TripRow[] => {
      const { start, end } = displayBounds(trip);
      const away = located(segments, options.lookup).filter((s) => !atHome(s.place, s.country, s.date, options.periods));
      // A trip of nothing but events and tickets, or only at home, went nowhere to list.
      if (away.length === 0) return [];
      const countries = away.map((s) => s.country);
      // Each place against the home of its own day: home may change mid-trip.
      if (options.international && !away.some((s, i) => abroad(countries[i], s.date, options.periods))) return [];
      return [{
        trip: options.titles?.get(trip.id) ?? trip.title,
        start,
        end,
        cities: uniqueTowns(away.flatMap((s) => shownCity(s) ?? [])),
        countries: unique(countries.flatMap((c) => (c ? [countryName(c)] : []))),
      }];
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

export type PlaceRow = { city: string; country: string; start: string; end: string; trip: string };

// One row per place stayed in, oldest first: from the day someone got there
// until the day they moved on (the next place's first day), or for the last
// place the later of its stay's end and the trip's.
export function placeRows(trips: readonly SummaryTrip[], options: ExportOptions): PlaceRow[] {
  const rows: PlaceRow[] = [];
  for (const { trip, segments } of taken(trips, options.until)) {
    const { end: tripEnd } = displayBounds(trip);
    const title = options.titles?.get(trip.id) ?? trip.title;
    const visits: { stop: Stop; country?: string; start: string; until?: string; home: boolean }[] = [];
    for (const stop of located(segments, options.lookup)) {
      const last = visits.at(-1);
      const country = stop.country;
      const home = atHome(stop.place, country, stop.date, options.periods);
      if (last && sameStop({ place: last.stop.place, ...(last.country ? { country: last.country } : {}) }, { place: stop.place, ...(country ? { country } : {}) })) {
        if (stop.until && (!last.until || stop.until > last.until)) last.until = stop.until;
        // A later booking may say the country an earlier one left out, which can
        // show the place is not home after all.
        if (!last.country && country) {
          last.country = country;
          last.home = atHome(last.stop.place, country, last.start, options.periods);
        }
        continue;
      }
      visits.push({ stop, ...(country ? { country } : {}), start: stop.date, ...(stop.until ? { until: stop.until } : {}), home });
    }
    visits.forEach((v, i) => {
      if (v.home) return;
      if (options.international && !abroad(v.country, v.start, options.periods)) return;
      const next = visits[i + 1];
      const end = next ? next.start : [v.until, tripEnd].filter((d): d is string => !!d).sort().at(-1)!;
      rows.push({ city: shownCity(v.stop) ?? "", country: v.country ? countryName(v.country) : "", start: v.start, end: end < v.start ? v.start : end, trip: title });
    });
  }
  return rows.sort((a, b) => a.start.localeCompare(b.start));
}

// A field as RFC 4180 writes it: quoted when it holds a comma, a quote or a
// line break, with its quotes doubled. A spreadsheet would run a field starting
// =, +, -, @ or a tab as a formula, so such a field (a title like "=1+1")
// starts with an apostrophe instead.
function csvField(raw: string): string {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const csv = (rows: readonly (readonly string[])[]) => rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";

export function tripRowsCsv(rows: readonly TripRow[]): string {
  return csv([["Trip", "Start", "End", "Cities", "Countries"], ...rows.map((r) => [r.trip, r.start, r.end, r.cities.join("; "), r.countries.join("; ")])]);
}

export function placeRowsCsv(rows: readonly PlaceRow[]): string {
  return csv([["City", "Country", "Start", "End", "Trip"], ...rows.map((r) => [r.city, r.country, r.start, r.end, r.trip])]);
}
