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

// A cancellation is a booking signal too: it marks a booking cancelled
// (markCancelled), whoever sent it. Every spelling: cancellation,
// cancelation, cancelled, canceled.
const subjectKeywords =
  /\b(booking|reservation|confirmation|confirmed|itinerary|e-?ticket|tickets?|boarding pass|check-?in|flight|hotel|your (trip|stay|journey|rental|ride|car)|car (hire|rental)|rail|train|ferry|cruise|accommodation|lodging|cancell?ation|cancell?ed)\b/i;

const subjectNoise =
  /\b(newsletter|sale|deal|offer|discount|% off|save up to|last chance|flash|points|miles|survey|feedback|how was|rate your|unsubscribe|password|verify your|welcome to)\b/i;

// A travel loyalty program's statement ("your Emerald Club eStatement",
// "Avios balance"): read for the balance and status, not a booking. Only from
// a travel company's own domain (an airline, hotel group or car rental
// company, `travelLoyaltyDomains`) or a sender the user always imports:
// shops, supermarkets, coffee chains and card issuers send statements too,
// and those never reach the model.
const statementWords = /\b(e-?statements?|statements?|account summary|(points|miles|avios) balance|balance update)\b/i;
export const statementReason = "loyalty statement";

export const travelLoyaltyDomains = [
  "emeraldclub.com",
  "nationalcar.com",
  "alamo.com",
  "avis.com",
  "budget.com",
  "enterprise.com",
  "hertz.com",
  "sixt.com",
  "europcar.com",
  "avios.com",
  "britishairways.com",
  "ba.com",
  "virginatlantic.com",
  "flyingblue.com",
  "airfrance.com",
  "klm.com",
  "lufthansa.com",
  "miles-and-more.com",
  "united.com",
  "delta.com",
  "aa.com",
  "southwest.com",
  "jetblue.com",
  "alaskaair.com",
  "aircanada.com",
  "emirates.com",
  "qatarairways.com",
  "singaporeair.com",
  "cathaypacific.com",
  "qantas.com",
  "marriott.com",
  "hilton.com",
  "ihg.com",
  "hyatt.com",
  "accor.com",
  "all.accor.com",
  "wyndhamhotels.com",
  "choicehotels.com",
  "bestwestern.com",
  "radissonhotels.com",
] as const;

// Whether an email is a travel program's statement, by its sender and
// subject; asked apart from the pre-filter too, for an email forwarded or
// read again on request, which skips it.
export function isTravelStatement(message: Pick<MessageSummary, "from" | "subject">, patterns: SenderPatterns = { allow: [], deny: [] }): boolean {
  const domain = senderDomain(message.from);
  if (domain === undefined || patterns.deny.some((p) => domainMatches(domain, p))) return false;
  return [...travelLoyaltyDomains, ...patterns.allow].some((p) => domainMatches(domain, p)) && statementWords.test(message.subject);
}

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
  // Airlines, each under every one of its countries' domains (brandOf):
  // Qatar Airways writes from qatarairways.com.qa, Air New Zealand from
  // airnz.co.nz, Emirates from emirates.email.
  "qatarairways.com",
  "emirates.com",
  "etihad.com",
  "singaporeair.com",
  "cathaypacific.com",
  "airnz.com",
  "airnewzealand.com",
  "virginaustralia.com",
  "jetstar.com",
  "fijiairways.com",
  "southwest.com",
  "alaskaair.com",
  "hawaiianairlines.com",
  "jetblue.com",
  "aircanada.com",
  "westjet.com",
  "swiss.com",
  "turkishairlines.com",
  "aerlingus.com",
  "iberia.com",
  "finnair.com",
  "icelandair.com",
  "airserbia.com",
  "flynorse.com",
  "jet2.com",
  "jet2holidays.com",
  "tui.com",
  "tui.co.uk",
  // Trains, buses and ferries.
  "amtrak.com",
  "lner.co.uk",
  "trenitalia.com",
  "oebb.at",
  "sj.se",
  "sncf-connect.com",
  "bahn.de",
  "raileurope.com",
  "omio.com",
  "flixbus.com",
  "nationalexpress.com",
  "directferries.com",
  // Car rental.
  "nationalcar.com",
  "alamo.com",
  "budget.com",
  "rentalcars.com",
  // Travel agencies and package holidays.
  "priceline.com",
  "kayak.com",
  "trip.com",
  "webjet.com.au",
  "southwestvacations.com",
  "hrs.com",
  "hostelworld.com",
  // Hotel groups.
  "wyndhamhotels.com",
  "choicehotels.com",
  "bestwestern.com",
  "radissonhotels.com",
  "premierinn.com",
  // Restaurant bookings.
  "opentable.com",
  "thefork.com",
] as const;

// Whether an email comes from a travel company (a seed sender or a travel
// program's domain, under any of its countries' domains: Qantas writes from
// qantas.com.au, easyJet from easyjet.co.uk) or a sender the user always
// imports, and not one they never import: whose emails "Refresh from email"
// reads again once the email reader improves (refresh.ts `readAgain`).
export function travelSender(from: string | undefined, patterns: SenderPatterns): boolean {
  const domain = from ? senderDomain(from) : undefined;
  if (domain === undefined || patterns.deny.some((p) => domainMatches(domain, p))) return false;
  if (patterns.allow.some((p) => domainMatches(domain, p))) return true;
  const brand = brandOf(domain);
  return [...seedSenderDomains, ...travelLoyaltyDomains].some((p) => domainMatches(domain, p) || (brand !== undefined && brandOf(p) === brand));
}

// A seed sender, under any of its countries' domains (Qatar Airways writes
// from qatarairways.com.qa, Qantas from qantas.com.au).
function seedSender(domain: string): boolean {
  const brand = brandOf(domain);
  return seedSenderDomains.some((p) => domainMatches(domain, p) || (brand !== undefined && brandOf(p) === brand));
}

// Second-level suffixes countries register companies under (co.uk, com.au):
// the brand is the label before them, not before the country code alone.
const secondLevel = new Set(["co", "com", "net", "org", "ac", "gov", "ne", "or"]);

// A domain's brand, the label a company registers in each country
// ("qantas" in mail.qantas.com.au and qantas.com), when it is long enough
// to say who it is: two or three letters (aa, ba) name many companies.
export function brandOf(domain: string): string | undefined {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return undefined;
  const countryTld = labels[labels.length - 1]!.length === 2;
  const suffix = countryTld && labels.length >= 3 && secondLevel.has(labels[labels.length - 2]!) ? 2 : 1;
  const brand = labels[labels.length - 1 - suffix];
  return brand && brand.length >= 4 ? brand : undefined;
}

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
  if (isTravelStatement(message, patterns)) return { pass: true, reason: statementReason };
  const allowed = domain !== undefined && (patterns.allow.some((p) => domainMatches(domain, p)) || seedSender(domain));
  const keyword = subjectKeywords.test(message.subject);
  const noise = subjectNoise.test(message.subject);

  if (allowed && !noise) return { pass: true, reason: `sender ${domain} allowed` };
  if (keyword && !noise) return { pass: true, reason: "subject keyword" };
  if (keyword && noise && allowed) return { pass: true, reason: `sender ${domain} allowed` };
  if (noise) return { pass: false, reason: "subject looks promotional" };
  return { pass: false, reason: "no booking signal" };
}
