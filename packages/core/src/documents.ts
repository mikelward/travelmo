import { countryCodeOf, countryName } from "./countries";
import { formatDate } from "./format";
import { daysBetween } from "./trips";
import { tripPlaces, type PlaceLookup } from "./reports";
import type { ExtractedSegment, ProfileEntry, TravelProfile, Trip } from "./schema";

// Passports, visas and other travel documents in a travel profile, read for
// their expiry dates so a trip can warn of one that runs out too soon. The
// profile keeps whatever its import found as labeled strings, so documents
// are recognized by their labels and dates by their usual spellings.

export type DocumentKind = "passport" | "visa" | "other";

export type TravelDocument = {
  title: string;
  kind: DocumentKind;
  // YYYY-MM-DD.
  expires: string;
  // ISO country that issued it (a passport) or that it admits to (a visa),
  // when the profile gives a two-letter code.
  country?: string;
};

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number): string | undefined {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const month = (name: string) => {
  const i = months.indexOf(name.slice(0, 3).toLowerCase());
  return i < 0 ? undefined : i + 1;
};

// "2031-05-06", "2031-05-06T00:00:00Z", "6 May 2031", "May 6, 2031". Dates
// written only in numbers with slashes are left alone: 06/05/2031 is a
// different day in the US and in Europe, and a wrong warning is worse than
// none.
export function parseDocumentDate(value: string): string | undefined {
  const text = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(text);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/.exec(text);
  if (m && month(m[2]!)) return validDate(Number(m[3]), month(m[2]!)!, Number(m[1]));
  m = /^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(text);
  if (m && month(m[1]!)) return validDate(Number(m[3]), month(m[1]!)!, Number(m[2]));
  return undefined;
}

const lastPart = (label: string) => label.split(" › ").at(-1)!.toLowerCase();
const isExpiry = (label: string) => /expir|valid (until|to|through)|valid thru/.test(lastPart(label));
const isNationality = (label: string) => /nationality|citizenship/.test(lastPart(label));
// A country of birth says nothing about which country a document is for.
const isCountry = (label: string) => /country/.test(lastPart(label)) && !/birth/.test(lastPart(label)) && !isNationality(label);

// The country a document belongs to: for a passport, the one that issued it
// (its holder's nationality is the same); for a visa, the one it admits to
// (the country field, which is also its issuer), never its holder's
// nationality, which says nothing of where it is valid. Written as a code
// or as a name ("Australia", as TripIt's profile has it).
function countryOf(entry: ProfileEntry, kind: DocumentKind): string | undefined {
  const code = (f: { value: string }) => countryCodeOf(f.value) ?? f.value.trim().toUpperCase();
  const pick = (test: (label: string) => boolean) => entry.fields.filter((f) => test(f.label)).map(code).find((v) => /^[A-Z]{2}$/.test(v));
  return kind === "passport" ? (pick(isNationality) ?? pick(isCountry)) : pick(isCountry);
}
const isType = (label: string) => /^(document )?type$/.test(lastPart(label));

function kindOf(entry: ProfileEntry): DocumentKind {
  const text = [entry.title, ...entry.fields.filter((f) => isType(f.label)).map((f) => f.value)].join(" ").toLowerCase();
  if (text.includes("passport")) return "passport";
  if (text.includes("visa")) return "visa";
  return "other";
}

// Every document entry with an expiry date this can read.
export function travelDocuments(entries: readonly ProfileEntry[]): TravelDocument[] {
  return entries.flatMap((entry) => {
    const expires = entry.fields.filter((f) => isExpiry(f.label)).map((f) => parseDocumentDate(f.value)).find(Boolean);
    if (!expires) return [];
    const kind = kindOf(entry);
    const country = countryOf(entry, kind);
    return [{ title: entry.title, kind, expires, ...(country ? { country } : {}) }];
  });
}

// Many countries want a passport valid for six months beyond the stay.
export const passportMarginMonths = 6;

function addMonths(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export type DocumentWarning = {
  document: TravelDocument;
  // "before": it runs out before the trip ends; "soon": within the margin
  // after it.
  when: "before" | "soon";
  // Whole days from the trip's end to the expiry (negative when before).
  daysAfterTrip: number;
};

export type TripPlaces = {
  // Countries the trip's bookings are in.
  countries: ReadonlySet<string>;
  // Whether every booking's place has a known country, so the set is whole.
  complete: boolean;
};

// The documents to warn about for a trip still to come or under way. A
// passport is checked for the margin; a visa or other document only for
// lasting the trip. A passport is not needed for a trip known to stay in the
// country that issued it, nor a visa for a trip known not to go to its
// country.
export function documentWarnings(
  documents: readonly TravelDocument[],
  trip: { start: string; end: string },
  today: string,
  places?: TripPlaces,
): DocumentWarning[] {
  if (trip.end < today) return [];
  const known = places?.complete && places.countries.size > 0 ? places.countries : undefined;
  return documents.flatMap((document): DocumentWarning[] => {
    if (document.country && known) {
      if (document.kind === "passport" && [...known].every((c) => c === document.country)) return [];
      if (document.kind === "visa" && !known.has(document.country)) return [];
    }
    const daysAfterTrip = daysBetween(trip.end, document.expires);
    if (document.expires < trip.end) return [{ document, when: "before", daysAfterTrip }];
    if (document.kind === "passport" && document.expires < addMonths(trip.end, passportMarginMonths)) {
      return [{ document, when: "soon", daysAfterTrip }];
    }
    return [];
  });
}

// Whose documents they are: the viewer's own, or someone who shared their
// profile with the viewer (by email).
export type PersonDocuments = { uid: string; email?: string; own: boolean; documents: TravelDocument[] };

export function peopleDocuments(own: TravelProfile | null | undefined, shared: readonly TravelProfile[], uid: string): PersonDocuments[] {
  const people: PersonDocuments[] = [];
  if (own) people.push({ uid, own: true, documents: travelDocuments(own.documents) });
  for (const p of shared) {
    if (p.ownerUid === uid) continue;
    people.push({ uid: p.ownerUid, ...(p.ownerEmail ? { email: p.ownerEmail } : {}), own: false, documents: travelDocuments(p.documents) });
  }
  return people.filter((p) => p.documents.length);
}

export type PersonWarning = { person: PersonDocuments; warning: DocumentWarning };

// Someone else's documents matter for a trip they are on: one they own or
// that is shared with them. The viewer is on every trip they can see.
export const onTrip = (person: PersonDocuments, trip: Trip) =>
  person.own || person.uid === trip.ownerUid || (!!person.email && trip.sharedWith.includes(person.email.toLowerCase()));

export function tripWarnings(
  people: readonly PersonDocuments[],
  trip: Trip,
  segments: readonly ExtractedSegment[] | undefined,
  today: string,
  lookup?: PlaceLookup,
): PersonWarning[] {
  const places = segments ? tripPlaces(segments, lookup) : undefined;
  return people
    .filter((p) => onTrip(p, trip))
    .flatMap((person) => documentWarnings(person.documents, trip, today, places).map((warning) => ({ person, warning })));
}

function documentName(d: TravelDocument): string {
  if (d.kind === "passport") return "passport";
  if (d.kind === "visa") return d.country ? `${countryName(d.country)} visa` : "visa";
  return `“${d.title}”`;
}

// The warning as the app and its reminders word it: whose document, which,
// when it runs out, and how that bears on the trip. Never the number.
export function warningText({ person, warning }: PersonWarning, today: string): string {
  const whose = person.own ? "Your" : `${person.email ?? "A fellow traveler"}’s`;
  const { document: d, when, daysAfterTrip } = warning;
  const date = formatDate(d.expires, "en-GB", { weekday: undefined, year: "numeric" });
  if (when === "before") {
    return d.expires < today
      ? `${whose} ${documentName(d)} expired on ${date}.`
      : `${whose} ${documentName(d)} expires on ${date}, before this trip ends.`;
  }
  const months = Math.floor(daysAfterTrip / 30.44);
  const after = daysAfterTrip < 31 ? `${daysAfterTrip} day${daysAfterTrip === 1 ? "" : "s"}` : `${months} month${months === 1 ? "" : "s"}`;
  return `${whose} ${documentName(d)} expires on ${date}, ${after} after this trip ends; many countries require six months’ validity.`;
}
