import type { ExtractedBooking, ImportSource } from "@travelmo/core";
import { createHash } from "node:crypto";
import type { EmailMessage } from "./gmail";

// Which trip an import belongs to, when the source already knows (a TripIt
// trip). "overlap" merges into a live trip whose dates overlap the hint's;
// "title" only reuses a trip with exactly this title, for holding trips that
// must never swallow a real one.
export type TripHint = { title: string; start: string; end: string; merge?: "overlap" | "title" };

type CandidateBase = {
  source: ImportSource;
  // The parsedMessages document id and the prefix of the segment ids. A
  // Gmail message id as is; anything else hashed (candidateId), since
  // Firestore ids cannot hold "/" and are capped in length.
  id: string;
  // Shown in the review list.
  from?: string;
  subject: string;
  gmailMessageIds?: string[];
  tripHint?: TripHint;
  // Extra wording for the parsed record, e.g. why the model had to read it.
  note?: string;
};

// Text goes through the pre-filter, the similarity stage and the model, like
// an email; a booking is already structured and skips all three.
export type TextCandidate = CandidateBase & { kind: "text"; message: EmailMessage };
export type BookingCandidate = CandidateBase & { kind: "booking"; booking: ExtractedBooking };
export type Candidate = TextCandidate | BookingCandidate;

export function gmailCandidate(message: EmailMessage): Candidate {
  return {
    kind: "text",
    source: "gmail",
    id: message.id,
    from: message.from,
    subject: message.subject,
    gmailMessageIds: [message.id],
    message,
  };
}

// A stable, Firestore-safe id from whatever identifies the item in its
// source, so importing the same file twice changes nothing.
export function candidateId(source: ImportSource, parts: readonly unknown[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${source}-${digest.slice(0, 24)}`;
}
