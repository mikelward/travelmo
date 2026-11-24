import type { ImportOutcome } from "./importer";

// How the email reader does with each sender, across everyone, to tune its
// rules by: one document per sender domain (paths.senderStats) holding
// counts alone, never a user, an email, its subject or any of its text.
// Each email read adds one to `read` (it reached the model) or `skipped`
// (the pre-filter left it out), and one to what came of it; Import anyway
// adds to `importAnyway`, and to `importAnywayImported` when that made a
// booking: an email the reader turned down that a person said was one.
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
