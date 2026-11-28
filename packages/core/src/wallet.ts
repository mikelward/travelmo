import { parseDocumentDate } from "./documents";
import { loyaltySummary, personLabel } from "./loyalty";
import { isCancelled } from "./trips";
import type { ProfileEntry, ProfileField, Segment, Trip } from "./schema";

export type DocumentInputType = "passport" | "visa" | "share_code" | "ktn" | "id" | "insurance" | "other";

export type DocumentInput = {
  type: DocumentInputType;
  title: string;
  country?: string;
  number?: string;
  expires?: string;
  issued?: string;
  notes?: string;
};

export type LoyaltyInput = {
  program: string;
  number?: string;
  status?: string;
  balance?: string;
  person?: string;
};

export type UpcomingFlight = {
  tripId: string;
  tripTitle: string;
  segment: Segment;
  departureMs: number;
};

const documentTypeLabels: Record<DocumentInputType, string> = {
  passport: "Passport",
  visa: "Visa",
  share_code: "UK share code",
  ktn: "Known Traveler Number",
  id: "National ID",
  insurance: "Travel insurance",
  other: "Other",
};

export function defaultDocumentTitle(type: DocumentInputType, country?: string): string {
  const c = country?.trim();
  const label = documentTypeLabels[type];
  return c ? `${c} ${label}` : label;
}

const lastPart = (label: string) => label.split("›").at(-1)!.trim().toLowerCase();
const isDocTypeLabel = (l: string) => /^(document )?type$/.test(l);
const isNationalityLabel = (l: string) => /\b(nationality|citizenship)\b/.test(l);
const isCountryLabel = (l: string) => /\bcountry\b/.test(l) && !/\bbirth/.test(l) && !isNationalityLabel(l);
const isNumberLabel = (l: string) => /\b(number|no\.?|id)\b/.test(l) && !/\btype\b/.test(l);
const isExpiryLabel = (l: string) => /expir|valid (until|to|through)|valid thru/.test(l);
const isIssuedLabel = (l: string) => /issue/.test(l);
const isNotesLabel = (l: string) => /\bnotes?\b/.test(l);

const managedLoyaltyLabels = new Set([
  "account number",
  "membership number",
  "member number",
  "account no",
  "membership no",
  "account",
  "number",
  "balance",
  "points balance",
  "miles balance",
  "point balance",
  "points",
  "miles",
  "elite status",
  "status",
  "tier",
  "level",
  "elite level",
]);

function isManagedDocField(label: string, type: DocumentInputType): boolean {
  const l = lastPart(label);
  return (
    isDocTypeLabel(l) ||
    isCountryLabel(l) ||
    (type === "passport" && isNationalityLabel(l)) ||
    isNumberLabel(l) ||
    isExpiryLabel(l) ||
    isIssuedLabel(l) ||
    isNotesLabel(l)
  );
}

function isManagedLoyaltyField(label: string): boolean {
  if (label === personLabel) return true;
  if (label.includes("›")) return false;
  return managedLoyaltyLabels.has(lastPart(label));
}

export function buildDocumentEntry(input: DocumentInput, existing?: ProfileEntry): ProfileEntry {
  const country = input.country?.trim();
  const title = input.title.trim() || defaultDocumentTitle(input.type, country);
  const fields: ProfileField[] = [{ label: "Document type", value: documentTypeLabels[input.type] }];
  if (country) {
    fields.push({ label: input.type === "passport" ? "Nationality" : "Country", value: country });
  }
  const number = input.number?.trim();
  if (number) fields.push({ label: "Number", value: number });
  const expires = input.expires?.trim();
  if (expires) fields.push({ label: "Expiration date", value: expires });
  const issued = input.issued?.trim();
  if (issued) fields.push({ label: "Issue date", value: issued });
  const notes = input.notes?.trim();
  if (notes) fields.push({ label: "Notes", value: notes });
  if (existing) {
    for (const f of existing.fields) {
      if (!isManagedDocField(f.label, input.type)) fields.push(f);
    }
  }
  return { title, fields, manual: true };
}

function findField(entry: ProfileEntry, test: (label: string) => boolean): string | undefined {
  return entry.fields.find((f) => test(lastPart(f.label)) && f.value.trim())?.value.trim();
}

export function parseDocumentEntry(entry: ProfileEntry): DocumentInput {
  const explicitTypes = entry.fields.filter((f) => isDocTypeLabel(lastPart(f.label)) && f.value.trim()).map((f) => f.value);
  const typeText = (explicitTypes.length > 0 ? explicitTypes.join(" ") : entry.title).toLowerCase();

  let type: DocumentInputType = "other";
  if (/\b(e-?)?passports?\b/.test(typeText)) type = "passport";
  else if (/\bshare\s*codes?\b/.test(typeText)) type = "share_code";
  else if (/\b(e-?)?visas?\b/.test(typeText)) type = "visa";
  else if (/\b(known traveler|ktn|global entry|tsa pre|nexus|sentri)\b/.test(typeText)) type = "ktn";
  else if (/\b(national id|id card|identity|driver'?s? licen[cs]e)\b/.test(typeText)) type = "id";
  else if (/\binsurance\b/.test(typeText)) type = "insurance";

  // Prefer nationality only for passports; visas and other documents use their admission/issuing country.
  const country =
    type === "passport"
      ? (findField(entry, isNationalityLabel) ?? findField(entry, isCountryLabel))
      : findField(entry, isCountryLabel);
  const number = findField(entry, isNumberLabel);
  const rawExpires = findField(entry, isExpiryLabel);
  const expires = rawExpires ? (parseDocumentDate(rawExpires) ?? rawExpires) : undefined;
  const rawIssued = findField(entry, isIssuedLabel);
  const issued = rawIssued ? (parseDocumentDate(rawIssued) ?? rawIssued) : undefined;
  const notes = findField(entry, isNotesLabel);

  return {
    type,
    title: entry.title,
    ...(country ? { country } : {}),
    ...(number ? { number } : {}),
    ...(expires ? { expires } : {}),
    ...(issued ? { issued } : {}),
    ...(notes ? { notes } : {}),
  };
}

const loyaltyAccountLabels = ["account number", "membership number", "member number", "account no", "membership no", "account", "number"];
const loyaltyBalanceLabels = ["balance", "points balance", "miles balance", "point balance", "points", "miles"];
const loyaltyStatusLabels = ["elite status", "status", "tier", "level", "elite level"];

function sourceFieldIndex(fields: readonly ProfileField[], wanted: readonly string[]): number {
  for (const nested of [false, true]) {
    for (const want of wanted) {
      const idx = fields.findIndex((f) => f.label.includes("›") === nested && lastPart(f.label) === want && f.value.trim());
      if (idx >= 0) return idx;
    }
  }
  return -1;
}

export function buildLoyaltyEntry(input: LoyaltyInput, existing?: ProfileEntry, updatedAt?: string): ProfileEntry {
  const fields: ProfileField[] = [];
  const number = input.number?.trim();
  if (number) fields.push({ label: "Account number", value: number });
  const status = input.status?.trim();
  if (status) fields.push({ label: "Status", value: status });
  const balance = input.balance?.trim();
  if (balance) fields.push({ label: "Balance", value: balance });
  const person = input.person?.trim();
  if (person) fields.push({ label: personLabel, value: person });
  if (existing) {
    const sourcedIndices = new Set<number>([
      sourceFieldIndex(existing.fields, loyaltyAccountLabels),
      sourceFieldIndex(existing.fields, loyaltyBalanceLabels),
      sourceFieldIndex(existing.fields, loyaltyStatusLabels),
    ]);
    existing.fields.forEach((f, idx) => {
      if (!isManagedLoyaltyField(f.label) && !sourcedIndices.has(idx)) fields.push(f);
    });
  }
  const stamp = updatedAt ?? existing?.updatedAt;
  return { title: input.program.trim(), fields, ...(stamp ? { updatedAt: stamp } : {}), manual: true };
}

export function parseLoyaltyEntry(entry: ProfileEntry): LoyaltyInput {
  const s = loyaltySummary(entry);
  return {
    program: s.title,
    ...(s.account ? { number: s.account } : {}),
    ...(s.status ? { status: s.status } : {}),
    ...(s.balance ? { balance: s.balance } : {}),
    ...(s.person ? { person: s.person } : {}),
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function numberKey(entry: ProfileEntry): string | undefined {
  const num = findField(entry, (l) => /\b(number|no\.?|account)\b/.test(l));
  return num ? `${norm(entry.title)}|${norm(num)}` : undefined;
}

function exactKey(entry: ProfileEntry): string {
  const fields = entry.fields.map((f) => `${norm(f.label)}=${norm(f.value)}`).sort().join("\0");
  return `${norm(entry.title)}\0${fields}`;
}

// Merges imported TripIt entries with existing Wallet entries so a later TripIt
// upload adds or updates imported entries without erasing manually added ones.
// Existing entries are always preserved; entries with a number match by
// (title, number), while numberless entries only match when identical.
export function mergeProfileEntries(
  existing: readonly ProfileEntry[],
  imported: readonly ProfileEntry[],
): ProfileEntry[] {
  const out: ProfileEntry[] = [...existing];
  const indexByNum = new Map<string, number>();
  const indexByExact = new Map<string, number>();
  out.forEach((e, i) => {
    const nk = numberKey(e);
    if (nk && !indexByNum.has(nk)) indexByNum.set(nk, i);
    const ek = exactKey(e);
    if (!indexByExact.has(ek)) indexByExact.set(ek, i);
  });
  for (const e of imported) {
    const nk = numberKey(e);
    if (nk) {
      const idx = indexByNum.get(nk);
      if (idx !== undefined) {
        if (!out[idx]!.manual) out[idx] = e;
      } else {
        indexByNum.set(nk, out.length);
        out.push(e);
      }
    } else {
      const ek = exactKey(e);
      const idx = indexByExact.get(ek);
      if (idx !== undefined) {
        if (!out[idx]!.manual) out[idx] = e;
      } else {
        indexByExact.set(ek, out.length);
        out.push(e);
      }
    }
  }
  return out;
}

const HOUR_MS = 60 * 60 * 1000;

// Non-cancelled flights departing within [now - 3h, now + windowHours], sorted
// earliest first, for the Wallet's boarding pass shortcut.
export function upcomingBoardingFlights(
  trips: readonly Trip[],
  segmentsByTrip: ReadonlyMap<string, readonly Segment[]>,
  nowMs: number,
  windowHours = 48,
): UpcomingFlight[] {
  const minMs = nowMs - 3 * HOUR_MS;
  const maxMs = nowMs + windowHours * HOUR_MS;
  const out: UpcomingFlight[] = [];
  for (const trip of trips) {
    if (trip.cancelledAt) continue;
    const segments = segmentsByTrip.get(trip.id) ?? [];
    for (const segment of segments) {
      if (segment.type !== "flight" || isCancelled(segment)) continue;
      const departureMs = Date.parse(segment.start);
      if (Number.isNaN(departureMs)) continue;
      if (departureMs >= minMs && departureMs <= maxMs) {
        out.push({ tripId: trip.id, tripTitle: trip.title, segment, departureMs });
      }
    }
  }
  return out.sort((a, b) => a.departureMs - b.departureMs);
}
