import type { ExtractedSegment, FlightStatus } from "@travelmo/core";
import { z } from "zod";

// FlightAware AeroAPI (https://www.flightaware.com/aeroapi/portal/documentation),
// asked for one flight number around one day: each answer is one query,
// about half a US cent on the Personal tier. Without AEROAPI_KEY flight
// status is off.

export const aeroApiBase = "https://aeroapi.flightaware.com/aeroapi";
export const aeroApiTimeoutMs = 10_000;

const text = z.string().min(1).nullish();
const instant = z.string().min(1).nullish();

const AeroAirport = z.object({ code_iata: text }).nullish();

export const AeroFlight = z.object({
  origin: AeroAirport,
  destination: AeroAirport,
  scheduled_out: instant,
  estimated_out: instant,
  actual_out: instant,
  // Takeoff and touchdown. Many airports report no gate times (`actual_out`,
  // `actual_in`), so these stand in for them.
  actual_off: instant,
  scheduled_in: instant,
  estimated_in: instant,
  actual_in: instant,
  actual_on: instant,
  gate_origin: text,
  gate_destination: text,
  terminal_origin: text,
  terminal_destination: text,
  baggage_claim: text,
  cancelled: z.boolean().nullish(),
  diverted: z.boolean().nullish(),
});
export type AeroFlight = z.infer<typeof AeroFlight>;

const AeroFlights = z.object({ flights: z.array(z.unknown()) });

export class AeroApiError extends Error {
  constructor(readonly code: string) {
    super(`AeroAPI ${code}`);
    this.name = "AeroApiError";
  }
}

// The flights flying a number whose departure falls between two instants.
// An empty list for a number AeroAPI does not know.
export type FlightLookup = (ident: string, from: string, to: string) => Promise<AeroFlight[]>;

export function aeroApiLookup(key: string, fetchFn: typeof fetch = fetch): FlightLookup {
  return async (ident, from, to) => {
    const query = new URLSearchParams({ ident_type: "designator", start: from, end: to, max_pages: "1" });
    let response: Response;
    try {
      response = await fetchFn(`${aeroApiBase}/flights/${encodeURIComponent(ident)}?${query}`, {
        headers: { "x-apikey": key, accept: "application/json" },
        signal: AbortSignal.timeout(aeroApiTimeoutMs),
      });
    } catch (error) {
      throw new AeroApiError(`UNREACHABLE: ${(error as Error).message}`);
    }
    // "No data": an unknown airline or a number with no flights then.
    if (response.status === 404) return [];
    if (!response.ok) throw new AeroApiError(`HTTP_${response.status}`);
    const body = AeroFlights.safeParse(await response.json());
    if (!body.success) throw new AeroApiError("MALFORMED");
    return body.data.flights.flatMap((f) => {
      const flight = AeroFlight.safeParse(f);
      return flight.success ? [flight.data] : [];
    });
  };
}

const hour = 60 * 60_000;
// How far from the booked departure a flight may leave and still be the
// one booked: AeroAPI's times are the airline's latest schedule.
export const matchWindowMs = 12 * hour;

// The window to ask about for a booking: its departure, give or take.
export function lookupWindow(start: string): { from: string; to: string } {
  const at = Date.parse(start);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { from: iso(at - matchWindowMs), to: iso(at + matchWindowMs) };
}

// The flight that is the booking: from the booking's airport when it names
// one, leaving closest to the booked time.
export function matchFlight(flights: readonly AeroFlight[], segment: Pick<ExtractedSegment, "start" | "origin">): AeroFlight | undefined {
  const origin = segment.origin?.code?.toUpperCase();
  const booked = Date.parse(segment.start);
  let best: { flight: AeroFlight; distance: number } | undefined;
  for (const flight of flights) {
    if (origin && flight.origin?.code_iata && flight.origin.code_iata.toUpperCase() !== origin) continue;
    const out = flight.scheduled_out ? Date.parse(flight.scheduled_out) : NaN;
    if (Number.isNaN(out)) continue;
    const distance = Math.abs(out - booked);
    if (distance > matchWindowMs) continue;
    if (!best || distance < best.distance) best = { flight, distance };
  }
  return best?.flight;
}

const isoInstant = (value: string | null | undefined): string | undefined =>
  value && !Number.isNaN(Date.parse(value)) ? value : undefined;

// What is kept of an answer: the places and the times that say when to look
// again. Absent fields stay absent rather than null.
export function statusFromFlight(
  flight: AeroFlight | undefined,
  key: Pick<FlightStatus, "ident" | "date" | "origin">,
  checkedAt: string,
): FlightStatus {
  const base = { ident: key.ident, date: key.date, ...(key.origin ? { origin: key.origin } : {}), checkedAt };
  if (!flight) return { ...base, found: false };
  const fields: Partial<FlightStatus> = {
    departureGate: flight.gate_origin ?? undefined,
    departureTerminal: flight.terminal_origin ?? undefined,
    arrivalGate: flight.gate_destination ?? undefined,
    arrivalTerminal: flight.terminal_destination ?? undefined,
    baggageClaim: flight.baggage_claim ?? undefined,
    scheduledOut: isoInstant(flight.scheduled_out),
    estimatedOut: isoInstant(flight.estimated_out),
    // Left the gate, or failing a gate time, took off: either way it has gone.
    actualOut: isoInstant(flight.actual_out) ?? isoInstant(flight.actual_off),
    scheduledIn: isoInstant(flight.scheduled_in),
    estimatedIn: isoInstant(flight.estimated_in),
    actualIn: isoInstant(flight.actual_in) ?? isoInstant(flight.actual_on),
    ...(flight.cancelled ? { cancelled: true } : {}),
    // A diverted flight's destination is where it now goes.
    ...(flight.diverted ? { diverted: true, divertedTo: flight.destination?.code_iata ?? undefined } : {}),
  };
  const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<FlightStatus>;
  return { ...base, found: true, ...kept };
}
