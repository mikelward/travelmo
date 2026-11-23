import { z } from "zod";

// Dates are ISO 8601 strings, not Firestore Timestamps, so the same documents
// read identically from the web client, the Cloud Run worker and a future
// mobile app. Segment instants keep their UTC offset; trip bounds are plain
// calendar dates because a trip spans time zones.
export const isoDate = z.iso.date();
export const isoDateTime = z.iso.datetime({ offset: true });

export const segmentTypes = [
  "flight",
  "train",
  "bus",
  "ferry",
  "lodging",
  "car_rental",
  "activity",
  "other",
] as const;
export const SegmentType = z.enum(segmentTypes);
export type SegmentType = z.infer<typeof SegmentType>;

export const Place = z.object({
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  country: z.string().length(2).optional(),
  // One line, as a place lookup formats it; the form's address pick sets it.
  address: z.string().min(1).optional(),
  // Where it is, for the map: from the source, the airport table or the
  // geocoder; always both or neither.
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
});
export type Place = z.infer<typeof Place>;

export const ExtractedSegment = z.object({
  type: SegmentType,
  title: z.string().min(1),
  provider: z.string().min(1).optional(),
  confirmation: z.string().min(1).optional(),
  start: isoDateTime,
  end: isoDateTime.optional(),
  origin: Place.optional(),
  destination: Place.optional(),
  notes: z.string().optional(),
});
export type ExtractedSegment = z.infer<typeof ExtractedSegment>;

// A booking an email says was cancelled, as much of it as the email gives:
// enough to find the booking it cancels among those already imported.
export const ExtractedCancellation = z.object({
  type: SegmentType.optional(),
  provider: z.string().min(1).optional(),
  confirmation: z.string().min(1).optional(),
  // The hotel, venue or route, as the email names it.
  place: z.string().min(1).optional(),
  // The city of a stay or event, when the email gives it.
  city: z.string().min(1).optional(),
  // A journey's ends, as the email names them (a code or a name).
  origin: z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  start: isoDateTime.optional(),
  end: isoDateTime.optional(),
});
export type ExtractedCancellation = z.infer<typeof ExtractedCancellation>;

// A loyalty program membership a booking email shows: a frequent flyer or
// hotel rewards number, never the booking's own reference.
export const ExtractedMembership = z.object({
  program: z.string().min(1),
  number: z.string().min(1),
  // The member's name as the email gives it.
  holder: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  // Points, miles or credits as written ("12,400 points"), from a statement.
  balance: z.string().min(1).optional(),
});
export type ExtractedMembership = z.infer<typeof ExtractedMembership>;

export const ExtractedBooking = z.object({
  isBooking: z.boolean(),
  segments: z.array(ExtractedSegment),
  // Bookings the email cancels; absent from older extractions.
  cancellations: z.array(ExtractedCancellation).optional(),
  // Loyalty numbers the email shows; absent from older extractions.
  memberships: z.array(ExtractedMembership).optional(),
});
export type ExtractedBooking = z.infer<typeof ExtractedBooking>;

// Where a booking came from: an email read from Gmail, a hand entry, a
// TripIt export, a calendar file or an email forwarded to the user's
// forwarding address.
export const SegmentSource = z.enum(["gmail", "manual", "tripit", "ics", "forward"]);
export type SegmentSource = z.infer<typeof SegmentSource>;

// One place a booking came from: the email, TripIt item or calendar event
// it was read from. A booking found again elsewhere keeps the new source
// too, so a dropped duplicate (perhaps a second room after all) is one
// click away, as is anything the extraction left out.
export const SourceRef = z.object({
  kind: z.enum(["gmail", "tripit", "ics", "forward"]),
  // The Gmail message id, or the import record's id for the others.
  id: z.string().min(1),
  // What the user recognizes it by: the email's subject, the TripIt trip's
  // name, the event's title.
  label: z.string().optional(),
  // Whose import it was, and so whose mailbox an email is in: a booking can
  // move to a trip someone else owns.
  uid: z.string().min(1).optional(),
  at: isoDateTime,
  // When an email source was sent (its Date), if known: a cancellation
  // sent before it doesn't cancel what it confirms.
  sentAt: isoDateTime.optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const Segment = ExtractedSegment.extend({
  id: z.string().min(1),
  tripId: z.string().min(1),
  source: SegmentSource,
  gmailMessageIds: z.array(z.string()).default([]),
  // Every source this booking was read from, the first one included.
  sources: z.array(SourceRef).optional(),
  // Domain the booking email came from, so a trip page can offer to always
  // import that sender.
  sender: z.string().optional(),
  // The traveler's own verdict, set on the trip page: one to five stars,
  // and whether the place is a favorite. Never set by an import.
  rating: z.number().int().min(1).max(5).optional(),
  favorite: z.boolean().optional(),
  // When a cancellation email was matched to this booking, and that email's
  // id. A cancelled booking stays on its trip, struck through, but counts
  // for nothing: not the trip's dates, what's next, reminders, the
  // calendar export or reports. Cleared when the user restores it.
  cancelledAt: isoDateTime.optional(),
  cancelledBy: z.string().min(1).optional(),
  // When that email was sent, if known: what a later confirmation is weighed
  // against, kept with the booking so it outlives the cancellation's own
  // waiting record.
  cancelledSentAt: isoDateTime.optional(),
  // The cancellation emails the user took back (Restore): never applied to
  // this booking again, however often a confirmation of it is read.
  restoredFrom: z.array(z.string().min(1)).optional(),
  // When the user last took a cancellation back: no cancellation sent (or,
  // undated, read) by then applies to this booking again, whichever one
  // had won; one sent later still does.
  restoredAt: isoDateTime.optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Segment = z.infer<typeof Segment>;

export const Trip = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  start: isoDate,
  end: isoDate,
  ownerUid: z.string().min(1),
  // Lowercase email addresses. Sharing by email needs no user lookup: the
  // partner's client queries trips containing its own verified address.
  sharedWith: z.array(z.string()).default([]),
  // Set first when a trip is deleted; every segment writer refuses a trip
  // carrying it, so the segment sweep that follows cannot leave orphans.
  deleting: z.boolean().optional(),
  // When the person now travels, once cancellations have taken bookings
  // that set the trip's dates (liveBounds): what every screen shows
  // (displayBounds). The trip's own dates stay its full span, for finding
  // its bookings again and for editing. Absent when nothing is cancelled.
  liveStart: isoDate.optional(),
  liveEnd: isoDate.optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Trip = z.infer<typeof Trip>;

// What the web client may see about a Gmail connection; the refresh token
// stays in the server-only GmailState document.
// How far a reading of the whole mailbox has got: it runs on the server in
// batches, each carrying on from Gmail's page cursor, so it survives closing
// the page.
export const BackfillProgress = z.object({
  cursor: z.string().optional(),
  // The last message read on the cursor's page, when a batch ran short of
  // time partway through it; the next batch carries on after it.
  after: z.string().optional(),
  scanned: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  // Emails whose import failed in this reading; starting over tries them again.
  failed: z.number().int().nonnegative().optional(),
  done: z.boolean(),
  updatedAt: isoDateTime,
  // The reading under way: each start gets a new id, and each batch of it a
  // step, so a queued batch of an older reading, or one delivered twice,
  // finds its id or step out of date and does nothing.
  run: z.string().optional(),
  step: z.number().int().nonnegative().optional(),
  // The reading carries on by itself after this batch; Stop clears it.
  running: z.boolean().optional(),
  // The message for `step` is on the topic. False between saving a batch
  // and queueing the next, so a redelivered batch can queue it again.
  queued: z.boolean().optional(),
  // A batch is being read until then, so no other starts meanwhile.
  leaseUntil: isoDateTime.optional(),
  // No batch reads until then: after a failed batch, the email it was
  // importing stays claimed by it that long; after Gmail's rate limit, its
  // per-minute quota frees up.
  retryAfter: isoDateTime.optional(),
  // The id of the one queued message that carries the reading on while it
  // waits (`retryAfter` or a lease): other copies of the step are dropped.
  wake: z.string().optional(),
  // Set while the message for `wake` may not have been queued yet: the
  // message it took over from (`from`, absent for the step's first) may
  // queue it (again) until it runs.
  handoff: z.object({ from: z.string().optional() }).optional(),
  // Batches in a row that failed; the reading stops after a few.
  failures: z.number().int().positive().optional(),
  // Emails whose import failed in the last batch, which paused the reading.
  lastFailed: z.number().int().positive().optional(),
});
export type BackfillProgress = z.infer<typeof BackfillProgress>;

export const GmailConnection = z.object({
  emailAddress: z.string(),
  connectedAt: isoDateTime,
  watchExpiration: isoDateTime.optional(),
  historyId: z.string().optional(),
  backfill: BackfillProgress.optional(),
  // What this mailbox's emails' import records and sources are named by
  // ahead of Gmail's message id (gmail.ts): empty for the account's first
  // mailbox, as for one connected before there could be several.
  idPrefix: z.string().optional(),
});
export type GmailConnection = z.infer<typeof GmailConnection>;

// One calendar of a connected Google account: whether the user chose it, and
// what its last daily read did.
export const GoogleCalendarChoice = z.object({
  id: z.string().min(1),
  summary: z.string(),
  primary: z.boolean().optional(),
  selected: z.boolean(),
  lastReadAt: isoDateTime.optional(),
  lastResult: z.string().optional(),
  lastError: z.string().optional(),
});
export type GoogleCalendarChoice = z.infer<typeof GoogleCalendarChoice>;

// What the web client may see about a Google Calendar connection; the
// refresh token stays in the server-only GoogleCalendarState document.
export const GoogleCalendarConnection = z.object({
  emailAddress: z.string(),
  connectedAt: isoDateTime,
  calendars: z.array(GoogleCalendarChoice),
});
export type GoogleCalendarConnection = z.infer<typeof GoogleCalendarConnection>;

export const GoogleCalendarState = GoogleCalendarConnection.extend({
  refreshToken: z.string().min(1),
});
export type GoogleCalendarState = z.infer<typeof GoogleCalendarState>;

// How the user wants reminders before a trip; the owner sets it in Settings.
// `push` is on while any browser of theirs holds a push subscription or any
// phone of theirs is registered as a device.
export const ReminderSettings = z.object({ email: z.boolean().optional(), push: z.boolean().optional() });
export type ReminderSettings = z.infer<typeof ReminderSettings>;

// A browser's push subscription, as the Push API hands it out, stored under
// the user by that browser (users/{uid}/pushSubscriptions/{id}); the parser
// sends reminders to it and drops it once the push service says it is gone.
export const PushSubscription = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  createdAt: z.string(),
});
export type PushSubscription = z.infer<typeof PushSubscription>;

// A phone's Firebase Cloud Messaging registration, stored under the user by
// the app on that phone (users/{uid}/devices/{id}, the id a hash of the
// token); the parser sends reminders to it and drops it once Messaging says
// the token is no longer registered.
export const Device = z.object({
  token: z.string().min(1),
  platform: z.literal("android"),
  createdAt: z.string(),
});
export type Device = z.infer<typeof Device>;

// The user's forward-to-import address (forward.ts): the parser issues it,
// the owner reads it; only the token's hash is kept elsewhere.
export const ForwardAddress = z.object({
  address: z.string().min(3),
  createdAt: isoDateTime,
});
export type ForwardAddress = z.infer<typeof ForwardAddress>;

// A correction the user made to where home was: home is this town from this
// date, until the next correction's date (homeCorrections in home.ts). At
// most fifty, on the user's own profile document.
export const HomeCorrection = z.object({
  city: z.string().trim().min(1).max(100),
  country: z.string().length(2).optional(),
  from: isoDate,
});
export type HomeCorrection = z.infer<typeof HomeCorrection>;
export const maxHomeCorrections = 50;

// A company the traveler books cars or rides with, added in Settings: a
// minicab firm near home, or a rental company they like. `near` says which
// suggestions it joins: rides to and from the airport at home, or a car
// wherever a flight lands.
export const RideCompany = z.object({
  name: z.string().trim().min(1).max(60),
  url: z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((u) => u.startsWith("https://"), "Use a link that starts with https://"),
  near: z.enum(["home", "anywhere"]),
});
export type RideCompany = z.infer<typeof RideCompany>;
export const maxRideCompanies = 20;

// Ride suggestions the user hid (rideNeedKey in rides.ts), newest last.
export const maxHiddenRideNeeds = 200;
// An address the user asked to link that is waiting for its confirmation
// link to be opened (emails.ts): shown in Settings until it expires.
export const PendingEmail = z.object({ email: z.string(), sentAt: z.string(), expiresAt: z.string() });
export type PendingEmail = z.infer<typeof PendingEmail>;

export const UserProfile = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  photoURL: z.string().optional(),
  // The connected Gmail mailboxes, by lowercased address. `gmail` is one
  // connected before there could be several, until the parser moves it.
  gmail: GmailConnection.optional(),
  gmails: z.record(z.string(), GmailConnection).optional(),
  googleCalendar: GoogleCalendarConnection.optional(),
  reminders: ReminderSettings.optional(),
  forward: ForwardAddress.optional(),
  homes: z.array(HomeCorrection).max(maxHomeCorrections).optional(),
  // An entry that does not parse (a link that is not https://) is left out,
  // not the whole profile.
  rideCompanies: z
    .array(z.unknown())
    .max(maxRideCompanies)
    .transform((entries) => entries.flatMap((e) => {
      const parsed = RideCompany.safeParse(e);
      return parsed.success ? [parsed.data] : [];
    }))
    .optional(),
  hiddenRideNeeds: z.array(z.string()).max(maxHiddenRideNeeds).optional(),
  // Server-written (emails.ts): the addresses the user confirmed besides
  // their sign-in, lowercase, and those waiting for confirmation.
  emails: z.array(z.string()).optional(),
  pendingEmails: z.array(PendingEmail).optional(),
});
export type UserProfile = z.infer<typeof UserProfile>;

export const GmailState = GmailConnection.extend({
  refreshToken: z.string().min(1),
});
export type GmailState = z.infer<typeof GmailState>;

export const SenderPatterns = z.object({
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});
export type SenderPatterns = z.infer<typeof SenderPatterns>;

// One record per thing an import looked at: a Gmail message (keyed by its
// id) or an item of another source (keyed by a stable id derived from it,
// with `source` saying which). A record without `source` is a Gmail one.
export const ParsedMessage = z.object({
  messageId: z.string().min(1),
  source: z.enum(["gmail", "tripit", "ics", "forward"]).optional(),
  uid: z.string().min(1),
  // `cancellation`: an email cancelling bookings; `reason` says how many
  // were found and marked.
  outcome: z.enum(["processing", "filtered", "not_booking", "imported", "failed", "cancellation"]),
  reason: z.string().optional(),
  // Enough of the email to recognize it in a review list.
  from: z.string().optional(),
  subject: z.string().optional(),
  segmentIds: z.array(z.string()).default([]),
  // The trip the segments went into, so a later cancellation can find them.
  tripId: z.string().optional(),
  // Existing bookings ("tripId/segmentId") this item was matched to as a
  // duplicate, so a later upload of the same export keeps matching one to
  // one even for items it skips as already imported.
  matchedSegmentIds: z.array(z.string()).optional(),
  // For a calendar event: a hash of the text the model read, so a later
  // change to the event (a new time, place or note) is read again.
  revision: z.string().optional(),
  processedAt: isoDateTime,
  // When the email was sent (a forward's original), for finding it by date
  // in the review list; absent for other sources and older records.
  sentAt: isoDateTime.optional(),
});
export type ParsedMessage = z.infer<typeof ParsedMessage>;

// A cancellation email's bookings not found when it was read: the mailbox
// is read newest first, so a cancellation often arrives before the booking
// it cancels. Each booking filed later is checked against these and marked
// cancelled if one names it. Parser-only.
export const PendingCancellation = z.object({
  messageId: z.string().min(1),
  uid: z.string().min(1),
  cancellations: z.array(ExtractedCancellation),
  at: isoDateTime,
  // When the cancellation email was sent, if known: a booking from an email
  // sent after it is a new one (made again), which it doesn't cancel.
  sentAt: isoDateTime.optional(),
});
export type PendingCancellation = z.infer<typeof PendingCancellation>;

// A calendar feed the parser polls daily. The URL often carries a secret
// token (TripIt's does), so it is readable by its owner only and never
// logged.
export const CalendarFeed = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  label: z.string().optional(),
  addedAt: isoDateTime,
  lastFetchedAt: isoDateTime.optional(),
  // What the last poll did, or why it failed.
  lastResult: z.string().optional(),
  lastError: z.string().optional(),
});
export type CalendarFeed = z.infer<typeof CalendarFeed>;

// A traveler's own details imported from elsewhere (TripIt's profile,
// loyalty programs and the people on its reservations), kept as labeled
// values so that nothing the source gave is dropped, whatever its shape.
export const ProfileField = z.object({ label: z.string(), value: z.string() });
export type ProfileField = z.infer<typeof ProfileField>;

export const ProfileEntry = z.object({ title: z.string(), fields: z.array(ProfileField) });
export type ProfileEntry = z.infer<typeof ProfileEntry>;

// users/{uid}/travelProfile/main. The parser writes the imported sections;
// the owner alone sets who else may read it (`trustedEmails`, lowercased
// verified emails, such as a spouse's), and nobody else writes anything.
// A loyalty membership read from one of the owner's booking emails
// (SPEC "Loyalty from emails"): kept beside what TripIt imported, so an
// upload does not drop it, and removable by the owner.
export const FoundLoyalty = ExtractedMembership.extend({
  // The email it was last seen in: its id and subject, and when.
  messageId: z.string().min(1),
  label: z.string().optional(),
  at: isoDateTime,
  // When the balance was as of (the email's sending time), and that
  // email's subject, kept with the balance when a later email without one
  // becomes `label`.
  balanceAt: isoDateTime.optional(),
  balanceLabel: z.string().optional(),
  // When the status was as of: the sending time of the email that gave it.
  statusAt: isoDateTime.optional(),
  // Whose it is, when the email named someone other than the owner.
  person: z.string().min(1).max(80).optional(),
});
export type FoundLoyalty = z.infer<typeof FoundLoyalty>;
export const maxFoundLoyalty = 50;

// Whom the owner says a membership belongs to, over what the email said:
// a name, or nobody for themself.
export const LoyaltyPerson = z.object({
  program: z.string().min(1),
  number: z.string().min(1),
  person: z.string().trim().min(1).max(80).optional(),
});
export type LoyaltyPerson = z.infer<typeof LoyaltyPerson>;
export const maxLoyaltyPeople = 100;

// Whether a membership number could be one: it has a digit, and is not a
// balance read as one ("9,600 Points").
export const isMembershipNumber = (number: string) =>
  /\d/.test(number) && !number.includes(",") && !/\b(points?|pts|miles?|credits?|nights?)\b/i.test(number);

// Entries that parse, the rest left out rather than the whole profile.
const parsedEach = <T>(schema: z.ZodType<T>, keep: (item: T) => boolean = () => true) =>
  z
    .array(z.unknown())
    .transform((entries) =>
      entries.flatMap((e) => {
        const parsed = schema.safeParse(e);
        return parsed.success && keep(parsed.data) ? [parsed.data] : [];
      }),
    )
    .optional();

export const TravelProfile = z.object({
  ownerUid: z.string().min(1),
  ownerEmail: z.string().optional(),
  trustedEmails: z.array(z.string()).default([]),
  travelers: z.array(ProfileEntry).default([]),
  loyalty: z.array(ProfileEntry).default([]),
  documents: z.array(ProfileEntry).default([]),
  // An entry that does not parse is left out, not the whole profile.
  foundLoyalty: parsedEach(FoundLoyalty, (f) => isMembershipNumber(f.number)),
  loyaltyPeople: parsedEach(LoyaltyPerson),
  importedAt: isoDateTime.optional(),
  updatedAt: isoDateTime.optional(),
});
export type TravelProfile = z.infer<typeof TravelProfile>;

// A subscribable calendar of the owner's trips: anyone with the link can
// read it, so it can be replaced (old link dead) or turned off.
export const CalendarExport = z.object({
  token: z.string().min(20),
  createdAt: isoDateTime,
});
export type CalendarExport = z.infer<typeof CalendarExport>;
