import { flightDesignator } from "./flightStatus";
import type { ExtractedSegment } from "./schema";

// When airlines open online check-in, by IATA airline code, and the site a
// traveler checks in on. Mirrored in the Android app's core (Airlines.kt).
//
// Only airlines whose window is well known and stable are listed, each as
// the airline's own help pages state it; a wrong window is worse than the
// default, which is what most airlines do. The site is the airline's home
// page rather than a deep link to its check-in form: those paths move
// often, and every home page leads to check-in. Windows change now and
// then, which is why the trip card says "usually".

export type AirlineCheckIn = { hours: number; site: string };

// A day before departure: what most airlines do, and the answer for any
// airline not listed.
export const defaultCheckInHours = 24;

export const airlineCheckIns: Readonly<Record<string, AirlineCheckIn>> = {
  // A day before departure, the common window.
  AA: { hours: 24, site: "https://www.aa.com/" }, // American Airlines
  AC: { hours: 24, site: "https://www.aircanada.com/" }, // Air Canada
  AS: { hours: 24, site: "https://www.alaskaair.com/" }, // Alaska Airlines
  B6: { hours: 24, site: "https://www.jetblue.com/" }, // JetBlue
  BA: { hours: 24, site: "https://www.britishairways.com/" }, // British Airways
  DL: { hours: 24, site: "https://www.delta.com/" }, // Delta Air Lines
  QF: { hours: 24, site: "https://www.qantas.com/" }, // Qantas
  UA: { hours: 24, site: "https://www.united.com/" }, // United Airlines
  VA: { hours: 24, site: "https://www.virginaustralia.com/" }, // Virgin Australia
  WN: { hours: 24, site: "https://www.southwest.com/" }, // Southwest Airlines
  // The Lufthansa Group's mainline carriers open an hour later than most.
  LH: { hours: 23, site: "https://www.lufthansa.com/" }, // Lufthansa
  LX: { hours: 23, site: "https://www.swiss.com/" }, // SWISS
  // Air France and KLM open 30 hours before.
  AF: { hours: 30, site: "https://www.airfrance.com/" }, // Air France
  KL: { hours: 30, site: "https://www.klm.com/" }, // KLM
  AY: { hours: 36, site: "https://www.finnair.com/" }, // Finnair
  // Two days before.
  CX: { hours: 48, site: "https://www.cathaypacific.com/" }, // Cathay Pacific
  EK: { hours: 48, site: "https://www.emirates.com/" }, // Emirates
  SQ: { hours: 48, site: "https://www.singaporeair.com/" }, // Singapore Airlines
  // 30 days before.
  U2: { hours: 30 * 24, site: "https://www.easyjet.com/" }, // easyJet
};

// The airline's IATA code, from the flight number in the booking's title
// ("QF 1 SYD to LHR" → "QF"), as live flight status reads it.
export function airlineCode(segment: Pick<ExtractedSegment, "type" | "title">): string | undefined {
  return flightDesignator(segment)?.slice(0, 2);
}

// What the table says about the booking's airline, if it is listed.
export function airlineCheckIn(segment: Pick<ExtractedSegment, "type" | "title">): AirlineCheckIn | undefined {
  const code = airlineCode(segment);
  return code ? airlineCheckIns[code] : undefined;
}

// How many hours before departure online check-in opens for the booking.
export function checkInHoursBefore(segment: Pick<ExtractedSegment, "type" | "title">): number {
  return airlineCheckIn(segment)?.hours ?? defaultCheckInHours;
}
