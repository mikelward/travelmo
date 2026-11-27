import type { ParsedMessage } from "@travelmo/core";
import { readerVersion } from "./extract";
import type { EmailMessage } from "./gmail";
import type { ImportDebug } from "./importer";

// How much of the text the model read the report shows: enough to see
// whether the itinerary was in it, short enough to paste.
export const reportExcerptChars = 4_000;

const count = (n: number) => n.toLocaleString("en-US");

// "Import anyway"'s report, for the person to copy and paste where the
// email reader is being tuned: what was read, how (which body, how long),
// what the model answered and what came of it. Built for the person who
// asked, returned to them alone, never stored or logged: it quotes their
// email.
export function importReport(message: EmailMessage, record: ParsedMessage | undefined, debug: ImportDebug): string {
  const choice = message.textChoice;
  const text = choice
    ? `${choice.from === "html" ? "HTML" : "plain text"} (plain ${count(choice.plainChars)} characters, HTML ${count(choice.htmlChars)})${choice.truncated ? ", cut short" : ""}`
    : "as the mailbox gave it";
  const outcome = record ? `${record.outcome}${record.reason ? ` (${record.reason})` : ""}` : "unknown";
  const excerpt = message.text.slice(0, reportExcerptChars);
  return [
    "Travelmo import report",
    `Email: ${message.subject}`,
    `From: ${message.from}`,
    `Sent: ${message.date}`,
    `Outcome: ${outcome}`,
    ...(record?.loyalty ?? []).map((line) => `Loyalty kept: ${line}`),
    ...(record?.loyaltyMissed ? [`Loyalty not kept: ${record.loyaltyMissed}`] : []),
    `Reader: version ${readerVersion}`,
    `Text read: ${text}, ${count(message.text.length)} characters sent`,
    `PDFs sent: ${debug.attachments ?? 0}`,
    debug.error ? `Model failed: ${debug.error}` : `Model said:\n${JSON.stringify(debug.extraction ?? null, null, 2)}`,
    `Text the model read${message.text.length > excerpt.length ? ` (first ${count(excerpt.length)} characters)` : ""}:`,
    excerpt,
  ].join("\n");
}
