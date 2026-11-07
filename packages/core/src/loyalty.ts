import type { ProfileEntry } from "./schema";

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
