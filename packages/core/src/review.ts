import type { ParsedMessage } from "./schema";
import { hasWordStartsOf, wordsOf } from "./words";

/** What the review list is narrowed to; empty fields leave it unfiltered. */
export type ReviewSearch = { keyword: string; from: string; to: string };

/**
 * The bounds, as ISO instants, for a range of local calendar days (`YYYY-MM-DD`, as a date input gives them): from the start of `from`
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

function recordSearchText(record: Pick<ParsedMessage, "subject" | "from" | "reason">): string {
  return [record.subject, record.from, record.reason].filter(Boolean).join(" ");
}

/** Whether each word of the keyword starts a word of a record's subject, sender or reason, ignoring case and accents. */
export function matchesKeyword(record: Pick<ParsedMessage, "subject" | "from" | "reason">, keyword: string): boolean {
  if (!keyword.trim()) return true;
  return hasWordStartsOf(recordSearchText(record), wordsOf(keyword));
}

/**
 * Whether a record falls in a dayRange: by when the email was sent, or,
 * for a record that does not say (another source, an older record), when
 * it was read.
 */
export function inRange(record: Pick<ParsedMessage, "sentAt" | "processedAt">, range: { start?: string; end?: string }): boolean {
  const at = Date.parse(record.sentAt ?? record.processedAt);
  return (!range.start || at >= Date.parse(range.start)) && (!range.end || at < Date.parse(range.end));
}

const reviewDateFormatters = new Map<string, Intl.DateTimeFormat>();

function getReviewDateFormatter(locale: string, timeZone?: string): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone ?? ""}`;
  let formatter = reviewDateFormatters.get(key);
  if (!formatter) {
    if (reviewDateFormatters.size >= 32) reviewDateFormatters.clear();
    formatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", ...(timeZone ? { timeZone } : {}) });
    reviewDateFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * The dates a review row shows, in the viewer's own zone: when the email was
 * sent, if the record says, and when it was read.
 */
export function reviewDate(record: Pick<ParsedMessage, "sentAt" | "processedAt">, locale = "en-GB", timeZone?: string): string {
  const formatter = getReviewDateFormatter(locale, timeZone);
  const read = `Read ${formatter.format(new Date(record.processedAt))}`;
  return record.sentAt ? `Sent ${formatter.format(new Date(record.sentAt))} · ${read}` : read;
}

/**
 * Records read once for a search, brought up to date by the live list of
 * the latest: a record read again (reimported) is newer there and replaces
 * its old copy, and one new since the search is added. Newest first.
 */
// What came of a record, as its review row says it: an email that gave a
// travel program's loyalty says so, rather than only that it was no booking.
export function outcomeLabel(record: Pick<ParsedMessage, "outcome" | "loyalty">): string {
  if (record.outcome === "not_booking" && record.loyalty?.length) return "Read, loyalty kept";
  return outcomeLabels[record.outcome];
}

const outcomeLabels: Record<ParsedMessage["outcome"], string> = {
  processing: "Processing",
  filtered: "Skipped before reading",
  not_booking: "Read, not a booking",
  imported: "Imported",
  failed: "Failed",
  cancellation: "Cancellation",
};

export function withLatest(searched: readonly ParsedMessage[], latest: readonly ParsedMessage[]): ParsedMessage[] {
  const fresh = new Map(latest.map((r) => [r.messageId, r]));
  const kept = searched.filter((r) => !fresh.has(r.messageId));
  return [...latest, ...kept].sort((a, b) => b.processedAt.localeCompare(a.processedAt));
}

/**
 * Whether a completed search cache (`cached`, newest first) still joins cleanly
 * with the live `latest` window (`windowSize` newest records, newest first) so
 * `withLatest(cached, latest)` cannot miss records imported since the search.
 */
export function reviewCacheCoversLatest(
  cached: readonly Pick<ParsedMessage, "messageId" | "processedAt">[],
  latest: readonly Pick<ParsedMessage, "messageId" | "processedAt">[] | undefined,
  windowSize: number,
): boolean {
  if (!latest || latest.length < windowSize) return true;
  if (cached.length === 0) return false;
  const cachedNewest = cached[0]!.processedAt;
  const oldestLatest = latest[latest.length - 1]!;
  if (oldestLatest.processedAt < cachedNewest) return true;
  const cachedAt = new Map<string, string>();
  for (const r of cached) cachedAt.set(r.messageId, r.processedAt);
  return latest.every((r) => cachedAt.get(r.messageId) === r.processedAt);
}

/**
 * The records worth reviewing: those that did not become bookings and are
 * not still being read, matching the keyword and the days, and those whose
 * Import anyway report is still to copy (`kept`), whatever came of them.
 */
export function toReview(records: readonly ParsedMessage[], keyword: string, range: { start?: string; end?: string } = {}, kept: ReadonlySet<string> = new Set()): ParsedMessage[] {
  const queryWords = keyword.trim() ? wordsOf(keyword) : [];
  const startMs = range.start ? Date.parse(range.start) : undefined;
  const endMs = range.end ? Date.parse(range.end) : undefined;
  return records.filter((r) => {
    if (kept.has(r.messageId)) return true;
    if (r.outcome === "imported" || r.outcome === "processing") return false;
    if (startMs !== undefined || endMs !== undefined) {
      const at = Date.parse(r.sentAt ?? r.processedAt);
      if ((startMs !== undefined && !(at >= startMs)) || (endMs !== undefined && !(at < endMs))) return false;
    }
    return queryWords.length === 0 || hasWordStartsOf(recordSearchText(r), queryWords);
  });
}
