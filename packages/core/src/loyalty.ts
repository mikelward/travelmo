import { findPerson, guessMe, type Person } from "./travelers";
import { foundLoyaltyBudgetBytes, maxFoundLoyalty, maxLoyaltyPeople, type FoundLoyalty, type LoyaltyPerson, type ProfileEntry, type TravelProfile } from "./schema";

// A loyalty program at a glance. An imported program is a list of labeled
// values in whatever order and wording its source used (travelProfile.ts
// keeps everything); this reads the few that matter, the account number,
// the balance and the status, by their usual labels, and finds the program
// a booking's provider belongs to, so the number is at hand at check-in.

// `person`: whose it is, when not the owner's.
export type LoyaltySummary = { title: string; account?: string; balance?: string; status?: string; nextStatus?: string; person?: string };

// Labels in order of preference, lowercased; a nested label ("Account ›
// Number") is matched by its last part.
const labels: Record<Exclude<keyof LoyaltySummary, "title" | "person">, readonly string[]> = {
  account: ["account number", "membership number", "member number", "account no", "membership no", "account", "number"],
  balance: ["balance", "points balance", "miles balance", "point balance", "points", "miles"],
  status: ["elite status", "status", "tier", "level", "elite level"],
  nextStatus: ["elite next status", "next status", "next tier", "next level"],
};

const lastPart = (label: string) => label.split("›").at(-1)!.trim().toLowerCase();
const isNested = (label: string) => label.includes("›");

// The program's own value before a nested one (a sub-account's balance is
// not the program's), whatever order the import listed them in.
function field(entry: ProfileEntry, wanted: readonly string[]): string | undefined {
  for (const nested of [false, true]) {
    for (const want of wanted) {
      const found = entry.fields.find((f) => isNested(f.label) === nested && lastPart(f.label) === want && f.value.trim());
      if (found) return found.value.trim();
    }
  }
  return undefined;
}

// "12000" → "12,000"; anything that is not a plain number stays as written.
export const formatBalance = (value: string) => (/^\d{1,15}$/.test(value) ? Number(value).toLocaleString("en-US") : value);

export function loyaltySummary(entry: ProfileEntry): LoyaltySummary {
  const account = field(entry, labels.account);
  const balance = field(entry, labels.balance);
  const status = field(entry, labels.status);
  const nextStatus = field(entry, labels.nextStatus);
  const person = entry.fields.find((f) => f.label === personLabel)?.value;
  return {
    title: entry.title,
    ...(account ? { account } : {}),
    ...(balance ? { balance: formatBalance(balance) } : {}),
    ...(status ? { status } : {}),
    ...(nextStatus ? { nextStatus } : {}),
    ...(person ? { person } : {}),
  };
}

// The field allLoyalty marks someone else's membership with.
export const personLabel = "Belongs to";

// Words that name what a program is, not whose it is, and the parts of a
// web address ("example-air.com") that are not the brand.
const generic = new Set([
  "air",
  "airline",
  "airlines",
  "airways",
  "and",
  "award",
  "awards",
  "biz",
  "bonus",
  "card",
  "club",
  "com",
  "flier",
  "flyer",
  "frequent",
  "group",
  "honors",
  "hotel",
  "hotels",
  "http",
  "https",
  "info",
  "inn",
  "international",
  "loyalty",
  "member",
  "members",
  "membership",
  "miles",
  "net",
  "number",
  "org",
  "plus",
  "points",
  "privilege",
  "privileges",
  "program",
  "programme",
  "reward",
  "rewards",
  "resorts",
  "the",
  "travel",
  "www",
]);

// The distinctive words of a name: three or more letters or digits, not
// generic. "Example Air Miles" → example; "Sample Hotels Honors" → sample.
export function nameWords(name: string): Set<string> {
  const words = name.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return new Set(words.filter((w) => !generic.has(w)));
}

// The programs a booking's provider belongs to: those sharing a distinctive
// word with it. A provider with no distinctive word matches nothing.
export function programsFor(provider: string | undefined, programs: readonly ProfileEntry[]): ProfileEntry[] {
  if (!provider) return [];
  const words = nameWords(provider);
  if (!words.size) return [];
  return programs.filter((p) => [...nameWords(p.title)].some((w) => words.has(w)));
}

// One line for a booking: the program, the number, the status and, when
// not the owner's, whose it is.
export function loyaltyLine(entry: ProfileEntry): string {
  const s = loyaltySummary(entry);
  return [s.title, s.account, s.status, s.person].filter(Boolean).join(" · ");
}

// A number as written, for telling two sightings of one membership apart:
// spaces, dashes, case and zeros padding the digits ("EK00557710580" is
// "EK557710580") do not count.
const plainNumber = (n: string) =>
  n
    .replace(/[\s-]/g, "")
    .toUpperCase()
    .replace(/^([A-Z]*)0+(?=\d)/, "$1");
// One program by its name as written (for "BA", which has no distinctive
// word), else by a distinctive word in common. A name with no distinctive
// word ("Privilege Club") could be any program's.
const sameProgram = (a: string, b: string) => {
  const [x, y] = [nameWords(a), nameWords(b)];
  return a.trim().toLowerCase() === b.trim().toLowerCase() || !x.size || !y.size || [...x].some((w) => y.has(w));
};
// One number as written two ways (plainNumber).
export const sameNumber = (a: string, b: string) => plainNumber(a) === plainNumber(b);
// One membership: the same number in the same program.
export const sameMembership = (a: Pick<FoundLoyalty, "program" | "number">, b: Pick<FoundLoyalty, "program" | "number">) =>
  sameNumber(a.number, b.number) && sameProgram(a.program, b.program);

const encoder = new TextEncoder();
// About what an entry takes in the stored document: its UTF-8 JSON, plus a
// margin for Firestore's own encoding.
const entryBytes = (f: FoundLoyalty) => encoder.encode(JSON.stringify(f)).length + 32;

// Whether the list has no room for one more entry (maxFoundLoyalty,
// foundLoyaltyBudgetBytes).
function full(found: readonly FoundLoyalty[], next: FoundLoyalty): boolean {
  if (found.length >= maxFoundLoyalty) return true;
  return found.reduce((n, f) => n + entryBytes(f), entryBytes(next)) > foundLoyaltyBudgetBytes;
}

// The found list with one more sighting: one already there is refreshed
// (moved to the end, with what the new email adds). A new one is refused
// once the list is full (by count or by size, bounds nobody reaches); none
// is ever dropped to make room.
export function withFoundLoyalty(found: readonly FoundLoyalty[], seen: FoundLoyalty): FoundLoyalty[] {
  const before = found.find((f) => sameMembership(f, seen));
  // A balance keeps the subject of the email it came from.
  const withSource = (f: FoundLoyalty): FoundLoyalty => (f.balance && f.label && !f.balanceLabel ? { ...f, balanceLabel: f.label } : f);
  if (!before) return full(found, withSource(seen)) ? [...found] : [...found, withSource(seen)];
  // The newest balance wins, and apart from it the newest status: a
  // statement read late, or an email with neither, does not undo a newer one.
  const newerBalance = !!seen.balance && (!before.balanceAt || (!!seen.balanceAt && seen.balanceAt >= before.balanceAt));
  const source = withSource(newerBalance ? seen : before);
  const newerStatus = !!seen.status && (!before.statusAt || (!!seen.statusAt && seen.statusAt >= before.statusAt));
  const statusFrom = newerStatus || !before.status ? seen : before;
  const holder = seen.holder ?? before.holder;
  // Whose it is: as first seen; the owner's word is in loyaltyPeople.
  const person = before.person;
  const { balance: _balance, balanceAt: _balanceAt, balanceLabel: _balanceLabel, holder: _holder, person: _person, status: _status, statusAt: _statusAt, ...rest } = {
    ...before,
    ...seen,
  };
  // A name that says which program ("QATAR AIRWAYS") is kept over one that
  // could be any's ("Privilege Club"), so bookings still find it.
  const program = nameWords(seen.program).size || !nameWords(before.program).size ? seen.program : before.program;
  const merged: FoundLoyalty = {
    ...rest,
    program,
    ...(holder ? { holder } : {}),
    ...(person ? { person } : {}),
    ...(statusFrom.status ? { status: statusFrom.status } : {}),
    ...(statusFrom.status && statusFrom.statusAt ? { statusAt: statusFrom.statusAt } : {}),
    ...(source.balance ? { balance: source.balance } : {}),
    ...(source.balance && source.balanceAt ? { balanceAt: source.balanceAt } : {}),
    ...(source.balance && source.balanceLabel ? { balanceLabel: source.balanceLabel } : {}),
  };
  return [...found.filter((f) => f !== before), merged];
}

// The found list with several sightings (withFoundLoyalty), and how many
// new ones were refused because it was full, for the caller to log.
export function withFoundLoyalties(found: readonly FoundLoyalty[], seen: readonly FoundLoyalty[]): { found: FoundLoyalty[]; refused: number } {
  let refused = 0;
  const next = seen.reduce<FoundLoyalty[]>((list, s) => {
    const next = withFoundLoyalty(list, s);
    if (next.length === list.length && !list.some((f) => sameMembership(f, s))) refused += 1;
    return next;
  }, [...found]);
  return { found: next, refused };
}

// Whether a name on a membership could be the account's owner: they share
// a name of two or more letters ("MR J SMITH" and "Jane Smith"), and their
// first names agree, as the same name or an initial ("J"). Family who share
// a surname ("Jessica Ward" on "Mikel Ward"'s booking) are not the owner.
// With either name unknown, or only one name to go on, it could be.
export function couldBeOwner(holder: string | undefined, ownerName: string | undefined): boolean {
  if (!holder || !ownerName) return true;
  // In the order people say them ("SMITH/JANE MR" → jane smith), titles gone.
  const names = (s: string): string[] => (personName(s) ?? "").toLowerCase().match(/\p{L}+/gu) ?? [];
  const [held, owner] = [names(holder), names(ownerName)];
  if (!held.some((w) => w.length >= 2 && owner.includes(w))) return false;
  if (held.length < 2 || owner.length < 2) return true;
  const [first, ownerFirst] = [held[0]!, owner[0]!];
  if (first.length === 1 || ownerFirst.length === 1) return first[0] === ownerFirst[0];
  // The holder's first name among the owner's names (a middle name used as
  // the first one).
  return owner.includes(first);
}

// A member's name as an email gives it, as a person is called: without a
// title, and "MR ALEX SAMPLE" or an airline's "SAMPLE/ALEX MR" as "Alex
// Sample". Undefined when nothing is left.
export function personName(holder: string): string | undefined {
  const titles = /^(mr|mrs|ms|miss|mx|dr|mstr|master)\.?$/i;
  const [last, first] = holder.split("/", 2);
  const ordered = first !== undefined && first.trim() && last!.trim() ? `${first} ${last}` : holder;
  const words = ordered.trim().split(/\s+/).filter((w, _, all) => !(titles.test(w) && all.length > 1));
  const shouting = words.join(" ") === words.join(" ").toUpperCase();
  const name = words.map((w) => (shouting ? w.toLowerCase().replace(/(^|[-'])\p{L}/gu, (c) => c.toUpperCase()) : w)).join(" ").slice(0, 80).trim();
  return name || undefined;
}

// A found membership as the profile shows a program: labeled fields the
// loyalty table reads, and the email it came from.
export function foundLoyaltyEntry(found: FoundLoyalty): ProfileEntry {
  return {
    title: found.program,
    fields: [
      { label: "Account number", value: found.number },
      ...(found.balance ? [{ label: "Balance", value: found.balance }] : []),
      ...(found.status ? [{ label: "Status", value: found.status }] : []),
      ...(found.holder ? [{ label: "Name", value: found.holder }] : []),
      { label: "From email", value: found.label ?? "A booking email" },
    ],
  };
}

// Every program on a profile, the owner's before anyone else's: what TripIt
// imported, then what emails showed that it did not have (by number). A statement newer than the TripIt upload
// brings its balance and status to the imported program it matches, ahead
// of the imported ones, which the table reads first.
//
// `travelers`, the owner's people (SPEC "Travelers"), when known: a name
// that is one of theirs is shown as that person's name, so every spelling
// of someone ("Jessica Wilkes" merged into "Jessica Ward") is one person,
// and one of the owner's own ("Mikelbradlee Ward") is the owner's.
export type ResolvedLoyalty = {
  entry: ProfileEntry;
  /** Index in `profile.loyalty`, or `-1` when the row comes only from `foundLoyalty`. */
  savedIndex: number;
};

export function allLoyaltyWithSource(
  profile: Pick<TravelProfile, "loyalty" | "foundLoyalty" | "importedAt" | "loyaltyPeople">,
  travelers: readonly (Person & { bookings: number; direct: number })[] = [],
): ResolvedLoyalty[] {
  const found = profile.foundLoyalty ?? [];
  // Whose it is: as the owner said, else as the email named, else theirs.
  const people = profile.loyaltyPeople ?? [];
  const me = guessMe(travelers);
  const known = (name: string | undefined): string | undefined => {
    const person = name ? findPerson(travelers, name) : undefined;
    return person && person.id === me?.id ? undefined : (person?.name ?? name);
  };
  const reversedPeople = [...people].reverse();
  const withPerson = (entry: ProfileEntry, number: string | undefined, fromEmail?: FoundLoyalty): ProfileEntry => {
    const storedPerson = entry.fields.find((f) => f.label === personLabel)?.value;
    const baseFields = entry.fields.filter((f) => f.label !== personLabel);
    const said = number ? reversedPeople.find((p) => sameMembership(p, { program: entry.title, number })) : undefined;
    const person = known(said ? said.person : (fromEmail?.person ?? storedPerson));
    return person ? { ...entry, fields: [...baseFields, { label: personLabel, value: person }] } : { ...entry, fields: baseFields };
  };
  // Precompute each imported entry's account number once so matching against found entries doesn't re-parse summaries.
  const importedAccounts = profile.loyalty.map((entry, savedIndex) => ({ entry, savedIndex, account: loyaltySummary(entry).account }));
  const matchedFound = new Set<FoundLoyalty>();
  // Per-entry updatedAt (from a manual edit or the import that wrote this
  // entry) wins over the document-level importedAt so an unrelated later
  // upload does not age retained entries.
  const cutoffFor = (entry: ProfileEntry) => entry.updatedAt ?? profile.importedAt;
  const afterCutoff = (at: string | undefined, cutoff: string | undefined) => !!at && (!cutoff || at > cutoff);
  const imported: ResolvedLoyalty[] = importedAccounts.map(({ entry, savedIndex, account }) => {
    let statement: FoundLoyalty | undefined;
    if (account) {
      for (const f of found) {
        if (sameMembership(f, { program: entry.title, number: account })) {
          matchedFound.add(f);
          if (!statement) statement = f;
        }
      }
    }
    const cutoff = cutoffFor(entry);
    const balance = statement?.balance && afterCutoff(statement.balanceAt, cutoff) ? statement.balance : undefined;
    const status = statement?.status && afterCutoff(statement.statusAt, cutoff) ? statement.status : undefined;
    if (!statement || (!balance && !status)) return { entry: withPerson(entry, account, statement), savedIndex };
    // Under the labels the table reads first, so the email's win.
    return {
      entry: withPerson({
        ...entry,
        fields: [
          ...(balance ? [{ label: "Balance", value: balance }] : []),
          ...(status ? [{ label: "Elite status", value: status }] : []),
          ...entry.fields,
          ...(balance ? [{ label: "Balance from email", value: statement.balanceLabel ?? statement.label ?? "A statement" }] : []),
        ],
      }, account, statement),
      savedIndex,
    };
  });
  const all: ResolvedLoyalty[] = [
    ...imported,
    ...found.filter((f) => !matchedFound.has(f)).map((f) => ({ entry: withPerson(foundLoyaltyEntry(f), f.number, f), savedIndex: -1 })),
  ];
  // The owner's first, as a booking lists them.
  const mine: ResolvedLoyalty[] = [];
  const theirs: ResolvedLoyalty[] = [];
  for (const r of all) {
    if (loyaltySummary(r.entry).person !== undefined) theirs.push(r);
    else mine.push(r);
  }
  return [...mine, ...theirs];
}

export function allLoyalty(
  profile: Pick<TravelProfile, "loyalty" | "foundLoyalty" | "importedAt" | "loyaltyPeople">,
  travelers: readonly (Person & { bookings: number; direct: number })[] = [],
): ProfileEntry[] {
  return allLoyaltyWithSource(profile, travelers).map((r) => r.entry);
}

// The owner's word on whose a membership is, replacing any earlier word on
// it; `person` undefined says it is theirs. The oldest word goes when the
// list is full.
export function withLoyaltyPerson(people: readonly LoyaltyPerson[], membership: { program: string; number: string }, person: string | undefined): LoyaltyPerson[] {
  const name = person?.trim();
  const said: LoyaltyPerson = { program: membership.program, number: membership.number, ...(name ? { person: name } : {}) };
  return [...people.filter((p) => !sameMembership(p, membership)), said].slice(-maxLoyaltyPeople);
}

// The programs grouped by whose they are: the owner's first (person
// undefined), then each other person's, by name.
export function loyaltyByPerson(entries: readonly ProfileEntry[]): { person?: string; entries: ProfileEntry[] }[] {
  const groups = new Map<string, ProfileEntry[]>();
  for (const entry of entries) {
    const key = loyaltySummary(entry).person ?? "";
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([person, list]) => ({ ...(person ? { person } : {}), entries: list }));
}

// The email-extracted membership behind a unified loyalty entry, when one
// exists, so the UI can remove it directly from the program's row.
export function findFoundLoyalty(found: readonly FoundLoyalty[], entry: ProfileEntry): FoundLoyalty | undefined {
  const account = loyaltySummary(entry).account;
  if (!account) return undefined;
  return found.find((f) => sameMembership(f, { program: entry.title, number: account }));
}

