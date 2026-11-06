import type { ProfileEntry, ProfileField } from "./schema";

// The traveler's own details in a TripIt export: its profile (documents
// such as passports), its loyalty programs, and the people named on its
// reservations. TripIt's JSON is converted from XML and its profile shapes
// are not documented, so nothing here relies on exact field names: every
// value is kept, labeled by where it was found, and only the titles are
// guessed from the usual names.

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

// A list of one often arrives as a bare object.
function list(value: unknown): Obj[] {
  if (Array.isArray(value)) return value.filter(isObj);
  return isObj(value) ? [value] : [];
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

// "passport_number" → "Passport number"; "ExpirationDate" → "Expiration date".
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

// Firestore holds a profile in one document (1 MB): bounds that no real
// profile comes near, so a hostile file cannot fill it.
const maxEntries = 200;
const maxFields = 200;
const maxValue = 2000;

const clipValue = (value: string) => (value.length > maxValue ? `${value.slice(0, maxValue - 1)}…` : value);

// Every value under `value`, labeled by its path ("Address › City"). Lists
// of plain values are joined; lists of objects number their items.
export function flatten(value: unknown, prefix = ""): ProfileField[] {
  const out: ProfileField[] = [];
  const walk = (v: unknown, label: string) => {
    if (out.length >= maxFields) return;
    const s = scalar(v);
    if (s !== undefined) {
      if (label) out.push({ label, value: clipValue(s) });
      return;
    }
    if (Array.isArray(v)) {
      const plain = v.map(scalar);
      if (plain.every((p) => p !== undefined)) {
        if (plain.length && label) out.push({ label, value: clipValue(plain.join(", ")) });
        return;
      }
      v.forEach((item, i) => walk(item, v.length > 1 ? `${label} ${i + 1}` : label));
      return;
    }
    if (isObj(v)) for (const [k, inner] of Object.entries(v)) walk(inner, label ? `${label} › ${humanize(k)}` : humanize(k));
  };
  walk(value, prefix);
  return out;
}

const pick = (o: Obj, keys: string[]) => {
  for (const k of keys) {
    const v = scalar(o[k]);
    if (v) return v;
  }
  return undefined;
};

function personName(o: Obj): string | undefined {
  const full = [scalar(o.first_name), scalar(o.middle_name), scalar(o.last_name)].filter(Boolean).join(" ");
  return full || pick(o, ["name", "display_name", "full_name"]);
}

// TripIt often wraps a list in an object with one key ({ LoyaltyProgram: [...] }).
function unwrap(value: unknown): Obj[] {
  return list(value).flatMap((o) => {
    const keys = Object.keys(o);
    if (keys.length === 1) {
      const inner = o[keys[0]!];
      if (Array.isArray(inner) || isObj(inner)) {
        const items = list(inner);
        if (items.length && items.every((i) => Object.values(i).some((v) => scalar(v) !== undefined))) return items;
      }
    }
    return [o];
  });
}

// A program's transaction log (every flight that earned points) is history,
// not the account; `error_message` is TripIt's own fetch status.
const programNoise = new Set(["Activity", "error_message"]);

const without = (o: Obj, drop: ReadonlySet<string>): Obj => Object.fromEntries(Object.entries(o).filter(([k]) => !drop.has(k)));

export function loyaltyEntries(value: unknown): ProfileEntry[] {
  return unwrap(value)
    .slice(0, maxEntries)
    .map((o, i) => ({
      title: pick(o, ["name", "program_name", "display_name", "supplier_name", "vendor", "program"]) ?? `Loyalty program ${i + 1}`,
      fields: flatten(without(o, programNoise)),
    }))
    .filter((e) => e.fields.length);
}

// TripIt's own export writes the profile as a list of templates, each named
// by `template_name`: TravelDocumentPassport, TravelAccountAir (a frequent
// flyer account), TravelAccountCar, UserProfilePublic. These are sorted into
// documents, loyalty programs and the profile's own entry; a profile without
// template names takes the generic reading (profileEntries).
type Templated = { documents: ProfileEntry[]; accounts: ProfileEntry[]; own: Obj };

const templateName = (o: Obj) => scalar(o.template_name);

export function templatedEntries(profiles: readonly Obj[]): Templated {
  const out: Templated = { documents: [], accounts: [], own: {} };
  for (const profile of profiles) {
    const template = templateName(profile);
    if (!template) continue;
    const rest = without(profile, new Set(["template_name"]));
    if (template.startsWith("TravelAccount")) {
      const title = pick(rest, ["name", "program_name", "display_name"]);
      const fields = flatten(title ? without(rest, new Set(["name"])) : rest);
      if (fields.length) out.accounts.push({ title: title ?? humanize(template), fields });
    } else if (template.startsWith("UserProfile")) {
      for (const [k, v] of Object.entries(rest)) if (!/url$/i.test(k) && scalar(v) !== undefined) out.own[k] = v;
    } else {
      const kind = humanize(template.replace(/^TravelDocument/, "")) || "Travel document";
      const who = personName(rest);
      const fields = flatten(rest);
      if (fields.length) out.documents.push({ title: who ? `${kind}: ${who}` : kind, fields });
    }
  }
  return out;
}

const accountNumber = (entry: ProfileEntry) => entry.fields.find((f) => /account number|member(ship)? number|^number$/i.test(f.label))?.value.replace(/\s+/g, "");

// A profile account is the same account as a listed program when the
// program has the same name and the same number, or one of them gives no
// number; two accounts in one program (a partner's) stay apart.
const sameAccount = (program: ProfileEntry, account: ProfileEntry) => {
  if (program.title.toLowerCase() !== account.title.toLowerCase()) return false;
  const a = accountNumber(program);
  const b = accountNumber(account);
  return !a || !b || a === b;
};

// Loyalty accounts the profile names that the programs list already has
// add their missing details to it; the rest stand alone.
export function mergeAccounts(programs: ProfileEntry[], accounts: readonly ProfileEntry[]): ProfileEntry[] {
  const merged = programs.map((p) => ({ ...p, fields: [...p.fields] }));
  for (const account of accounts) {
    const existing = merged.find((p) => sameAccount(p, account));
    if (!existing) {
      merged.push(account);
      continue;
    }
    for (const field of account.fields) {
      if (!existing.fields.some((f) => f.label === field.label) && existing.fields.length < maxFields) existing.fields.push(field);
    }
  }
  return merged.slice(0, maxEntries);
}

// The traveler's own details at the top of an export (name, home airport,
// home location, the account's emails), as one entry.
const ownKeys = ["first_name", "middle_name", "last_name", "home_airport_code", "home_location", "country_code", "screen_name", "company"];

export function ownEntry(root: Obj, extra: Obj = {}): ProfileEntry | undefined {
  const own: Obj = {};
  // The export's root names the account holder; the public profile template
  // repeats the name, and is all an export without root fields has.
  const name = personName(root) ?? personName(extra);
  if (name) own.name = name;
  const nameParts = new Set(["first_name", "middle_name", "last_name", "full_name"]);
  for (const k of ownKeys) if (!nameParts.has(k) && root[k] !== undefined) own[k] = root[k];
  for (const [k, v] of Object.entries(extra)) if (!(k in own) && !nameParts.has(k)) own[k] = v;
  const emails = list(root.EmailAddresses)
    .map((e) => scalar(e.email_address))
    .filter((e): e is string => e !== undefined);
  if (emails.length) own.emails = emails;
  const fields = flatten(own);
  return fields.length ? { title: name ?? "Profile", fields } : undefined;
}

// A profile's own values make one entry; each nested record (a passport, a
// visa, an address) makes its own, titled by what it is.
export function profileEntries(value: unknown): ProfileEntry[] {
  const entries: ProfileEntry[] = [];
  list(value).forEach((profile, n) => {
    const own: Obj = {};
    for (const [key, inner] of Object.entries(profile)) {
      if (scalar(inner) !== undefined || (Array.isArray(inner) && inner.every((v) => scalar(v) !== undefined))) {
        own[key] = inner;
        continue;
      }
      list(inner).forEach((item, i, all) => {
        const kind = humanize(key);
        const what = pick(item, ["type", "document_type", "name", "display_name"]);
        entries.push({ title: what ? `${kind}: ${what}` : all.length > 1 ? `${kind} ${i + 1}` : kind, fields: flatten(item) });
      });
    }
    const fields = flatten(own);
    if (fields.length) entries.unshift({ title: personName(profile) ?? (n ? `Profile ${n + 1}` : "Profile"), fields });
  });
  return entries.filter((e) => e.fields.length).slice(0, maxEntries);
}

const travelerKeys = ["Traveler", "Guest", "Driver", "ReservationHolder", "Passenger"];

// Everyone named on a reservation (and on each flight leg), once each by
// name, with every detail any reservation gave for them.
export function travelerEntries(trips: unknown, unfiled: unknown): ProfileEntry[] {
  const byName = new Map<string, ProfileEntry>();
  const visit = (o: Obj) => {
    for (const key of travelerKeys) {
      for (const person of list(o[key])) {
        const name = personName(person);
        if (!name) continue;
        const id = name.toLowerCase();
        const entry = byName.get(id) ?? { title: name, fields: [] };
        for (const field of flatten(person)) {
          if (!entry.fields.some((f) => f.label === field.label && f.value === field.value) && entry.fields.length < maxFields) {
            entry.fields.push(field);
          }
        }
        if (byName.size < maxEntries || byName.has(id)) byName.set(id, entry);
      }
    }
    for (const segment of list(o.Segment)) visit(segment);
  };
  for (const trip of list(trips)) for (const object of list(trip.Objects)) visit(object);
  for (const item of list(unfiled)) {
    if ("Objects" in item) for (const object of list(item.Objects)) visit(object);
    else visit(item);
  }
  return [...byName.values()];
}

export type ImportedProfile = {
  travelers: ProfileEntry[];
  loyalty: ProfileEntry[];
  documents: ProfileEntry[];
  // Some of it did not fit in one stored profile and was left out.
  truncated?: boolean;
};

// The whole profile is one Firestore document (1 MB, names and overhead
// included). This budget, counting UTF-8 bytes of every title, label and
// value plus a margin per item, keeps well inside it.
export const profileBudgetBytes = 700_000;
const itemOverhead = 32;
const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length + itemOverhead;

// Keeps entries in order (documents first, then loyalty, then travelers)
// while they fit; an entry that would not fit is left out whole.
export function fitProfile(profile: ImportedProfile, budget = profileBudgetBytes): ImportedProfile {
  let left = budget;
  let truncated = profile.truncated ?? false;
  const take = (entries: ProfileEntry[]) =>
    entries.filter((entry) => {
      const size = bytes(entry.title) + entry.fields.reduce((n, f) => n + bytes(f.label) + bytes(f.value), 0);
      if (size > left) {
        truncated = true;
        return false;
      }
      left -= size;
      return true;
    });
  const documents = take(profile.documents);
  const loyalty = take(profile.loyalty);
  const travelers = take(profile.travelers);
  return { travelers, loyalty, documents, ...(truncated ? { truncated } : {}) };
}

// The profile parts of a TripIt export; empty lists for what it lacks.
export function extractTripItProfile(json: unknown): ImportedProfile {
  if (!isObj(json)) return { travelers: [], loyalty: [], documents: [] };
  const profiles = list(json.TravelerProfile ?? json.Profile);
  const templated = templatedEntries(profiles.filter((p) => templateName(p)));
  const generic = profileEntries(profiles.filter((p) => !templateName(p)));
  const own = ownEntry(json, templated.own);
  return fitProfile({
    travelers: travelerEntries(json.Trips, json.UnfiledItems),
    loyalty: mergeAccounts(loyaltyEntries(json.LoyaltyPrograms ?? json.PointsPrograms ?? json.PointsProgram), templated.accounts),
    documents: [...(own ? [own] : []), ...generic, ...templated.documents],
  });
}

export const isEmptyProfile = (p: ImportedProfile) => !p.travelers.length && !p.loyalty.length && !p.documents.length;
