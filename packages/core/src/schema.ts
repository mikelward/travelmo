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

export const SegmentSource = z.enum(["gmail", "manual"]);

export const Segment = ExtractedSegment.extend({
  id: z.string().min(1),
  tripId: z.string().min(1),
  source: SegmentSource,
  gmailMessageIds: z.array(z.string()).default([]),
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
export const GmailConnection = z.object({
  emailAddress: z.string(),
  connectedAt: isoDateTime,
  watchExpiration: isoDateTime.optional(),
  historyId: z.string().optional(),
});
export type GmailConnection = z.infer<typeof GmailConnection>;

export const UserProfile = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  photoURL: z.string().optional(),
  gmail: GmailConnection.optional(),
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

export const ParsedMessage = z.object({
  messageId: z.string().min(1),
  uid: z.string().min(1),
  outcome: z.enum(["processing", "filtered", "not_booking", "imported", "failed"]),
  reason: z.string().optional(),
  // Enough of the email to recognize it in a review list.
  from: z.string().optional(),
  subject: z.string().optional(),
  segmentIds: z.array(z.string()).default([]),
  processedAt: isoDateTime,
});
export type ParsedMessage = z.infer<typeof ParsedMessage>;
