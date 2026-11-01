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
  sharedWith: z.array(z.string()).default([]),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Trip = z.infer<typeof Trip>;

export const GmailState = z.object({
  historyId: z.string().optional(),
  watchExpiration: isoDateTime.optional(),
  emailAddress: z.string().optional(),
});
export type GmailState = z.infer<typeof GmailState>;

export const ParsedMessage = z.object({
  messageId: z.string().min(1),
  uid: z.string().min(1),
  outcome: z.enum(["filtered", "not_booking", "imported", "failed"]),
  reason: z.string().optional(),
  segmentIds: z.array(z.string()).default([]),
  processedAt: isoDateTime,
});
export type ParsedMessage = z.infer<typeof ParsedMessage>;
