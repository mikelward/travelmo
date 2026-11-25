import { describe, expect, it } from "vitest";
import { mergeBookings, mergedBookingOf } from "./mergeBookings";
import type { Segment } from "./schema";

const at = "2026-11-25T10:00:00.000Z";
const reservation: Segment = {
  id: "m1-0",
  tripId: "t",
  type: "car_rental",
  title: "Avis Boston Logan Intl Airport",
  start: "2026-11-24T17:30:00-05:00",
  end: "2026-11-29T17:30:00-05:00",
  provider: "Avis",
  confirmation: "20874163US2",
  origin: { name: "Boston Logan Intl Airport", code: "BOS" },
  source: "gmail",
  gmailMessageIds: ["m1"],
  sources: [{ kind: "gmail", id: "m1", uid: "u", at }],
  createdAt: at,
  updatedAt: at,
};
const agreement: Segment = {
  id: "m2-0",
  tripId: "t",
  type: "car_rental",
  title: "Avis Car Rental East Boston",
  start: "2026-11-24T18:15:00-05:00",
  confirmation: "708843612",
  notes: "Rental agreement",
  source: "gmail",
  gmailMessageIds: ["m2"],
  sources: [{ kind: "gmail", id: "m2", uid: "u", at }],
  rating: 4,
  createdAt: at,
  updatedAt: at,
};

describe("mergeBookings", () => {
  it("keeps the booking chosen, filling in only what the other knew, with both sources", () => {
    const merged = mergeBookings(reservation, agreement, "2026-11-25T12:00:00.000Z");
    expect(merged).toMatchObject({
      id: "m1-0",
      title: "Avis Boston Logan Intl Airport",
      start: "2026-11-24T17:30:00-05:00",
      confirmation: "20874163US2",
      rating: 4,
      notes: "Rental agreement\nOther reference: 708843612",
      gmailMessageIds: ["m1", "m2"],
      mergedFrom: ["m2-0"],
      editedAt: "2026-11-25T12:00:00.000Z",
    });
    // What the other said, for its emails read again (mergedBookingOf); not another rental.
    expect(merged.mergedBookings).toEqual([{ type: "car_rental", title: agreement.title, start: agreement.start, confirmation: "708843612" }]);
    const same = { type: "car_rental" as const, title: "Avis rental", start: agreement.start, confirmation: "708843612" };
    expect(mergedBookingOf(merged, same, new Set())).toBe(0);
    // Once another item has claimed it, not again; nor another rental.
    expect(mergedBookingOf(merged, same, new Set([0]))).toBeUndefined();
    expect(mergedBookingOf(merged, { ...same, start: "2026-12-20T09:00:00-05:00", confirmation: "999" }, new Set())).toBeUndefined();
    expect(merged.sources?.map((s) => s.id)).toEqual(["m1", "m2"]);
  });
  it("remembers every booking merged in, across merges, and says a note once", () => {
    const third = { ...agreement, id: "m3-0", mergedFrom: ["m4-0"], notes: "Other reference: 708843612" };
    const merged = mergeBookings(mergeBookings(reservation, agreement, at), third, at);
    expect(merged.mergedFrom).toEqual(["m2-0", "m3-0", "m4-0"]);
    expect(merged.notes).toBe("Rental agreement\nOther reference: 708843612");
  });
  it("keeps the Restore of either, so a cancellation taken back stays taken back", () => {
    const merged = mergeBookings(
      { ...reservation, restoredFrom: ["c1"], restoredAt: "2026-11-20T10:00:00.000Z" },
      { ...agreement, restoredFrom: ["c2"], restoredAt: "2026-11-22T10:00:00.000Z" },
      at,
    );
    expect(merged.restoredFrom).toEqual(["c1", "c2"]);
    expect(merged.restoredAt).toBe("2026-11-22T10:00:00.000Z");
    const kept = mergeBookings({ ...reservation, restoredAt: "2026-11-22T10:00:00.000Z" }, { ...agreement, restoredAt: "2026-11-20T10:00:00.000Z" }, at);
    expect(kept.restoredAt).toBe("2026-11-22T10:00:00.000Z");
    expect(kept.restoredFrom).toBeUndefined();
  });
  it("keeps as many travelers as a booking holds", () => {
    const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} ${String.fromCharCode(65 + i)}lderson`);
    const merged = mergeBookings({ ...reservation, travelers: many("Ann", 20) }, { ...agreement, travelers: many("Bob", 5) }, at);
    expect(merged.travelers).toHaveLength(20);
  });
});
