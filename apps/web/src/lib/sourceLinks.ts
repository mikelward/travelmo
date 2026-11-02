import { gmailMessageUrl, type SourceRef } from "@travelmo/core";

export type EmailLinks = {
  // The viewer, and the Gmail address they connected.
  uid: string;
  account?: string | undefined;
  // For sources recorded before imports were attributed: the trip's owner
  // is taken to be the importer.
  ownsTrip: boolean;
};

// An email links only for the user whose mailbox it was read from.
export function emailLinkFor(source: SourceRef, links: EmailLinks | undefined): string | undefined {
  if (source.kind !== "gmail" || !links) return undefined;
  const mine = source.uid ? source.uid === links.uid : links.ownsTrip;
  return mine ? gmailMessageUrl(source.id, links.account) : undefined;
}
