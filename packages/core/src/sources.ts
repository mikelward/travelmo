import { compareInstants } from "./instant";
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

// A trip's bookings by the source each came from, for splitting the trip
// (Split… on the trip page): every email or other source with the bookings
// it gave, in date order, so which is which is plain; a booking from two
// emails (a stay's confirmation and its receipt) is under both. Bookings
// with no source (added by hand) come last, with no `source`. Groups go by
// their first booking's start, then by when the source was read; `sender`
// is an email's sender, as a booking that came from that email alone names
// it (a TripIt trip or a calendar event has none, nor an email whose every
// booking another email gave too).
export type SourceGroup = { source?: SourceRef; sender?: string; segmentIds: string[] };

const emailKinds = new Set<SourceRef["kind"]>(["gmail", "forward", "fastmail", "imap"]);

type Grouped = Pick<Segment, "id" | "title" | "start" | "sender" | "sources" | "gmailMessageIds" | "createdAt">;

export function sourceGroups(segments: readonly Grouped[]): SourceGroup[] {
  const sorted = [...segments].sort((a, b) => compareInstants(a.start, b.start) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  const groups = new Map<string, SourceGroup & { first: string }>();
  const unsourced: string[] = [];
  for (const segment of sorted) {
    const sources = segmentSources(segment);
    if (sources.length === 0) unsourced.push(segment.id);
    // A booking's sender is its first email's: it says which email that was
    // only when the booking came from one email alone (as sourceSearch).
    const oneEmail = sources.filter((s) => emailKinds.has(s.kind)).length === 1;
    for (const source of sources) {
      const key = `${source.kind}/${source.id}`;
      const group = groups.get(key) ?? { source, segmentIds: [], first: segment.start };
      if (!group.sender && oneEmail && emailKinds.has(source.kind) && segment.sender) group.sender = segment.sender;
      group.segmentIds.push(segment.id);
      groups.set(key, group);
    }
  }
  const ordered = [...groups.values()]
    .sort((a, b) => compareInstants(a.first, b.first) || a.source!.at.localeCompare(b.source!.at))
    .map(({ first: _first, ...group }) => group);
  return unsourced.length ? [...ordered, { segmentIds: unsourced }] : ordered;
}
