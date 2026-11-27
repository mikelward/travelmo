import { stripForwardPrefix } from "./forward";
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

// A Gmail search for an email, for where a link to it can't open it (the
// Gmail app takes no such link, and Gmail's mobile site drops the message
// id): its sender's domain, its subject, and the days around when it was
// sent, wide enough for any time zone the mailbox searches in.
export function gmailSearch(email: { sender?: string | undefined; subject?: string | undefined; sentAt?: string | undefined }): string {
  const sent = new Date(`${(email.sentAt ?? "").slice(0, 10)}T00:00:00Z`);
  const day = (offset: number) => {
    if (Number.isNaN(sent.getTime())) return "";
    const date = new Date(sent);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10).replaceAll("-", "/");
  };
  const subject = email.subject?.replaceAll('"', " ").replace(/\s+/g, " ").trim();
  const after = day(-1);
  const before = day(2);
  return [email.sender ? `from:${email.sender}` : "", subject ? `subject:"${subject}"` : "", after && `after:${after}`, before && `before:${before}`].filter(Boolean).join(" ");
}

// The search for one of a booking's emails. The booking keeps one sender,
// the first email's, so it narrows the search only when that is the one
// email; and only a sent date counts, as `at` is when it was imported. A
// forward ("Fwd: …") keeps its original's sender and date, not its own, so
// it is searched by subject alone.
export function sourceSearch(segment: Pick<Segment, "sender" | "sources" | "gmailMessageIds" | "createdAt">, source: SourceRef): string {
  const forwarded = source.label !== undefined && stripForwardPrefix(source.label) !== source.label.trim();
  if (forwarded) return gmailSearch({ subject: source.label });
  const emails = segmentSources(segment).filter((s) => s.kind !== "tripit" && s.kind !== "ics");
  return gmailSearch({ sender: emails.length === 1 ? segment.sender : undefined, subject: source.label, sentAt: source.sentAt });
}

// The sources a trip's bookings came from, for splitting the trip (Split… on
// the trip page): each with the bookings it gave, the most first. Only a
// source that gave some of the bookings and not all can split anything off.
export type SourceGroup = { source: SourceRef; segmentIds: string[] };

export function sourceGroups(segments: readonly Pick<Segment, "id" | "sources" | "gmailMessageIds" | "createdAt">[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const segment of segments) {
    for (const source of segmentSources(segment)) {
      const key = `${source.kind}/${source.id}`;
      const group = groups.get(key) ?? { source, segmentIds: [] };
      group.segmentIds.push(segment.id);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter((g) => g.segmentIds.length < segments.length)
    .sort((a, b) => b.segmentIds.length - a.segmentIds.length || a.source.at.localeCompare(b.source.at));
}
