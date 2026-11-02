import { stableHash } from "./hash";
import { composeInstant, isCalendarDate, isValidInstant } from "./instant";
import type { ExtractedSegment, Place, SegmentType } from "./schema";
import { segmentDateRange } from "./trips";
import { zoneOffset } from "./zone";

// Reads the JSON export TripIt customer service sends on request. Nothing in
// it declares an object's kind: a reservation is told apart by its fields
// (flight legs carry airline codes, a stay a room type, and so on), and
// whatever cannot be told apart, or has no usable date, is reported rather
// than guessed at. Every DateTime carries a date, a time, an IANA zone and
// the offset in force, which map straight onto our instants.
//
// TripIt's JSON is converted from XML, so a list of one is often a bare
// object and numbers are often strings; every read here tolerates both.

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

// A TripIt DateTime as one of our instants. A date with no time takes
// `defaultTime` (check-in and check-out hours for a stay); with no offset or
// zone at all there is no honest instant, so none.
export function tripItInstant(value: unknown, defaultTime = "12:00"): string | undefined {
  if (!isObj(value)) return undefined;
  const date = text(value.date);
  if (!date || !isoDatePattern.test(date)) return undefined;
  const timeMatch = timePattern.exec(text(value.time) ?? "");
  const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : defaultTime;
  const offset = offsetOf(value, date, time);
  if (!offset) return undefined;
  const instant = composeInstant({ date, time, offset });
  // Out-of-range parts (month 99, 25:00, +99:99) make no instant at all, so
  // the booking is reported as undated rather than written malformed.
  return isValidInstant(instant) ? instant : undefined;
}

function place(name: unknown, code: unknown, city: unknown, country: unknown): Place | undefined {
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
  };
}

function addressPlace(name: unknown, address: unknown): Place | undefined {
  const a = isObj(address) ? address : {};
  return place(name ?? a.address, undefined, a.city, a.country);
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
    notes: joinNotes(text(object.notes), text(object.restrictions)),
  };
}

function compact<T extends Obj>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

// `dropped` counts legs left out of a reservation that still has others, so
// the report names them rather than the import passing as whole.
type Mapped = { kind: string; segments: ExtractedSegment[]; dropped?: number } | { kind: string; skip: string };

function legs(object: Obj, kind: "flight" | "train"): Mapped {
  const base = common(object);
  const segments: ExtractedSegment[] = [];
  for (const leg of list(object.Segment)) {
    const start = tripItInstant(leg.StartDateTime);
    if (!start) continue;
    const end = tripItInstant(leg.EndDateTime);
    let origin: Place | undefined;
    let destination: Place | undefined;
    let number: string | undefined;
    let provider: string | undefined;
    if (kind === "flight") {
      origin = place(leg.start_airport_name ?? leg.start_city_name, leg.start_airport_code, leg.start_city_name, leg.start_country_code);
      destination = place(leg.end_airport_name ?? leg.end_city_name, leg.end_airport_code, leg.end_city_name, leg.end_country_code);
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
        start,
        end,
        origin,
        destination,
        notes: joinNotes(
          label("Seat", leg.seats),
          label("Departure terminal", leg.start_terminal),
          label("Departure gate", leg.start_gate),
          label("Arrival terminal", leg.end_terminal),
          label("Aircraft", leg.aircraft_display_name),
          label("Coach", leg.coach_number),
          base.notes,
        ),
      }),
    );
  }
  const total = list(object.Segment).length;
  if (segments.length === 0) return { kind, skip: total ? "no leg has a usable date" : "no legs" };
  return { kind, segments, ...(total > segments.length ? { dropped: total - segments.length } : {}) };
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
  const start = tripItInstant(fields.start, fields.startTime);
  if (!start) return { kind, skip: "no usable date" };
  const base = common(object);
  return {
    kind,
    segments: [
      compact({
        type,
        title: clip(fields.title),
        provider: base.provider,
        confirmation: base.confirmation,
        start,
        end: fields.end === undefined ? undefined : tripItInstant(fields.end, fields.endTime),
        destination: fields.destination,
        notes: joinNotes(fields.notes, base.notes),
      }),
    ],
  };
}

// Kinds in the order their telltale fields are checked.
function mapObject(object: Obj): Mapped {
  const name = text(object.display_name);
  const supplier = text(object.supplier_name);
  const legsOf = list(object.Segment);
  if (legsOf.some((l) => "marketing_airline_code" in l || "start_airport_code" in l || "marketing_flight_number" in l)) {
    return legs(object, "flight");
  }
  if (legsOf.some((l) => "train_number" in l || "start_station_name" in l)) return legs(object, "train");
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
      destination: place(pickup, undefined, undefined, undefined),
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
  if ("StartDateTime" in object || "DateTime" in object || "detail_type_code" in object) {
    return single(object, "activity", "activity", {
      start: object.StartDateTime ?? object.DateTime,
      end: object.EndDateTime,
      title: name ?? text(object.location_name) ?? "Activity",
      destination: addressPlace(text(object.location_name) ?? name, object.Address),
    });
  }
  return { kind: "unknown", skip: "not a kind of reservation Travelmo recognizes" };
}

// What a booking's identity is made of: the same reservation exported twice
// gives the same key, so a second import changes nothing.
function signature(segments: readonly ExtractedSegment[]): string[] {
  return segments.map((s) =>
    [s.type, s.start, s.origin?.code ?? s.origin?.name ?? "", s.destination?.code ?? s.destination?.name ?? "", s.title, s.confirmation ?? ""].join("|"),
  );
}

function mapAll(objects: Obj[], skipped: TripItSkip[]): ExtractedSegment[][] {
  const out: ExtractedSegment[][] = [];
  for (const object of objects) {
    const mapped = mapObject(object);
    const title = text(object.display_name) ?? text(object.supplier_name) ?? "(untitled)";
    if ("skip" in mapped) {
      skipped.push({ kind: mapped.kind, title, reason: mapped.skip });
    } else {
      out.push(mapped.segments);
      if (mapped.dropped) {
        const legs = mapped.dropped === 1 ? "1 leg" : `${mapped.dropped} legs`;
        skipped.push({ kind: "leg", title, reason: `${legs} without a usable date left out; the rest imported` });
      }
    }
  }
  return out;
}

export function parseTripItExport(json: unknown): TripItImport {
  if (!isObj(json) || !("Trips" in json || "UnfiledItems" in json)) {
    throw new NotATripItExport("This file is not a TripIt export: it has no Trips or UnfiledItems.");
  }
  const skipped: TripItSkip[] = [];
  const trips: TripItTrip[] = [];
  for (const entry of list(json.Trips)) {
    const data = isObj(entry.TripData) ? entry.TripData : entry;
    const title = clip(text(data.display_name) ?? text(data.primary_location) ?? "Trip");
    const segments = mapAll(list(entry.Objects), skipped).flat();
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
  for (const segments of mapAll(unfiledObjects, skipped)) {
    const sig = JSON.stringify(["unfiled", signature(segments)]);
    const n = seen.get(sig) ?? 0;
    seen.set(sig, n + 1);
    unfiled.push({ key: stableHash(n ? `${sig}#${n}` : sig), title: segments[0]!.title, segments });
  }
  return { trips, unfiled, skipped };
}

export type TripItSummary = {
  trips: number;
  bookings: number;
  unfiled: number;
  byType: Partial<Record<SegmentType, number>>;
  skipped: number;
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
    ...(range ? { first: range.start, last: range.end } : {}),
  };
}
