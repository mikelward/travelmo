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

// Where a booking came from: an email, a hand entry, a TripIt export or a
// calendar file.
export const SegmentSource = z.enum(["gmail", "manual", "tripit", "ics"]);
export type SegmentSource = z.infer<typeof SegmentSource>;

// One place a booking came from: the email, TripIt item or calendar event
// it was read from. A booking found again elsewhere keeps the new source
// too, so a dropped duplicate (perhaps a second room after all) is one
// click away, as is anything the extraction left out.
export const SourceRef = z.object({
  kind: z.enum(["gmail", "tripit", "ics"]),
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

export const UserProfile = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  photoURL: z.string().optional(),
  gmail: GmailConnection.optional(),
  googleCalendar: GoogleCalendarConnection.optional(),
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
  source: z.enum(["gmail", "tripit", "ics"]).optional(),
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
