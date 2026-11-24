import type { ImportOutcome } from "./importer";

// How the email reader does with each sender, across everyone, to tune its
// rules by: one document per sender domain (paths.senderStats) holding
// counts alone, never a user, an email, its subject or any of its text.
// Each email read adds one to `read` (it reached the model) or `skipped`
// (the pre-filter left it out), and one to what came of it; Import anyway
// adds to `importAnyway`, and to `importAnywayImported` when that made a
// booking: an email the reader turned down that a person said was one.
// Refresh from email's reading again of a booked email adds to
// `refreshRead`, and to `refreshFailed` when the model fails on it, apart
// from the first readings.
// Only the parser writes them; the rules let no client read or write.

export type SenderCounts = Record<string, number>;

export function senderCounts(outcome: Exclude<ImportOutcome, "skipped">, importAnyway: boolean): SenderCounts {
  const counts: SenderCounts = outcome === "filtered" ? { skipped: 1 } : { read: 1, [outcomeField[outcome]]: 1 };
  if (importAnyway) {
    counts.importAnyway = 1;
    if (outcome === "imported") counts.importAnywayImported = 1;
  }
  return counts;
}

const outcomeField: Record<Exclude<ImportOutcome, "skipped" | "filtered">, string> = {
  imported: "imported",
  not_booking: "notBooking",
  failed: "failed",
  cancellation: "cancellation",
};

// One domain's counts, as stored.
export type SenderStats = { domain: string } & Partial<Record<"read" | "skipped" | "imported" | "notBooking" | "failed" | "cancellation" | "importAnyway" | "importAnywayImported" | "refreshRead" | "refreshFailed", number>>;

// The domains most worth a look, as lines to read: those where people made
// a booking of an email the reader turned down (Import anyway), then those
// whose emails the reader most often found no booking in or failed on, on
// a first reading or on Refresh from email's reading again.
export function senderReport(stats: readonly SenderStats[], limit = 50): string[] {
  const n = (s: SenderStats, field: keyof Omit<SenderStats, "domain">) => s[field] ?? 0;
  const rate = (misses: number, of: number) => (of ? misses / of : 0);
  const missed = (s: SenderStats) =>
    Math.max(rate(n(s, "notBooking") + n(s, "failed"), n(s, "read")), rate(n(s, "refreshFailed"), n(s, "refreshRead")));
  const readings = (s: SenderStats) => n(s, "read") + n(s, "refreshRead");
  const ranked = [...stats]
    .filter((s) => readings(s) > 0 || n(s, "importAnyway") > 0)
    .sort((a, b) => n(b, "importAnywayImported") - n(a, "importAnywayImported") || missed(b) - missed(a) || readings(b) - readings(a) || a.domain.localeCompare(b.domain));
  return ranked.slice(0, limit).map(
    (s) =>
      `${s.domain}: read ${n(s, "read")}, imported ${n(s, "imported")}, not a booking ${n(s, "notBooking")}, failed ${n(s, "failed")}, ` +
      `skipped ${n(s, "skipped")}, Import anyway ${n(s, "importAnyway")} (${n(s, "importAnywayImported")} became bookings), ` +
      `read again ${n(s, "refreshRead")} (${n(s, "refreshFailed")} failed)`,
  );
}
