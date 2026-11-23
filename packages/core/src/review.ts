import type { ParsedMessage } from "./schema";

/** What the review list is narrowed to; empty fields leave it unfiltered. */
export type ReviewSearch = { keyword: string; from: string; to: string };

/**
 * The processedAt bounds, as ISO instants, for a range of local calendar
 * days (`YYYY-MM-DD`, as a date input gives them): from the start of `from`
 * up to, not including, the start of the day after `to`.
 */
export function dayRange(from: string, to: string): { start?: string; end?: string } {
  const startOf = (day: string) => new Date(`${day}T00:00:00`);
  const range: { start?: string; end?: string } = {};
  if (from && !Number.isNaN(startOf(from).getTime())) range.start = startOf(from).toISOString();
  if (to && !Number.isNaN(startOf(to).getTime())) {
    const next = startOf(to);
    next.setDate(next.getDate() + 1);
    range.end = next.toISOString();
  }
  return range;
}

/** Whether a record's subject, sender or reason contains every word of the keyword, ignoring case. */
export function matchesKeyword(record: Pick<ParsedMessage, "subject" | "from" | "reason">, keyword: string): boolean {
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [record.subject, record.from, record.reason].filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The records worth reviewing: those that did not become bookings and are not still being read. */
export function toReview(records: readonly ParsedMessage[], keyword: string): ParsedMessage[] {
  return records.filter((r) => r.outcome !== "imported" && r.outcome !== "processing" && matchesKeyword(r, keyword));
}
