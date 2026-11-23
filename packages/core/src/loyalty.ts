import { maxFoundLoyalty, type FoundLoyalty, type ProfileEntry, type TravelProfile } from "./schema";

// A loyalty program at a glance. An imported program is a list of labeled
// values in whatever order and wording its source used (travelProfile.ts
// keeps everything); this reads the few that matter, the account number,
// the balance and the status, by their usual labels, and finds the program
// a booking's provider belongs to, so the number is at hand at check-in.

export type LoyaltySummary = { title: string; account?: string; balance?: string; status?: string; nextStatus?: string };

// Labels in order of preference, lowercased; a nested label ("Account ›
// Number") is matched by its last part.
const labels: Record<Exclude<keyof LoyaltySummary, "title">, readonly string[]> = {
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
  return {
    title: entry.title,
    ...(account ? { account } : {}),
    ...(balance ? { balance: formatBalance(balance) } : {}),
    ...(status ? { status } : {}),
    ...(nextStatus ? { nextStatus } : {}),
  };
}

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

// One line for a booking: the program, the number and the status.
export function loyaltyLine(entry: ProfileEntry): string {
  const s = loyaltySummary(entry);
  return [s.title, s.account, s.status].filter(Boolean).join(" · ");
}

// A number as written, for telling two sightings of one membership apart:
// spaces, dashes and case do not count.
const plainNumber = (n: string) => n.replace(/[\s-]/g, "").toUpperCase();
// One program by its name as written (for "BA", which has no distinctive
// word), else by a distinctive word in common.
const sameProgram = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase() || [...nameWords(a)].some((w) => nameWords(b).has(w));
const sameMembership = (a: Pick<FoundLoyalty, "program" | "number">, b: Pick<FoundLoyalty, "program" | "number">) =>
  plainNumber(a.number) === plainNumber(b.number) && sameProgram(a.program, b.program);

// The found list with one more sighting: one already there is refreshed
// (moved to the end, with what the new email adds), the oldest dropped when
// the list is full.
export function withFoundLoyalty(found: readonly FoundLoyalty[], seen: FoundLoyalty): FoundLoyalty[] {
  const before = found.find((f) => sameMembership(f, seen));
  // A balance keeps the subject of the email it came from.
  const withSource = (f: FoundLoyalty): FoundLoyalty => (f.balance && f.label && !f.balanceLabel ? { ...f, balanceLabel: f.label } : f);
  if (!before) return [...found, withSource(seen)].slice(-maxFoundLoyalty);
  // The newest balance wins, and apart from it the newest status: a
  // statement read late, or an email with neither, does not undo a newer one.
  const newerBalance = !!seen.balance && (!before.balanceAt || (!!seen.balanceAt && seen.balanceAt >= before.balanceAt));
  const source = withSource(newerBalance ? seen : before);
  const newerStatus = !!seen.status && (!before.statusAt || (!!seen.statusAt && seen.statusAt >= before.statusAt));
  const statusFrom = newerStatus || !before.status ? seen : before;
  const holder = seen.holder ?? before.holder;
  const { balance: _balance, balanceAt: _balanceAt, balanceLabel: _balanceLabel, holder: _holder, status: _status, statusAt: _statusAt, ...rest } = {
    ...before,
    ...seen,
  };
  const merged: FoundLoyalty = {
    ...rest,
    ...(holder ? { holder } : {}),
    ...(statusFrom.status ? { status: statusFrom.status } : {}),
    ...(statusFrom.status && statusFrom.statusAt ? { statusAt: statusFrom.statusAt } : {}),
    ...(source.balance ? { balance: source.balance } : {}),
    ...(source.balance && source.balanceAt ? { balanceAt: source.balanceAt } : {}),
    ...(source.balance && source.balanceLabel ? { balanceLabel: source.balanceLabel } : {}),
  };
  return [...found.filter((f) => f !== before), merged].slice(-maxFoundLoyalty);
}

// Whether a name on a membership could be the account's owner: they share
// a name of two or more letters ("MR J SMITH" and "Jane Smith"). With either
// unknown, it could.
export function couldBeOwner(holder: string | undefined, ownerName: string | undefined): boolean {
  if (!holder || !ownerName) return true;
  const titles = new Set(["mr", "mrs", "ms", "miss", "mx", "dr"]);
  const names = (s: string) => (s.toLowerCase().match(/\p{L}{2,}/gu) ?? []).filter((w) => !titles.has(w));
  const owner = new Set(names(ownerName));
  return names(holder).some((w) => owner.has(w));
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

// Every program on a profile: what TripIt imported, then what emails showed
// that it did not have (by number). A statement newer than the TripIt upload
// brings its balance and status to the imported program it matches, ahead
// of the imported ones, which the table reads first.
export function allLoyalty(profile: Pick<TravelProfile, "loyalty" | "foundLoyalty" | "importedAt">): ProfileEntry[] {
  const found = profile.foundLoyalty ?? [];
  // One membership: the same number in the same program (sameMembership).
  const matching = (entry: ProfileEntry) => {
    const account = loyaltySummary(entry).account;
    return account ? (f: FoundLoyalty) => sameMembership(f, { program: entry.title, number: account }) : () => false;
  };
  // Newer than the TripIt upload, so it has the last word (no upload: it has).
  const afterUpload = (at: string | undefined) => !!at && (!profile.importedAt || at > profile.importedAt);
  const imported = profile.loyalty.map((entry) => {
    const statement = found.find(matching(entry));
    const balance = statement?.balance && afterUpload(statement.balanceAt) ? statement.balance : undefined;
    const status = statement?.status && afterUpload(statement.statusAt) ? statement.status : undefined;
    if (!statement || (!balance && !status)) return entry;
    // Under the labels the table reads first, so the email's win.
    return {
      ...entry,
      fields: [
        ...(balance ? [{ label: "Balance", value: balance }] : []),
        ...(status ? [{ label: "Elite status", value: status }] : []),
        ...entry.fields,
        ...(balance ? [{ label: "Balance from email", value: statement.balanceLabel ?? statement.label ?? "A statement" }] : []),
      ],
    };
  });
  const shown = (f: FoundLoyalty) => profile.loyalty.some((entry) => matching(entry)(f));
  return [...imported, ...found.filter((f) => !shown(f)).map(foundLoyaltyEntry)];
}
