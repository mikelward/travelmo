import { gmailSourceLink, type GmailConnection, type ParsedMessage, type SourceRef } from "@travelmo/core";

// What a booking's Sources dialog calls each kind of source.
export const sourceKindLabels: Record<SourceRef["kind"], string> = {
  gmail: "Email",
  fastmail: "Fastmail email",
  tripit: "TripIt",
  ics: "Calendar",
  forward: "Forwarded email",
};

type RecordSource = NonNullable<ParsedMessage["source"]>;

// What Import review calls where a record came from.
export const recordSourceLabels: Record<RecordSource, string> = {
  gmail: "Gmail",
  fastmail: "Fastmail",
  tripit: "TripIt",
  ics: "Calendar",
  forward: "Forwarded email",
};

// A record read from a connected mailbox (a record without `source` is a
// Gmail one) can be read again and has a sender worth teaching; forwarded
// emails, TripIt items and calendar events have neither.
export function isFromMailbox(record: Pick<ParsedMessage, "source">): boolean {
  const source = record.source ?? "gmail";
  return source === "gmail" || source === "fastmail";
}

export type EmailLinks = {
  // The viewer, and the Gmail mailboxes they connected.
  uid: string;
  mailboxes?: readonly Pick<GmailConnection, "emailAddress" | "idPrefix">[] | undefined;
  // For sources recorded before imports were attributed: the trip's owner
  // is taken to be the importer.
  ownsTrip: boolean;
};

// An email links only for the user whose mailbox it was read from, and
// opens in that mailbox. Only Gmail ones link: Fastmail has no stable
// address for a message.
export function emailLinkFor(source: SourceRef, links: EmailLinks | undefined): string | undefined {
  if (source.kind !== "gmail" || !links) return undefined;
  const mine = source.uid ? source.uid === links.uid : links.ownsTrip;
  return mine ? gmailSourceLink(source.id, links.mailboxes ?? []) : undefined;
}
