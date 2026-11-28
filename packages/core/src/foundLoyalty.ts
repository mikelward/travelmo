import { namedProgram } from "./airlinePrograms";
import { couldBeOwner, mergeFoundPair, nameWords, personName, sameMembership, sameNumber, sameOverrideTarget, withFoundLoyalty } from "./loyalty";
import { isMembershipNumber, type ExtractedMembership, type ExtractedSegment, type FoundLoyalty } from "./schema";

// Loyalty numbers read from an email, as the travel profile keeps them
// (SPEC "Loyalty from emails"), and the one-off pass that brings numbers
// kept by earlier versions up to how they are read now.

// The bookings an email books, as far as filing its numbers needs.
export type BookedSegments = readonly Pick<ExtractedSegment, "type" | "title">[];

// Whose a membership is, when the email names someone other than the owner.
export function personOf(holder: string | undefined, owner: string | undefined): { person?: string } {
  const person = holder && !couldBeOwner(holder, owner) ? personName(holder) : undefined;
  return person ? { person } : {};
}

// The email a sighting is from: its id and subject, when it was read and,
// if known, when it was sent (what a balance and a status are as of).
export type Sighting = { messageId: string; label?: string; at: string; sent?: string };

// The memberships an email showed, as found entries: a balance read as a
// number is no membership; a number under a generic label is filed under
// its airline's program (namedProgram); one whose name is not the owner's
// is someone they book for (`person`).
export function foundLoyaltyFrom(
  memberships: readonly ExtractedMembership[],
  segments: BookedSegments,
  owner: string | undefined,
  sighting: Sighting,
): FoundLoyalty[] {
  const { messageId, label, at, sent } = sighting;
  return memberships
    .filter((m) => isMembershipNumber(m.number))
    .map((m) => ({
      ...m,
      program: namedProgram(m, segments),
      ...personOf(m.holder, owner),
      messageId,
      ...(label !== undefined ? { label } : {}),
      at,
      ...(m.balance ? { balanceAt: sent ?? at } : {}),
      ...(m.status ? { statusAt: sent ?? at } : {}),
    }));
}

// What an import kept of a membership, for its review row: the program,
// then its status and balance as the email gave them ("Delta: Silver
// Medallion · 49,606 Miles"). The number stays out: the loyalty table has it.
export function foundLoyaltyLine(found: Pick<FoundLoyalty, "program" | "status" | "balance">): string {
  const details = [found.status, found.balance].filter(Boolean).join(" · ");
  return details ? `${found.program}: ${details}` : found.program;
}

// Bumped when a change to how numbers are read should reach those already
// kept; the parser runs the revision once per bump (config/foundLoyaltyRevision).
export const foundLoyaltyRevision = 1;

// The found list as if each number were read now, without reading its
// email again: the program by namedProgram with the bookings its email
// made, and whose it is by its holder's name (an automatic `person`, filled
// or corrected; the owner's own answers are in loyaltyPeople, which this
// never sees). With the owner's name unknown, or no holder, whose it is
// stays as it was. Entries that now name one membership become one.
export function revisedFoundLoyalty(found: readonly FoundLoyalty[], owner: string | undefined, segmentsOf: (messageId: string) => BookedSegments): FoundLoyalty[] {
  const revised = found.map((entry): FoundLoyalty => {
    const { person: _person, ...rest } = entry;
    const person = entry.holder && owner ? personOf(entry.holder, owner) : entry.person ? { person: entry.person } : {};
    return { ...rest, program: namedProgram(entry, segmentsOf(entry.messageId)), ...person };
  });
  // Merged as a sighting is; one that merges with nothing is kept as it is.
  return revised.reduce<FoundLoyalty[]>(
    (list, entry) =>
      list.some((f) => sameMembership(f, entry) && (!f.person || !entry.person || f.person === entry.person))
        ? withFoundLoyalty(list, entry)
        : [...list, entry],
    [],
  );
}

// Whether only reading the email again could improve an entry: the name of
// whose it is is missing, or the program still has a name any program
// could have ("Frequent Flyer").
export const needsReread = (entry: FoundLoyalty) => !entry.holder || !nameWords(entry.program).size;

// The found list with one email's entries replaced by what reading it again
// found (`fresh`, from foundLoyaltyFrom): a number read before keeps the
// balance and status it had where the new read has none or older ones, and
// is the new read's person's when the new read names its holder. A read
// that finds nothing leaves the entries as they were. `read` is the list
// as it was when the email was read: a number of the email's on it but no
// longer on `found` was removed meanwhile, and stays removed.
export function rereadFoundLoyalty(
  found: readonly FoundLoyalty[],
  messageId: string,
  fresh: readonly FoundLoyalty[],
  read: readonly FoundLoyalty[] = found,
): FoundLoyalty[] {
  if (!fresh.length) return [...found];
  const old = found.filter((f) => f.messageId === messageId);
  const others = found.filter((f) => f.messageId !== messageId);
  const wasRead = read.filter((r) => r.messageId === messageId);
  const kept = fresh.filter((f) => {
    const origin = earlier(wasRead, f);
    return !origin || old.some((o) => sameMembership(o, origin) && (!o.person || !origin.person || o.person === origin.person));
  });
  return kept.reduce<FoundLoyalty[]>(
    (list, f) => {
      const before = earlier(old, f);
      // A number new to this email is added as any sighting is, refused if
      // the list is full.
      if (!before) return withFoundLoyalty(list, f);
      const merged = mergeFoundPair({ ...before, program: f.program }, f);
      const { person: _person, ...rest } = merged;
      const person = f.holder ? f.person : before.person;
      const replacement: FoundLoyalty = { ...rest, ...(person ? { person } : {}) };
      // One read before takes its old place's room, so it is kept even when
      // the list is full.
      return list.some((e) => sameMembership(e, replacement) && (!e.person || !replacement.person || e.person === replacement.person))
        ? withFoundLoyalty(list, replacement)
        : [...list, replacement];
    },
    [...others],
  );
}

// The entry a fresh one reads again: the same membership (preferring the same
// household member and exact number when multiple masked sightings share a
// tail); failing that, the only one with its number (a program the new read
// names better).
function earlier(entries: readonly FoundLoyalty[], fresh: FoundLoyalty): FoundLoyalty | undefined {
  const matches = entries.filter((e) => sameMembership(e, fresh));
  if (matches.length > 0) {
    const exactNum = (e: FoundLoyalty) => e.number.trim().toUpperCase() === fresh.number.trim().toUpperCase();
    return (
      matches.find((e) => e.person === fresh.person && exactNum(e)) ??
      matches.find((e) => (!e.person || !fresh.person || e.person === fresh.person) && exactNum(e)) ??
      matches.find((e) => e.person === fresh.person) ??
      matches.find((e) => !e.person || !fresh.person || e.person === fresh.person) ??
      (matches.length === 1 && sameOverrideTarget(matches[0]!, fresh) ? matches[0] : undefined)
    );
  }
  const sameNumbered = entries.filter((e) => sameNumber(e.number, fresh.number, e.program, fresh.program));
  return sameNumbered.length === 1 ? sameNumbered[0] : undefined;
}
