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

export const ExtractedBooking = z.object({
  isBooking: z.boolean(),
  segments: z.array(ExtractedSegment),
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
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Trip = z.infer<typeof Trip>;

// What the web client may see about a Gmail connection; the refresh token
// stays in the server-only GmailState document.
// How far a reading of the whole mailbox has got: it runs in batches, each
// carrying on from Gmail's page cursor, so it survives closing the page.
export const BackfillProgress = z.object({
  cursor: z.string().optional(),
  scanned: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  // Emails whose import failed in this reading; starting over tries them again.
  failed: z.number().int().nonnegative().optional(),
  done: z.boolean(),
  updatedAt: isoDateTime,
});
export type BackfillProgress = z.infer<typeof BackfillProgress>;

export const GmailConnection = z.object({
  emailAddress: z.string(),
  connectedAt: isoDateTime,
  watchExpiration: isoDateTime.optional(),
  historyId: z.string().optional(),
  backfill: BackfillProgress.optional(),
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

export const UserProfile = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  photoURL: z.string().optional(),
  gmail: GmailConnection.optional(),
  googleCalendar: GoogleCalendarConnection.optional(),
  reminders: ReminderSettings.optional(),
  forward: ForwardAddress.optional(),
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
  outcome: z.enum(["processing", "filtered", "not_booking", "imported", "failed"]),
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
});
export type ParsedMessage = z.infer<typeof ParsedMessage>;

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
export const TravelProfile = z.object({
  ownerUid: z.string().min(1),
  ownerEmail: z.string().optional(),
  trustedEmails: z.array(z.string()).default([]),
  travelers: z.array(ProfileEntry).default([]),
  loyalty: z.array(ProfileEntry).default([]),
  documents: z.array(ProfileEntry).default([]),
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
