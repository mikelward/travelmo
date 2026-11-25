import { journeyGapSearch, type JourneyGap, type LookedEmail, type LookResult, type ParsedMessage } from "@travelmo/core";
import { importReport } from "./debugReport";
import type { EmailMessage } from "./gmail";
import type { ImportDebug, ImportOutcome } from "./importer";

// "Look for it" on a journey a trip seems to be missing (core journeyGaps):
// the person's Gmail searched for emails naming both its ends, and those
// read as Import anyway reads one (no pre-filter, an earlier "not a
// booking" no obstacle), newest first, until one is a booking. Only emails
// sent in the months before the journey are searched (lookQuery). A few are
// read at a time, each a call to the model, and the person carries on with
// Keep looking: `next` is how many matches were already looked at.

// Emails the model reads per look.
export const lookBatch = 5;
// Matches a look goes through, at most, in each mailbox: one search call.
export const lookMatches = 500;

// How long before the journey its booking email may have been sent.
export const lookMonths = 6;

// Gmail's form of a day ("2026/01/10"), `days` on from a YYYY-MM-DD date and
// `months` back.
function gmailDay(date: string, months = 0, days = 0): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replaceAll("-", "/");
}

// Where a look searches: the gap's search (both ends, by city or code), in
// emails sent from lookMonths before the gap's first day until the day
// after its last (the next journey's, for one between journeys: a reminder
// comes days before), outside spam, trash and the promotions and social
// tabs.
export function lookQuery(gap: Pick<JourneyGap, "from" | "fromCode" | "to" | "toCode" | "date" | "until">): string {
  const places = journeyGapSearch({ ...gap, direction: "back", mode: "flight" });
  return `-in:spam -in:trash -category:promotions -category:social after:${gmailDay(gap.date, lookMonths)} before:${gmailDay(gap.until ?? gap.date, 0, 1)} ${places}`;
}

// A connected mailbox as a look uses it: its matches' record ids, newest
// first, and an email fetched by record id.
export type LookMailbox = { search: (query: string, max: number) => Promise<string[]>; fetch: (recordId: string) => Promise<EmailMessage> };

export type LookIo = {
  mailboxes: readonly LookMailbox[];
  record: (recordId: string) => Promise<ParsedMessage | undefined>;
  read: (message: EmailMessage, debug: ImportDebug) => Promise<ImportOutcome>;
  isNotFound: (error: unknown) => boolean;
};

const found = (outcome: string) => outcome === "imported" || outcome === "cancellation";

export async function lookForJourney(query: string, from: number, io: LookIo): Promise<LookResult> {
  const matches: { mailbox: LookMailbox; id: string }[] = [];
  for (const mailbox of io.mailboxes) {
    for (const id of await mailbox.search(query, lookMatches)) matches.push({ mailbox, id });
  }
  const emails: LookedEmail[] = [];
  let read = 0;
  let at = from;
  for (; at < matches.length && read < lookBatch; at++) {
    const { mailbox, id } = matches[at]!;
    const record = await io.record(id);
    if (record && found(record.outcome)) {
      emails.push({ messageId: id, subject: record.subject ?? "", from: record.from ?? "", sent: record.sentAt ?? "", outcome: "already" });
      continue;
    }
    let message: EmailMessage;
    try {
      message = await mailbox.fetch(id);
    } catch (error) {
      // Gone since the search: nothing to read.
      if (io.isNotFound(error)) continue;
      throw error;
    }
    const debug: ImportDebug = {};
    const outcome = await io.read(message, debug);
    read += 1;
    const looked = { messageId: message.id, subject: message.subject, from: message.from, sent: message.date };
    if (outcome === "skipped") {
      // Being imported right now, by another reading.
      emails.push({ ...looked, outcome: "busy" });
      continue;
    }
    emails.push({ ...looked, outcome, report: importReport(message, await io.record(message.id), debug) });
    if (found(outcome)) {
      at += 1;
      break;
    }
  }
  return at < matches.length ? { emails, next: at } : { emails };
}
