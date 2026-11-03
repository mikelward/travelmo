import {
  NotATripItExport,
  extractTripItProfile,
  parseTripItExport,
  summarizeTripIt,
  type SegmentType,
  type TripItImport,
} from "@travelmo/core";

const plural: Record<SegmentType, [string, string]> = {
  flight: ["flight", "flights"],
  train: ["train", "trains"],
  bus: ["bus", "buses"],
  ferry: ["ferry", "ferries"],
  lodging: ["stay", "stays"],
  car_rental: ["car rental", "car rentals"],
  activity: ["activity", "activities"],
  other: ["other booking", "other bookings"],
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type TripItPreview = { parsed: TripItImport; json: unknown; text: string; hasProfile: boolean };

// Reads the uploaded file entirely in the browser: nothing is sent until the
// user has seen this and pressed Import.
export function previewTripIt(fileText: string): TripItPreview {
  let json: unknown;
  try {
    json = JSON.parse(fileText);
  } catch {
    throw new NotATripItExport("This file is not JSON, so it is not a TripIt export.");
  }
  const parsed = parseTripItExport(json);
  const s = summarizeTripIt(parsed);
  const types = (Object.entries(s.byType) as [SegmentType, number][])
    .sort(([, a], [, b]) => b - a)
    .map(([type, n]) => count(n, ...plural[type]));
  const parts = [
    `${count(s.trips, "trip", "trips")} with ${count(s.bookings, "booking", "bookings")}${types.length ? ` (${types.join(", ")})` : ""}`,
  ];
  if (s.first && s.last) parts.push(`from ${s.first} to ${s.last}`);
  let text = `${parts.join(", ")}.`;
  if (s.unfiled) text += ` ${count(s.unfiled, "booking", "bookings")} TripIt never filed into a trip will go into "Unfiled from TripIt".`;
  if (s.skipped) text += ` ${count(s.skipped, "item", "items")} can't be imported (listed below).`;
  const profile = extractTripItProfile(json);
  const profileParts = [
    profile.documents.length ? count(profile.documents.length, "profile or document entry", "profile and document entries") : undefined,
    profile.loyalty.length ? count(profile.loyalty.length, "loyalty program", "loyalty programs") : undefined,
    profile.travelers.length ? count(profile.travelers.length, "traveler", "travelers") : undefined,
  ].filter(Boolean);
  if (profileParts.length) text += ` Your travel profile gets ${profileParts.join(", ")}.`;
  if (profile.truncated) text += " Some of the profile is too large to keep and will be left out.";
  return { parsed, json, text, hasProfile: profileParts.length > 0 };
}

export type TripItResult = {
  trips: number;
  imported: number;
  duplicates: number;
  skipped: number;
  failed: number;
  notImported: number;
  travelers?: number;
  loyaltyPrograms?: number;
  documents?: number;
};

export function describeTripItResult(r: TripItResult): string {
  const parts = [`Imported ${count(r.imported, "booking", "bookings")} into ${count(r.trips, "new or existing trip", "new or existing trips")}`];
  if (r.duplicates) parts.push(`${count(r.duplicates, "booking was", "bookings were")} already there`);
  if (r.skipped) parts.push(`${count(r.skipped, "item was", "items were")} imported before`);
  if (r.failed) parts.push(`${count(r.failed, "item", "items")} failed; try the upload again`);
  if (r.travelers || r.loyaltyPrograms || r.documents) parts.push("your travel profile was updated (see Profile)");
  return `${parts.join("; ")}.`;
}
