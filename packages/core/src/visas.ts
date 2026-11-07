import type { TravelDocument } from "./documents";

// What a passport needs to enter a country, from the generated table
// (visaRules.json, scripts/visas.mjs): the rule for one passport and one
// destination, the most lenient rule across a traveler's passports, and
// the rules a trip's countries need from each person on it.

export type EntryKind = "home" | "free" | "arrival" | "eta" | "evisa" | "required" | "no-admission" | "unknown";

export type EntryRule = { kind: EntryKind; days?: number };

export type VisaTable = {
  fetched: string;
  destinations: string[];
  days: Record<string, number>;
  rules: Record<string, string>;
};

const kinds: Record<string, EntryKind> = { "-": "home", F: "free", A: "arrival", T: "eta", E: "evisa", R: "required", N: "no-admission" };

// The rule for a passport entering a destination; unknown when either is
// not in the table or the table has no data for the pair.
export function entryRule(table: VisaTable, passport: string, destination: string): EntryRule {
  const row = table.rules[passport.toUpperCase()];
  const column = table.destinations.indexOf(destination.toUpperCase());
  const code = row && column >= 0 ? row[column] : undefined;
  if (!code) return { kind: "unknown" };
  const kind = kinds[code];
  if (kind) return { kind };
  const days = table.days[code];
  return days === undefined ? { kind: "unknown" } : { kind: "free", days };
}

// Easiest first.
const rank: Record<EntryKind, number> = { home: 0, free: 1, arrival: 2, eta: 3, evisa: 4, required: 5, "no-admission": 6, unknown: 7 };

const easier = (a: EntryRule, b: EntryRule) => rank[a.kind] - rank[b.kind] || (b.days ?? Infinity) - (a.days ?? Infinity);

export type BestEntry = { rule: EntryRule; passport: string };

// The easiest rule among a traveler's passports; more visa-free days beat
// fewer. With no passport, nothing can be said.
export function bestEntry(table: VisaTable, passports: readonly string[], destination: string): BestEntry | undefined {
  let best: BestEntry | undefined;
  for (const passport of passports) {
    const rule = entryRule(table, passport, destination);
    if (!best || easier(rule, best.rule) < 0) best = { rule, passport: passport.toUpperCase() };
  }
  return best;
}

// Rules a traveler must act on before leaving.
export const needsAction = (kind: EntryKind): boolean => kind === "eta" || kind === "evisa" || kind === "required" || kind === "no-admission";

export function entryLabel(rule: EntryRule): string {
  switch (rule.kind) {
    case "home":
      return "Home country";
    case "free":
      return rule.days ? `Visa-free up to ${rule.days} days` : "Visa-free";
    case "arrival":
      return "Visa on arrival";
    case "eta":
      return "Electronic travel authorization needed";
    case "evisa":
      return "E-visa needed";
    case "required":
      return "Visa required";
    case "no-admission":
      return "No admission";
    default:
      return "No data";
  }
}

export type EntryNeed = {
  country: string;
  best: BestEntry;
  // A visa in the traveler's profile for this country that lasts the trip.
  visa?: TravelDocument;
};

export type TravelerEntry = { passports: string[]; needs: EntryNeed[] };

// The passports among a person's documents that are still valid at the
// start of the trip, by the country that issued them.
export function passportsOf(documents: readonly TravelDocument[], tripStart: string): string[] {
  return [...new Set(documents.filter((d) => d.kind === "passport" && d.country && d.expires >= tripStart).map((d) => d.country!.toUpperCase()))];
}

// What one traveler needs for each of a trip's countries, their own left
// out, countries sorted; a visa they hold for the country is noted.
export function travelerEntry(
  table: VisaTable,
  documents: readonly TravelDocument[],
  countries: ReadonlySet<string>,
  trip: { start: string; end: string },
): TravelerEntry {
  const passports = passportsOf(documents, trip.start);
  if (!passports.length) return { passports, needs: [] };
  const needs: EntryNeed[] = [];
  for (const country of [...countries].map((c) => c.toUpperCase()).sort()) {
    const best = bestEntry(table, passports, country);
    if (!best || best.rule.kind === "home") continue;
    const visa = documents.find((d) => d.kind === "visa" && d.country?.toUpperCase() === country && d.expires >= trip.end);
    needs.push({ country, best, ...(visa ? { visa } : {}) });
  }
  return { passports, needs };
}
