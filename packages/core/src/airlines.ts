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

// Airlines by IATA code, as a booking's heading names them (bookingHeading).
// The airlines travelers book most; one not listed keeps the booking's own
// title. Mirrored in the Android app's core (Airlines.kt): keep the two the
// same.
export const airlineNames: Readonly<Record<string, string>> = {
  "2K": "Avianca Ecuador",
  "3K": "Jetstar Asia",
  "3U": "Sichuan Airlines",
  "4U": "Germanwings",
  "5J": "Cebu Pacific",
  "6E": "IndiGo",
  "7C": "Jeju Air",
  "8M": "Myanmar Airways International",
  "9W": "Jet Airways",
  A3: "Aegean Airlines",
  AA: "American Airlines",
  AC: "Air Canada",
  AD: "Azul",
  AF: "Air France",
  AI: "Air India",
  AK: "AirAsia",
  AM: "Aeroméxico",
  AR: "Aerolíneas Argentinas",
  AS: "Alaska Airlines",
  AT: "Royal Air Maroc",
  AV: "Avianca",
  AY: "Finnair",
  AZ: "ITA Airways",
  B6: "JetBlue",
  BA: "British Airways",
  BI: "Royal Brunei Airlines",
  BR: "EVA Air",
  BT: "airBaltic",
  BW: "Caribbean Airlines",
  CA: "Air China",
  CI: "China Airlines",
  CM: "Copa Airlines",
  CX: "Cathay Pacific",
  CZ: "China Southern Airlines",
  D7: "AirAsia X",
  D8: "Norwegian",
  DE: "Condor",
  DL: "Delta Air Lines",
  DY: "Norwegian",
  EI: "Aer Lingus",
  EK: "Emirates",
  EN: "Air Dolomiti",
  ET: "Ethiopian Airlines",
  EW: "Eurowings",
  EY: "Etihad Airways",
  F9: "Frontier Airlines",
  FI: "Icelandair",
  FJ: "Fiji Airways",
  FR: "Ryanair",
  FZ: "flydubai",
  G3: "GOL",
  G4: "Allegiant Air",
  GA: "Garuda Indonesia",
  GF: "Gulf Air",
  HA: "Hawaiian Airlines",
  HU: "Hainan Airlines",
  HV: "Transavia",
  IB: "Iberia",
  IZ: "Arkia",
  JJ: "LATAM Brasil",
  JL: "Japan Airlines",
  JQ: "Jetstar",
  JU: "Air Serbia",
  KC: "Air Astana",
  KE: "Korean Air",
  KL: "KLM",
  KM: "KM Malta Airlines",
  KQ: "Kenya Airways",
  KU: "Kuwait Airways",
  LA: "LATAM Airlines",
  LG: "Luxair",
  LH: "Lufthansa",
  LO: "LOT Polish Airlines",
  LS: "Jet2",
  LX: "SWISS",
  LY: "El Al",
  MF: "Xiamen Airlines",
  MH: "Malaysia Airlines",
  MK: "Air Mauritius",
  MS: "EgyptAir",
  MU: "China Eastern Airlines",
  NH: "ANA",
  NK: "Spirit Airlines",
  NZ: "Air New Zealand",
  OA: "Olympic Air",
  OK: "Czech Airlines",
  OS: "Austrian Airlines",
  OU: "Croatia Airlines",
  OZ: "Asiana Airlines",
  PC: "Pegasus Airlines",
  PD: "Porter Airlines",
  PG: "Bangkok Airways",
  PK: "Pakistan International Airlines",
  PR: "Philippine Airlines",
  QF: "Qantas",
  QR: "Qatar Airways",
  RJ: "Royal Jordanian",
  RO: "TAROM",
  S7: "S7 Airlines",
  SA: "South African Airways",
  SK: "SAS",
  SN: "Brussels Airlines",
  SQ: "Singapore Airlines",
  SV: "Saudia",
  SY: "Sun Country Airlines",
  TG: "Thai Airways",
  TK: "Turkish Airlines",
  TO: "Transavia France",
  TP: "TAP Air Portugal",
  TR: "Scoot",
  TS: "Air Transat",
  U2: "easyJet",
  UA: "United Airlines",
  UK: "Vistara",
  UL: "SriLankan Airlines",
  UX: "Air Europa",
  V7: "Volotea",
  VA: "Virgin Australia",
  VJ: "VietJet Air",
  VN: "Vietnam Airlines",
  VS: "Virgin Atlantic",
  VY: "Vueling",
  W6: "Wizz Air",
  WN: "Southwest Airlines",
  WS: "WestJet",
  WY: "Oman Air",
  XQ: "SunExpress",
  XY: "flynas",
  ZH: "Shenzhen Airlines",
};

const foldName = (name: string) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The listed airline a booking's provider names, if exactly one: "Delta" is
// Delta Air Lines; "Virgin" could be Virgin Atlantic or Virgin Australia, so
// is none. A booking site ("Expedia") is no airline.
export function airlineNamed(provider: string | undefined): { code: string; name: string } | undefined {
  const wanted = provider ? foldName(provider) : "";
  if (!wanted) return undefined;
  // One named in full first: "AirAsia X" is that, not also AirAsia.
  const exact = Object.entries(airlineNames).filter(([, name]) => foldName(name) === wanted);
  const found = exact.length > 0 ? exact : Object.entries(airlineNames).filter(([, name]) => {
    const listed = foldName(name);
    return listed.startsWith(`${wanted} `) || wanted.startsWith(`${listed} `);
  });
  const names = new Set(found.map(([, name]) => name));
  return names.size === 1 ? { code: found[0]![0], name: found[0]![1] } : undefined;
}

// The flight number as a heading writes it: the airline code, a space and
// the number ("VS 11", "FR 1401"), from the booking's title.
export function flightNumber(segment: Pick<ExtractedSegment, "type" | "title">): string | undefined {
  const designator = flightDesignator(segment);
  return designator ? `${designator.slice(0, 2)} ${designator.slice(2)}` : undefined;
}

// A booking as its row and page head it. A flight is headed by its airline
// ("Virgin Atlantic"), with its flight number leading the route line
// ("VS 11 · LHR London → BOS Boston"): the airline its provider names, the
// one flying it on a codeshare ("Delta" on a Virgin Atlantic ticket), else
// the one its flight number's code is. Anything else, or a flight of an
// airline not listed, keeps its title, which already says it.
export type BookingHeading = { headline: string; airline?: string; flightNumber?: string };
export function bookingHeading(segment: Pick<ExtractedSegment, "type" | "title" | "provider">): BookingHeading {
  if (segment.type !== "flight") return { headline: segment.title };
  const code = airlineCode(segment);
  const airline = airlineNamed(segment.provider) ?? (code && airlineNames[code] ? { code, name: airlineNames[code]! } : undefined);
  if (!airline) return { headline: segment.title };
  const number = flightNumber(segment);
  return { headline: airline.name, airline: airline.code, ...(number ? { flightNumber: number } : {}) };
}
