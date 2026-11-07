import { countryCodeOf } from "./countries";
import { stableHash } from "./hash";
import { composeInstant, isCalendarDate, isValidInstant } from "./instant";
import type { ExtractedSegment, Place, SegmentType } from "./schema";
import { segmentDateRange } from "./trips";
import { zoneOffset } from "./zone";

// Reads the JSON export TripIt customer service sends on request. Nothing in
// it declares an object's kind: a reservation is told apart by its fields
// (flight legs carry airline codes, a stay a room type, and so on), and
// whatever cannot be told apart, or has no usable date, is reported rather
// than guessed at. A DateTime carries a date, a time, an IANA zone and the
// offset in force, which map straight onto our instants; one with no zone at
// all keeps its time as written, with a note (a real export had a few).
//
// TripIt's JSON is converted from XML, so a list of one is often a bare
// object and numbers are often strings; every read here tolerates both.
// Reservations TripIt kept only the name of (an empty leg, no dates) are
// common in an old account; they are listed, not imported.

export type TripItBooking = {
  // Stable across exports of the same data, for idempotent re-imports.
  key: string;
  title: string;
  segments: ExtractedSegment[];
};

export type TripItTrip = TripItBooking & { start: string; end: string };

export type TripItSkip = { kind: string; title: string; reason: string };

export type TripItImport = {
  trips: TripItTrip[];
  // Reservations TripIt never filed into a trip; these carry confirmation
  // numbers, which trip objects do not.
  unfiled: TripItBooking[];
  skipped: TripItSkip[];
  // Bookings whose time the file gave with no zone, kept as written.
  floating: number;
};

export class NotATripItExport extends Error {}

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

function list(value: unknown): Obj[] {
  if (Array.isArray(value)) return value.filter(isObj);
  return isObj(value) ? [value] : [];
}

function text(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

// Notes as TripIt stores them: its own "[[TripItALT: text]]text" markers
// (the text follows the marker, so the marker only repeats it), HTML from
// pasted emails, and Windows line ends.
export function cleanNotes(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/\[\[TripIt[A-Za-z]*:[^\]]*\]\]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => entities[name]!)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || undefined;
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(\d{2}):(\d{2})/;
const offsetPattern = /^([+-])(\d{2}):?(\d{2})$/;

function offsetOf(dateTime: Obj, date: string, time: string): string | undefined {
  const given = text(dateTime.utc_offset);
  const match = given ? offsetPattern.exec(given) : null;
  if (match) return `${match[1]}${match[2]}:${match[3]}`;
  const zone = text(dateTime.timezone);
  if (!zone) return undefined;
  try {
    return zoneOffset(zone, date, time);
  } catch {
    // An unknown zone name: the caller reports the booking as undated.
    return undefined;
  }
}

export type TripItInstant = { instant: string; floating: boolean };

// A TripIt DateTime as one of our instants. A date with no time takes
// `defaultTime` (check-in and check-out hours for a stay). With neither an
// offset nor a zone the time is kept as written at +00:00 and marked
// floating, since the app shows times as written; an unknown zone name is
// not a missing one and gives nothing.
export function tripItDateTime(value: unknown, defaultTime = "12:00"): TripItInstant | undefined {
  if (!isObj(value)) return undefined;
  const date = text(value.date);
  if (!date || !isoDatePattern.test(date)) return undefined;
  const timeMatch = timePattern.exec(text(value.time) ?? "");
  const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : defaultTime;
  const floating = !text(value.utc_offset) && !text(value.timezone);
  const offset = floating ? "+00:00" : offsetOf(value, date, time);
  if (!offset) return undefined;
  const instant = composeInstant({ date, time, offset });
  // Out-of-range parts (month 99, 25:00, +99:99) make no instant at all, so
  // the booking is reported as undated rather than written malformed.
  return isValidInstant(instant) ? { instant, floating } : undefined;
}

// The instant alone, and none when the file gave no zone.
export function tripItInstant(value: unknown, defaultTime = "12:00"): string | undefined {
  const result = tripItDateTime(value, defaultTime);
  return result && !result.floating ? result.instant : undefined;
}

export const floatingNote = "Time zone not in the TripIt file; time shown as written";

// The country named at the end of a one-line address ("…, Sydney NSW 2000,
// Australia"; "…, Boston, MA 02116" is the US), or nothing.
export function countryFromAddress(address: unknown): string | undefined {
  const line = text(address);
  if (!line) return undefined;
  const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts.at(-1);
  if (!last) return undefined;
  if (/^[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(last)) return "US";
  // A postcode after the name ("Australia 2000", "France 75001").
  const named = last.replace(/(\s+\S*\d\S*)+$/, "").trim();
  return countryCodeOf(named);
}

// TripIt writes coordinates as strings; a pair is kept only when both are
// numbers on the globe.
function coordinates(latitude: unknown, longitude: unknown): Pick<Place, "lat" | "lon"> {
  const lat = Number(text(latitude));
  const lon = Number(text(longitude));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return {};
  // (0, 0) is TripIt's blank, not the Gulf of Guinea.
  if (lat === 0 && lon === 0) return {};
  return { lat, lon };
}

function place(name: unknown, code: unknown, city: unknown, country: unknown, latitude?: unknown, longitude?: unknown): Place | undefined {
  const c = text(code)?.toUpperCase();
  const cityName = text(city);
  const label = text(name) ?? cityName ?? c;
  if (!label) return undefined;
  const countryCode = text(country)?.toUpperCase();
  return {
    name: label,
    ...(c ? { code: c } : {}),
    ...(cityName ? { city: cityName } : {}),
    ...(countryCode && /^[A-Z]{2}$/.test(countryCode) ? { country: countryCode } : {}),
    ...coordinates(latitude, longitude),
  };
}

function addressPlace(name: unknown, address: unknown): Place | undefined {
  const a = isObj(address) ? address : {};
  return place(name ?? a.address, undefined, a.city, a.country ?? countryFromAddress(a.address), a.latitude, a.longitude);
}

const joinNotes = (...parts: (string | undefined)[]) => {
  const kept = parts.filter((p): p is string => p !== undefined);
  return kept.length ? kept.join("\n") : undefined;
};

const label = (name: string, value: unknown) => {
  const v = text(value);
  return v ? `${name}: ${v}` : undefined;
};

// The rules cap a title at 200 characters; an imported one has to stay
// editable on the trip page.
const clip = (title: string) => (title.length > 200 ? `${title.slice(0, 199)}…` : title);

function common(object: Obj) {
  return {
    provider: text(object.supplier_name) ?? text(object.booking_site_name),
    confirmation:
      text(object.supplier_conf_num) ?? text(object.booking_site_conf_num) ?? text(object.record_locator),
    notes: joinNotes(cleanNotes(object.notes), cleanNotes(object.restrictions)),
  };
}

function compact<T extends Obj>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

// `dropped` counts legs (or a cruise's port calls, `droppedNoun`) left out
// of a reservation that still has others, so the report names them rather
// than the import passing as whole; `floating` counts segments whose time
// had no zone.
type Mapped =
  | { kind: string; segments: ExtractedSegment[]; dropped?: number; droppedNoun?: string; floating: number }
  | { kind: string; skip: string };

// An old account keeps reservations TripIt stripped down to a name (an
// empty leg, no dates), and unfiled items keep a confirmation number too.
function nameOnly(object: Obj): string {
  return `TripIt kept only its name${common(object).confirmation ? " and confirmation number" : ""}`;
}

const emptyLegs = (object: Obj) => {
  const legsOf = list(object.Segment);
  return legsOf.length > 0 && legsOf.every((l) => Object.keys(l).length === 0);
};

function legs(object: Obj, kind: "flight" | "train"): Mapped {
  const base = common(object);
  const segments: ExtractedSegment[] = [];
  let floating = 0;
  for (const leg of list(object.Segment)) {
    const start = tripItDateTime(leg.StartDateTime);
    if (!start) continue;
    const end = tripItDateTime(leg.EndDateTime);
    if (start.floating || end?.floating) floating += 1;
    let origin: Place | undefined;
    let destination: Place | undefined;
    let number: string | undefined;
    let provider: string | undefined;
    if (kind === "flight") {
      origin = place(
        leg.start_airport_name ?? leg.start_city_name,
        leg.start_airport_code,
        leg.start_city_name,
        leg.start_country_code,
        leg.start_airport_latitude,
        leg.start_airport_longitude,
      );
      destination = place(
        leg.end_airport_name ?? leg.end_city_name,
        leg.end_airport_code,
        leg.end_city_name,
        leg.end_country_code,
        leg.end_airport_latitude,
        leg.end_airport_longitude,
      );
      const airline = text(leg.marketing_airline_code);
      const flight = text(leg.marketing_flight_number);
      number = airline && flight ? `${airline} ${flight}` : flight;
      provider = text(leg.marketing_airline) ?? base.provider;
    } else {
      origin = place(leg.start_station_name, leg.start_station_code, leg.start_city_name, leg.start_country_code);
      destination = place(leg.end_station_name, leg.end_station_code, leg.end_city_name, leg.end_country_code);
      const train = text(leg.train_number);
      number = train ? [text(leg.carrier_name), train].filter(Boolean).join(" ") : undefined;
      provider = text(leg.carrier_name) ?? base.provider;
    }
    const route = [origin?.code ?? origin?.name, destination?.code ?? destination?.name].filter(Boolean).join(" to ");
    const title = [number, route].filter(Boolean).join(" ") || text(object.display_name) || (kind === "flight" ? "Flight" : "Train");
    segments.push(
      compact({
        type: kind,
        title: clip(title),
        provider,
        confirmation: base.confirmation,
        start: start.instant,
        end: end?.instant,
        origin,
        destination,
        notes: joinNotes(
          label("Seat", leg.seats),
          label("Departure terminal", leg.start_terminal),
          label("Departure gate", leg.start_gate),
          label("Arrival terminal", leg.end_terminal),
          label("Aircraft", leg.aircraft_display_name),
          label("Coach", leg.coach_number),
          start.floating || end?.floating ? floatingNote : undefined,
          base.notes,
        ),
      }),
    );
  }
  const total = list(object.Segment).length;
  if (segments.length === 0) return { kind, skip: emptyLegs(object) ? nameOnly(object) : total ? "no leg has a usable date" : "no legs" };
  return { kind, segments, floating, ...(total > segments.length ? { dropped: total - segments.length } : {}) };
}

// TripIt's TransportObject codes: F a ferry, G ground transportation. A leg
// with no code is still a journey, so it is a bus rather than "other", which
// the reports would read as a stay at its destination.
const transportTypes: Record<string, SegmentType> = { F: "ferry", G: "bus" };

// A TransportObject: a shuttle, a transfer, a ferry crossing; one segment
// per leg, like a flight.
function transport(object: Obj): Mapped {
  const base = common(object);
  const segments: ExtractedSegment[] = [];
  let floating = 0;
  for (const leg of list(object.Segment)) {
    const start = tripItDateTime(leg.StartDateTime);
    if (!start) continue;
    const end = tripItDateTime(leg.EndDateTime);
    if (start.floating || end?.floating) floating += 1;
    const origin = addressPlace(text(leg.start_location_name), leg.StartLocationAddress);
    const destination = addressPlace(text(leg.end_location_name), leg.EndLocationAddress);
    const carrier = text(leg.carrier_name);
    const route = [origin?.name, destination?.name].filter(Boolean).join(" to ");
    const title = [carrier, route].filter(Boolean).join(" ") || text(object.display_name) || "Transfer";
    segments.push(
      compact({
        type: transportTypes[text(leg.detail_type_code) ?? ""] ?? "bus",
        title: clip(title),
        provider: carrier ?? base.provider,
        confirmation: base.confirmation,
        start: start.instant,
        end: end?.instant,
        origin,
        destination,
        notes: joinNotes(
          label("Vehicle", leg.vehicle_description),
          label("Passengers", leg.number_passengers),
          start.floating || end?.floating ? floatingNote : undefined,
          base.notes,
        ),
      }),
    );
  }
  const total = list(object.Segment).length;
  if (segments.length === 0) return { kind: "transport", skip: total ? "no leg has a usable date" : "no legs" };
  return { kind: "transport", segments, floating, ...(total > segments.length ? { dropped: total - segments.length } : {}) };
}

// A CruiseObject: its legs are port calls, each a place and a time. Like a
// flight's legs, each sailing from one call to the next is a segment (a
// ferry, the nearest kind), so every port's country counts for reports and
// document checks; a lone call is a segment with no end.
function cruise(object: Obj): Mapped {
  const base = common(object);
  const name = text(object.display_name);
  const ship = text(object.ship_name);
  const ports = list(object.Segment)
    .map((leg) => ({ at: tripItDateTime(leg.StartDateTime), place: addressPlace(text(leg.location_name), leg.LocationAddress) }))
    .filter((p): p is { at: TripItInstant; place: Place | undefined } => p.at !== undefined)
    // By the moment, not the local text: a crossing of the date line puts
    // an earlier local date after a later one.
    .sort((a, b) => Date.parse(a.at.instant) - Date.parse(b.at.instant));
  const total = list(object.Segment).length;
  if (ports.length === 0) return { kind: "cruise", skip: total ? "no port call has a usable date" : "no port calls" };
  const voyage = name ?? ship ?? "Cruise";
  const sailings = ports.length > 1 ? ports.slice(0, -1).map((from, i) => ({ from, to: ports[i + 1] })) : [{ from: ports[0]!, to: undefined }];
  const notes = joinNotes(label("Ship", name && ship !== name ? ship : undefined), label("Cabin", object.cabin_type), base.notes);
  let floating = 0;
  const segments = sailings.map(({ from, to }) => {
    const drifting = from.at.floating || to?.at.floating === true;
    if (drifting) floating += 1;
    const route = [from.place?.name, to?.place?.name].filter(Boolean).join(" to ");
    return compact({
      type: "ferry" as const,
      title: clip(route ? `${voyage}: ${route}` : voyage),
      provider: base.provider,
      confirmation: base.confirmation,
      start: from.at.instant,
      end: to?.at.instant,
      origin: from.place,
      destination: to?.place,
      notes: joinNotes(notes, drifting ? floatingNote : undefined),
    });
  });
  // A call left out for want of a date is a port the reports will not see.
  return { kind: "cruise", segments, floating, ...(total > ports.length ? { dropped: total - ports.length, droppedNoun: "port call" } : {}) };
}

function single(
  object: Obj,
  kind: string,
  type: SegmentType,
  fields: {
    start: unknown;
    end?: unknown;
    startTime?: string;
    endTime?: string;
    title: string;
    destination?: Place | undefined;
    notes?: string | undefined;
  },
): Mapped {
  if (fields.start === undefined && fields.end === undefined) return { kind, skip: nameOnly(object) };
  const start = tripItDateTime(fields.start, fields.startTime);
  if (!start) return { kind, skip: "no usable date" };
  const end = fields.end === undefined ? undefined : tripItDateTime(fields.end, fields.endTime);
  const floating = start.floating || end?.floating === true;
  const base = common(object);
  return {
    kind,
    floating: floating ? 1 : 0,
    segments: [
      compact({
        type,
        title: clip(fields.title),
        provider: base.provider,
        confirmation: base.confirmation,
        start: start.instant,
        end: end?.instant,
        destination: fields.destination,
        notes: joinNotes(fields.notes, floating ? floatingNote : undefined, base.notes),
      }),
    ],
  };
}

const hasDate = (object: Obj) => "StartDateTime" in object || "EndDateTime" in object || "DateTime" in object;

// Kinds in the order their telltale fields are checked.
function mapObject(object: Obj): Mapped {
  const name = text(object.display_name);
  const supplier = text(object.supplier_name);
  const legsOf = list(object.Segment);
  if (legsOf.some((l) => "marketing_airline_code" in l || "start_airport_code" in l || "marketing_flight_number" in l)) {
    return legs(object, "flight");
  }
  if (legsOf.some((l) => "train_number" in l || "start_station_name" in l)) return legs(object, "train");
  if (legsOf.some((l) => "carrier_name" in l || "start_location_name" in l)) return transport(object);
  if ("ship_name" in object || "cabin_type" in object || legsOf.some((l) => "location_name" in l && "StartDateTime" in l)) {
    return cruise(object);
  }
  if ("room_type" in object || "number_rooms" in object) {
    return single(object, "lodging", "lodging", {
      start: object.StartDateTime,
      end: object.EndDateTime,
      startTime: "15:00",
      endTime: "11:00",
      title: supplier ?? name ?? "Stay",
      destination: addressPlace(supplier ?? name, object.Address),
      notes: joinNotes(label("Room", object.room_type), label("Rooms", object.number_rooms)),
    });
  }
  if ("car_type" in object || "Driver" in object) {
    const pickup = text(object.start_location_name);
    return single(object, "car", "car_rental", {
      start: object.StartDateTime,
      end: object.EndDateTime,
      title: [supplier, pickup].filter(Boolean).join(" ") || name || "Car rental",
      destination: pickup ? addressPlace(pickup, object.StartLocationAddress) : undefined,
      notes: joinNotes(label("Car", object.car_type), label("Return to", object.end_location_name)),
    });
  }
  if ("cuisine" in object || "number_patrons" in object) {
    return single(object, "restaurant", "activity", {
      start: object.DateTime,
      title: supplier ?? name ?? "Restaurant",
      destination: addressPlace(supplier ?? name, object.Address),
      notes: joinNotes(label("Cuisine", object.cuisine), label("Party", object.number_patrons)),
    });
  }
  if ("text" in object && !("StartDateTime" in object)) return { kind: "note", skip: "notes are not bookings" };
  if (hasDate(object) || "detail_type_code" in object) {
    return single(object, "activity", "activity", {
      start: object.StartDateTime ?? object.DateTime,
      end: object.EndDateTime,
      title: name ?? text(object.location_name) ?? "Activity",
      destination: addressPlace(text(object.location_name) ?? name, object.Address),
    });
  }
  if (emptyLegs(object) || (legsOf.length === 0 && name)) return { kind: "unknown", skip: nameOnly(object) };
  return { kind: "unknown", skip: "not a kind of reservation Travelmo recognizes" };
}

// What a booking's identity is made of: the same reservation exported twice
// gives the same key, so a second import changes nothing.
function signature(segments: readonly ExtractedSegment[]): string[] {
  return segments.map((s) =>
    [s.type, s.start, s.origin?.code ?? s.origin?.name ?? "", s.destination?.code ?? s.destination?.name ?? "", s.title, s.confirmation ?? ""].join("|"),
  );
}

type Tally = { floating: number };

function mapAll(objects: Obj[], skipped: TripItSkip[], tally: Tally): ExtractedSegment[][] {
  const out: ExtractedSegment[][] = [];
  for (const object of objects) {
    const mapped = mapObject(object);
    const title = text(object.display_name) ?? text(object.supplier_name) ?? "(untitled)";
    if ("skip" in mapped) {
      skipped.push({ kind: mapped.kind, title, reason: mapped.skip });
    } else {
      out.push(mapped.segments);
      tally.floating += mapped.floating;
      if (mapped.dropped) {
        const noun = mapped.droppedNoun ?? "leg";
        const legs = mapped.dropped === 1 ? `1 ${noun}` : `${mapped.dropped} ${noun}s`;
        skipped.push({ kind: "leg", title, reason: `${legs} without a usable date left out; the rest imported` });
      }
    }
  }
  return out;
}

export function parseTripItExport(json: unknown): TripItImport {
  // An export with no travel history can still carry the traveler's
  // profile (travelProfile.ts), so either part makes it one.
  const parts = ["Trips", "UnfiledItems", "TravelerProfile", "Profile", "LoyaltyPrograms", "PointsPrograms", "PointsProgram"];
  if (!isObj(json) || !parts.some((part) => part in json)) {
    throw new NotATripItExport("This file is not a TripIt export: it has no Trips, UnfiledItems, profile or loyalty programs.");
  }
  const skipped: TripItSkip[] = [];
  const tally: Tally = { floating: 0 };
  const trips: TripItTrip[] = [];
  for (const entry of list(json.Trips)) {
    const data = isObj(entry.TripData) ? entry.TripData : entry;
    const title = clip(text(data.display_name) ?? text(data.primary_location) ?? "Trip");
    const segments = mapAll(list(entry.Objects), skipped, tally).flat();
    const range = segmentDateRange(segments);
    if (!range) {
      skipped.push({ kind: "trip", title, reason: "nothing in it Travelmo can import" });
      continue;
    }
    const startDate = text(data.start_date);
    const endDate = text(data.end_date);
    const start = startDate && isCalendarDate(startDate) && startDate < range.start ? startDate : range.start;
    const end = endDate && isCalendarDate(endDate) && endDate > range.end ? endDate : range.end;
    trips.push({ key: stableHash(JSON.stringify([title, startDate, endDate, signature(segments)])), title, start, end, segments });
  }
  const unfiled: TripItBooking[] = [];
  const unfiledObjects = list(json.UnfiledItems).flatMap((item) => ("Objects" in item ? list(item.Objects) : [item]));
  // Two reservations alike in every field (two rooms booked separately with
  // no reference between them) are still two: the nth copy gets its own key.
  const seen = new Map<string, number>();
  for (const segments of mapAll(unfiledObjects, skipped, tally)) {
    const sig = JSON.stringify(["unfiled", signature(segments)]);
    const n = seen.get(sig) ?? 0;
    seen.set(sig, n + 1);
    unfiled.push({ key: stableHash(n ? `${sig}#${n}` : sig), title: segments[0]!.title, segments });
  }
  return { trips, unfiled, skipped, floating: tally.floating };
}

export type TripItSummary = {
  trips: number;
  bookings: number;
  unfiled: number;
  byType: Partial<Record<SegmentType, number>>;
  skipped: number;
  floating: number;
  first?: string;
  last?: string;
};

// What the Settings page shows before anything is written.
export function summarizeTripIt(parsed: TripItImport): TripItSummary {
  const all = [...parsed.trips, ...parsed.unfiled].flatMap((b) => b.segments);
  const byType: Partial<Record<SegmentType, number>> = {};
  for (const s of all) byType[s.type] = (byType[s.type] ?? 0) + 1;
  const range = segmentDateRange(all);
  return {
    trips: parsed.trips.length,
    bookings: all.length,
    unfiled: parsed.unfiled.reduce((n, b) => n + b.segments.length, 0),
    byType,
    skipped: parsed.skipped.length,
    floating: parsed.floating,
    ...(range ? { first: range.start, last: range.end } : {}),
  };
}

// Skips grouped by reason, most frequent first, for a preview that lists
// a hundred name-only reservations as one line.
export type SkipGroup = { reason: string; titles: string[] };

export function groupSkips(skipped: readonly { title: string; reason: string }[]): SkipGroup[] {
  const groups = new Map<string, string[]>();
  for (const s of skipped) groups.set(s.reason, [...(groups.get(s.reason) ?? []), s.title]);
  return [...groups].map(([reason, titles]) => ({ reason, titles })).sort((a, b) => b.titles.length - a.titles.length);
}
