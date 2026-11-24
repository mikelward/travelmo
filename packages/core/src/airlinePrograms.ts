import { airlineCode } from "./airlines";
import { nameWords } from "./loyalty";
import type { ExtractedMembership, ExtractedSegment } from "./schema";

// Airlines' frequent flyer programs, by IATA airline code, for a number an
// email shows under a generic label ("Frequent flyer: UA-*****505"). Only
// programs whose name is stable and unambiguous are listed; anything else
// keeps the name the email gave.
export const airlinePrograms: Readonly<Record<string, string>> = {
  AA: "American Airlines AAdvantage",
  AC: "Air Canada Aeroplan",
  AF: "Air France-KLM Flying Blue",
  AS: "Alaska Airlines Mileage Plan",
  B6: "JetBlue TrueBlue",
  BA: "British Airways Executive Club",
  CX: "Cathay Pacific Asia Miles",
  DL: "Delta SkyMiles",
  EI: "Aer Lingus AerClub",
  EK: "Emirates Skywards",
  IB: "Iberia Plus",
  KL: "Air France-KLM Flying Blue",
  LH: "Lufthansa Miles & More",
  NZ: "Air New Zealand Airpoints",
  QF: "Qantas Frequent Flyer",
  QR: "Qatar Airways Privilege Club",
  SQ: "Singapore Airlines KrisFlyer",
  UA: "United MileagePlus",
  VS: "Virgin Atlantic Flying Club",
  WN: "Southwest Rapid Rewards",
};

// An airline code written before the number, as many emails do
// ("UA-*****505", "BA 12345678").
const codePrefix = /^([A-Z][A-Z0-9]|[0-9][A-Z])[-\s]+(?=[A-Z0-9*•])/;

// A generic label that can only be an airline's.
const flyerLabel = /\b(frequent\s*fl[yi]er|fl[yi]er|airline|mileage|air\s*miles)\b/i;

// The program a membership belongs to, when the email named it only
// generically ("Frequent Flyer", "Loyalty number"): the airline code written
// before the number, else the one airline every flight of the booking is
// with. A name that already says which program is kept as given.
export function namedProgram(membership: ExtractedMembership, segments: readonly Pick<ExtractedSegment, "type" | "title">[]): string {
  if (nameWords(membership.program).size) return membership.program;
  // A program named by its airline's code ("BA") says which it is too, even
  // on a booking with another airline (a partner's number).
  const named = membership.program.trim().toUpperCase();
  if (/^[A-Z0-9]{2}$/.test(named)) return airlinePrograms[named] ?? membership.program;
  const prefixed = codePrefix.exec(membership.number.trim().toUpperCase())?.[1];
  // A code before the number says whose it is, even one not listed: that
  // airline's (a partner's) number, not the booking's airline's.
  if (prefixed) return airlinePrograms[prefixed] ?? membership.program;
  // The booking's airline only for a label that says frequent flyer: a
  // generic hotel or rental label ("Hotel Rewards") on a booking with a
  // flight is not the airline's.
  if (!flyerLabel.test(membership.program)) return membership.program;
  const codes = new Set(segments.filter((s) => s.type === "flight").map(airlineCode));
  const [only] = codes;
  return codes.size === 1 && only && airlinePrograms[only] ? airlinePrograms[only] : membership.program;
}
