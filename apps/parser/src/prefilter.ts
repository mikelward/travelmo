export type MessageSummary = {
  from: string;
  subject: string;
  listUnsubscribe?: boolean;
};

export type PrefilterResult =
  | { pass: true; reason: string }
  | { pass: false; reason: string };

export type SenderPatterns = {
  allow: readonly string[];
  deny: readonly string[];
};

const subjectKeywords =
  /\b(booking|reservation|confirmation|confirmed|itinerary|e-?ticket|tickets?|boarding pass|check-?in|flight|hotel|your (trip|stay|journey|rental|ride|car)|car (hire|rental)|rail|train|ferry|cruise|accommodation|lodging)\b/i;

const subjectNoise =
  /\b(newsletter|sale|deal|offer|discount|% off|save up to|last chance|flash|points|miles|survey|feedback|how was|rate your|unsubscribe|password|verify your|welcome to)\b/i;

// Domains whose transactional mail is almost always a booking. Users extend
// this list from the UI; see SenderPatterns.allow.
export const seedSenderDomains = [
  "booking.com",
  "airbnb.com",
  "expedia.com",
  "hotels.com",
  "agoda.com",
  "trainline.com",
  "thetrainline.com",
  "eurostar.com",
  "nationalrail.co.uk",
  "britishairways.com",
  "ba.com",
  "easyjet.com",
  "ryanair.com",
  "united.com",
  "delta.com",
  "aa.com",
  "lufthansa.com",
  "klm.com",
  "airfrance.com",
  "qantas.com",
  "virginatlantic.com",
  "hertz.com",
  "avis.com",
  "enterprise.com",
  "sixt.com",
  "europcar.com",
  "marriott.com",
  "hilton.com",
  "ihg.com",
  "hyatt.com",
  "accor.com",
  "vrbo.com",
  "getyourguide.com",
  "viator.com",
  "ticketmaster.com",
  "ticketmaster.co.uk",
] as const;

export function senderDomain(from: string): string | undefined {
  const match = /<?([^\s<>@]+)@([^\s<>]+?)>?\s*$/.exec(from.trim());
  return match?.[2]?.toLowerCase();
}

function domainMatches(domain: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  return domain === p || domain.endsWith(`.${p}`);
}

// A flight or train number ("BA 117", "XX123") or an airport-to-airport
// route ("LHR to JFK"): what a calendar's travel events are titled with,
// often with no booking word at all.
const journeyPattern = /\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z]) ?\d{1,4}\b|\b[A-Z]{3} ?(?:to|-|→) ?[A-Z]{3}\b/;

// Calendar events have no sender to allow or deny, only a title. A calendar
// whose every event is travel (TripIt's) skips the check, and the
// similarity stage with it, as an allowed sender does.
export function calendarPrefilter(summary: string, travelCalendar: boolean): PrefilterResult {
  if (travelCalendar) return { pass: true, reason: "travel calendar" };
  if (subjectNoise.test(summary)) return { pass: false, reason: "subject looks promotional" };
  if (subjectKeywords.test(summary) || journeyPattern.test(summary)) return { pass: true, reason: "subject keyword" };
  return { pass: false, reason: "no booking signal" };
}

export function prefilter(
  message: MessageSummary,
  patterns: SenderPatterns = { allow: [], deny: [] },
): PrefilterResult {
  const domain = senderDomain(message.from);
  if (domain && patterns.deny.some((p) => domainMatches(domain, p))) {
    return { pass: false, reason: `sender ${domain} denied` };
  }
  const allowed =
    domain !== undefined &&
    [...seedSenderDomains, ...patterns.allow].some((p) => domainMatches(domain, p));
  const keyword = subjectKeywords.test(message.subject);
  const noise = subjectNoise.test(message.subject);

  if (allowed && !noise) return { pass: true, reason: `sender ${domain} allowed` };
  if (keyword && !noise) return { pass: true, reason: "subject keyword" };
  if (keyword && noise && allowed) return { pass: true, reason: `sender ${domain} allowed` };
  if (noise) return { pass: false, reason: "subject looks promotional" };
  return { pass: false, reason: "no booking signal" };
}
