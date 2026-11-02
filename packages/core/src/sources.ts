import type { Segment, SourceRef } from "./schema";

// A booking's sources, oldest first, one per source item: those recorded in
// `sources`, plus Gmail messages listed only in `gmailMessageIds` (bookings
// imported before sources were kept).
export function segmentSources(segment: Pick<Segment, "sources" | "gmailMessageIds" | "createdAt">): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const ref of segment.sources ?? []) {
    const key = `${ref.kind}/${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  for (const id of segment.gmailMessageIds ?? []) {
    if (seen.has(`gmail/${id}`)) continue;
    seen.add(`gmail/${id}`);
    out.push({ kind: "gmail", id, at: segment.createdAt });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// Opens the message in the Gmail account it was imported from; without the
// address, in whichever account the browser has open first.
export function gmailMessageUrl(messageId: string, account?: string): string {
  const user = account ? `u/?authuser=${encodeURIComponent(account)}` : "u/0/";
  return `https://mail.google.com/mail/${user}#all/${encodeURIComponent(messageId)}`;
}
