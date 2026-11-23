import { gmailSourceLink, type GmailConnection, type SourceRef } from "@travelmo/core";

export type EmailLinks = {
  // The viewer, and the Gmail mailboxes they connected.
  uid: string;
  mailboxes?: readonly Pick<GmailConnection, "emailAddress" | "idPrefix">[] | undefined;
  // For sources recorded before imports were attributed: the trip's owner
  // is taken to be the importer.
  ownsTrip: boolean;
};

// An email links only for the user whose mailbox it was read from, and
// opens in that mailbox.
export function emailLinkFor(source: SourceRef, links: EmailLinks | undefined): string | undefined {
  if (source.kind !== "gmail" || !links) return undefined;
  const mine = source.uid ? source.uid === links.uid : links.ownsTrip;
  return mine ? gmailSourceLink(source.id, links.mailboxes ?? []) : undefined;
}
