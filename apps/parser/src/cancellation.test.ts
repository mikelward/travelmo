import type { ExtractedBooking } from "@travelmo/core";
import type { EmailMessage } from "./gmail";
import { importMessage, type ImportDeps, type TripStore } from "./importer";
import { memoryStore } from "./testStore";

// An invented Stockholm stay booked through a booking site, and the email
// cancelling it, in the shape the model returns.
const email = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  id: "m1",
  threadId: "t1",
  from: "Booking.com <noreply@booking.example>",
  subject: "Your booking is confirmed at Example Hotel Gamla Stan",
  date: "Fri, 1 May 2026 10:00:00 +0000",
  listUnsubscribe: false,
  text: "Booking number 1234.567.890. Check-in 10 June, check-out 13 June.",
  ...over,
});

const confirmation: ExtractedBooking = {
  isBooking: true,
  segments: [
    {
      type: "lodging",
      title: "Example Hotel Gamla Stan",
      provider: "Booking.com",
      confirmation: "1234.567.890",
      start: "2026-06-10T15:00:00+02:00",
      end: "2026-06-13T11:00:00+02:00",
      destination: { name: "Example Hotel Gamla Stan", city: "Stockholm", country: "SE" },
    },
  ],
};

const cancellation = (confirmationNumber: string): ExtractedBooking => ({
  isBooking: false,
  segments: [],
  cancellations: [
    {
      type: "lodging",
      provider: "Booking.com",
      confirmation: confirmationNumber,
      place: "Example Hotel Gamla Stan",
      start: "2026-06-10T15:00:00+02:00",
      end: "2026-06-13T11:00:00+02:00",
    },
  ],
});

const cancelEmail = email({ id: "m2", subject: "Booking cancelled for Example Hotel Gamla Stan", text: "Your booking 1234567890 is cancelled." });

let clock = "2026-05-01T12:00:00Z";
function deps(store: TripStore, extract: ImportDeps["extract"]): ImportDeps {
  return { store, extract, now: () => clock, log: () => {} };
}

describe("cancellation emails", () => {
  it("mark the booking they name as cancelled, keeping it on its trip", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    expect(await importMessage("u1", email(), deps(store, async () => confirmation))).toBe("imported");
    clock = "2026-05-20T08:00:00Z";
    expect(await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")))).toBe("cancellation");

    const [segment] = [...store.segments.values()];
    expect(segment).toMatchObject({ id: "m1-0", cancelledAt: "2026-05-20T08:00:00Z", cancelledBy: "m2", updatedAt: "2026-05-20T08:00:00Z" });
    expect(store.trips.size).toBe(1);
    expect([...store.trips.values()][0]!.updatedAt).toBe("2026-05-20T08:00:00Z");
    expect(store.parsed.get("u1/m2")).toMatchObject({
      outcome: "cancellation",
      reason: "cancelled 1 booking",
      segmentIds: ["m1-0"],
      subject: "Booking cancelled for Example Hotel Gamla Stan",
    });
  });

  it("show the trip's end as what is still booked when the cancelled booking alone reached it", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    const flightAndStay: ExtractedBooking = {
      isBooking: true,
      segments: [
        { type: "flight", title: "SK 1530 LHR to ARN", start: "2026-06-10T08:00:00+01:00", end: "2026-06-10T11:30:00+02:00", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "Arlanda", code: "ARN" } },
        ...confirmation.segments,
      ],
    };
    await importMessage("u1", email(), deps(store, async () => flightAndStay));
    const [trip] = [...store.trips.values()];
    expect(trip).toMatchObject({ start: "2026-06-10", end: "2026-06-13" });
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")));
    expect(store.trips.get(trip!.id)).toMatchObject({ start: "2026-06-10", end: "2026-06-13", liveStart: "2026-06-10", liveEnd: "2026-06-10", updatedAt: clock });
  });

  it("show the trip's end as what is still booked when a later email shows a waiting cancellation names its booking", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    // The stay first known without its reference, so the cancellation, by
    // reference alone, waits; the confirmation then gives the reference.
    const { confirmation: _ref, ...unreferenced } = confirmation.segments[0]!;
    const flight = { type: "flight" as const, title: "SK 1530 LHR to ARN", start: "2026-06-10T08:00:00+01:00", end: "2026-06-10T11:30:00+02:00", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "Arlanda", code: "ARN" } };
    await importMessage("u1", email({ id: "m0", date: "Thu, 30 Apr 2026 10:00:00 +0000" }), deps(store, async () => ({ isBooking: true, segments: [flight, unreferenced] })));
    const [trip] = [...store.trips.values()];
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "1234567890" }] })));
    expect(store.trips.get(trip!.id)).toMatchObject({ start: "2026-06-10", end: "2026-06-13" });
    await importMessage("u1", email(), deps(store, async () => confirmation));
    expect([...store.segments.values()].find((s) => s.type === "lodging")?.cancelledBy).toBe("m2");
    expect(store.trips.get(trip!.id)).toMatchObject({ start: "2026-06-10", end: "2026-06-13", liveStart: "2026-06-10", liveEnd: "2026-06-10" });
  });

  it("show the trip's end as what is still booked when the email being filed into it shows one of its bookings cancelled", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    const { confirmation: _ref, ...unreferenced } = confirmation.segments[0]!;
    const flight = { type: "flight" as const, title: "SK 1530 LHR to ARN", start: "2026-06-10T08:00:00+01:00", end: "2026-06-10T11:30:00+02:00", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "Arlanda", code: "ARN" } };
    await importMessage("u1", email({ id: "m0", date: "Thu, 30 Apr 2026 10:00:00 +0000" }), deps(store, async () => ({ isBooking: true, segments: [flight, unreferenced] })));
    const [trip] = [...store.trips.values()];
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "1234567890" }] })));
    // The stay's confirmation, with a museum visit new to the trip: filed into it.
    const tour = { type: "activity" as const, title: "Example Museum tour", start: "2026-06-11T10:00:00+02:00", destination: { name: "Example Museum", city: "Stockholm", country: "SE" } };
    await importMessage("u1", email(), deps(store, async () => ({ isBooking: true, segments: [...confirmation.segments, tour] })));
    expect([...store.segments.values()].find((s) => s.type === "activity")?.tripId).toBe(trip!.id);
    expect([...store.segments.values()].find((s) => s.type === "lodging")?.cancelledBy).toBe("m2");
    expect(store.trips.get(trip!.id)).toMatchObject({ start: "2026-06-10", end: "2026-06-13", liveStart: "2026-06-10", liveEnd: "2026-06-11" });
  });

  it("find a cancelled booking far from what is still booked when it is confirmed again, and revive it", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    // London in June and Paris in August, booked together; Paris cancelled.
    const london = { type: "lodging" as const, title: "Example Hotel London", confirmation: "LON-1", start: "2026-06-01T15:00:00+01:00", end: "2026-06-03T11:00:00+01:00", destination: { name: "Example Hotel London", city: "London", country: "GB" } };
    const paris = { type: "lodging" as const, title: "Example Hotel Paris", confirmation: "PAR-1", start: "2026-08-10T15:00:00+02:00", end: "2026-08-15T11:00:00+02:00", destination: { name: "Example Hotel Paris", city: "Paris", country: "FR" } };
    await importMessage("u1", email({ id: "b1", date: "Fri, 1 May 2026 09:00:00 +0000" }), deps(store, async () => ({ isBooking: true, segments: [london, paris] })));
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", email({ id: "x1", subject: "Booking cancelled", date: "Wed, 20 May 2026 08:00:00 +0000" }), deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "PAR-1" }] })));
    const [trip] = [...store.trips.values()];
    expect(trip).toMatchObject({ start: "2026-06-01", end: "2026-08-15", liveStart: "2026-06-01", liveEnd: "2026-06-03" });
    // Paris booked again, by a confirmation sent after the cancellation.
    clock = "2026-05-25T08:00:00Z";
    await importMessage("u1", email({ id: "b2", date: "Mon, 25 May 2026 08:00:00 +0000" }), deps(store, async () => ({ isBooking: true, segments: [paris] })));
    expect(store.trips.size).toBe(1);
    expect(store.segments.size).toBe(2);
    expect([...store.segments.values()].find((s) => s.confirmation === "PAR-1")?.cancelledAt).toBeUndefined();
    const revived = store.trips.get(trip!.id)!;
    expect(revived).toMatchObject({ start: "2026-06-01", end: "2026-08-15" });
    expect(revived.liveStart).toBeUndefined();
    expect(revived.liveEnd).toBeUndefined();
  });

  it("file a booking a cancellation already named inside its trip's dates, so a later confirmation finds it", async () => {
    const store = memoryStore();
    const london = { type: "lodging" as const, title: "Example Hotel London", confirmation: "LON-1", start: "2026-06-01T15:00:00+01:00", end: "2026-06-03T11:00:00+01:00", destination: { name: "Example Hotel London", city: "London", country: "GB" } };
    const paris = { type: "lodging" as const, title: "Example Hotel Paris", confirmation: "PAR-1", start: "2026-08-10T15:00:00+02:00", end: "2026-08-15T11:00:00+02:00", destination: { name: "Example Hotel Paris", city: "Paris", country: "FR" } };
    // The mailbox read newest first: Paris's cancellation before the booking.
    clock = "2026-05-21T08:00:00Z";
    await importMessage("u1", email({ id: "x1", subject: "Booking cancelled", date: "Wed, 20 May 2026 08:00:00 +0000" }), deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "PAR-1" }] })));
    await importMessage("u1", email({ id: "b1", date: "Fri, 1 May 2026 09:00:00 +0000" }), deps(store, async () => ({ isBooking: true, segments: [london, paris] })));
    const [trip] = [...store.trips.values()];
    expect(trip).toMatchObject({ start: "2026-06-01", end: "2026-08-15", liveStart: "2026-06-01", liveEnd: "2026-06-03" });
    // Paris booked again, by a confirmation sent after the cancellation.
    clock = "2026-05-25T08:00:00Z";
    await importMessage("u1", email({ id: "b2", date: "Mon, 25 May 2026 08:00:00 +0000" }), deps(store, async () => ({ isBooking: true, segments: [paris] })));
    expect(store.trips.size).toBe(1);
    expect(store.segments.size).toBe(2);
    expect([...store.segments.values()].find((s) => s.confirmation === "PAR-1")?.cancelledAt).toBeUndefined();
  });

  it("don't let a cancelled booking's dates draw other travel into its trip", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    const london = { type: "lodging" as const, title: "Example Hotel London", confirmation: "LON-1", start: "2026-06-01T15:00:00+01:00", end: "2026-06-03T11:00:00+01:00", destination: { name: "Example Hotel London", city: "London", country: "GB" } };
    const paris = { type: "lodging" as const, title: "Example Hotel Paris", confirmation: "PAR-1", start: "2026-06-20T15:00:00+02:00", end: "2026-06-26T11:00:00+02:00", destination: { name: "Example Hotel Paris", city: "Paris", country: "FR" } };
    await importMessage("u1", email({ id: "b1" }), deps(store, async () => ({ isBooking: true, segments: [london, paris] })));
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", email({ id: "x1", subject: "Booking cancelled" }), deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "PAR-1" }] })));
    const [trip] = [...store.trips.values()];
    expect(trip).toMatchObject({ start: "2026-06-01", end: "2026-06-26", liveStart: "2026-06-01", liveEnd: "2026-06-03" });
    // Rome late in June: no part of the London trip the person still takes.
    const rome = { type: "lodging" as const, title: "Example Hotel Roma", confirmation: "ROM-1", start: "2026-06-25T15:00:00+02:00", end: "2026-06-27T11:00:00+02:00", destination: { name: "Example Hotel Roma", city: "Rome", country: "IT" } };
    await importMessage("u1", email({ id: "b3" }), deps(store, async () => ({ isBooking: true, segments: [rome] })));
    expect(store.segments.get("b3-0")!.tripId).not.toBe(trip!.id);
  });

  it("reach the cancellation handling from a sender not allowed, without forcing", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    await importMessage("u1", email(), deps(store, async () => confirmation));
    clock = "2026-05-20T08:00:00Z";
    const hotel = email({ id: "m2", from: "Example Hotel <stay@hotel.example>", subject: "Cancellation: Gamla Stan, 10 June" });
    expect(await importMessage("u1", hotel, deps(store, async () => cancellation("1234567890")))).toBe("cancellation");
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
  });

  it("change nothing when the email is read again", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    await importMessage("u1", email(), deps(store, async () => confirmation));
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")));
    clock = "2026-05-21T08:00:00Z";
    expect(await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")), { force: true, reclaim: true })).toBe("cancellation");

    expect([...store.segments.values()][0]).toMatchObject({ cancelledAt: "2026-05-20T08:00:00Z", updatedAt: "2026-05-20T08:00:00Z" });
    expect(store.parsed.get("u1/m2")?.reason).toBe("cancelled 1 booking");
  });

  it("cancel a booking imported after them, as a mailbox read newest first does", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    expect(await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")))).toBe("cancellation");
    expect(store.parsed.get("u1/m2")?.reason).toBe("no matching booking found");
    expect(store.pending.get("u1/m2")?.cancellations).toHaveLength(1);

    clock = "2026-05-21T08:00:00Z";
    expect(await importMessage("u1", email(), deps(store, async () => confirmation))).toBe("imported");
    expect([...store.segments.values()][0]).toMatchObject({ id: "m1-0", cancelledAt: "2026-05-21T08:00:00Z", cancelledBy: "m2" });
    expect(store.pending.size).toBe(1);
    expect(store.parsed.get("u1/m2")).toMatchObject({ outcome: "cancellation", reason: "cancelled 1 booking", segmentIds: ["m1-0"] });
  });

  it("cancel every leg under the reference that arrives after them", async () => {
    const leg = (n: number, start: string, end: string, origin: string, destination: string): ExtractedBooking => ({
      isBooking: true,
      segments: [
        {
          type: "flight",
          title: `Example Air ${n} ${origin} to ${destination}`,
          provider: "Example Air",
          confirmation: "XQ7P2L",
          start,
          end,
          origin: { name: origin, code: origin },
          destination: { name: destination, code: destination },
        },
      ],
    });
    const flightCancellation: ExtractedBooking = {
      isBooking: false,
      segments: [],
      cancellations: [{ type: "flight", provider: "Example Air", confirmation: "XQ7P2L" }],
    };
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    expect(await importMessage("u1", cancelEmail, deps(store, async () => flightCancellation))).toBe("cancellation");
    clock = "2026-05-21T08:00:00Z";
    await importMessage("u1", email({ id: "m3" }), deps(store, async () => leg(11, "2026-06-10T08:00:00+01:00", "2026-06-10T11:30:00+02:00", "LHR", "ARN")));
    await importMessage("u1", email({ id: "m4" }), deps(store, async () => leg(12, "2026-06-13T12:00:00+02:00", "2026-06-13T13:40:00+01:00", "ARN", "LHR")));

    const segments = [...store.segments.values()];
    expect(segments).toHaveLength(2);
    for (const segment of segments) expect(segment).toMatchObject({ cancelledBy: "m2", cancelledAt: "2026-05-21T08:00:00Z" });
    expect(store.parsed.get("u1/m2")).toMatchObject({ reason: "cancelled 2 bookings", segmentIds: ["m3-0", "m4-0"] });
  });

  it("file a booking they name inside the trip's dates, shown by what is still booked", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", email(), deps(store, async () => confirmation));
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "flight", confirmation: "XQ7P2L" }] })));
    const flight: ExtractedBooking = {
      isBooking: true,
      segments: [
        {
          type: "flight",
          title: "Example Air 12 ARN to LHR",
          confirmation: "XQ7P2L",
          start: "2026-06-14T12:00:00+02:00",
          end: "2026-06-14T13:40:00+01:00",
          origin: { name: "ARN", code: "ARN" },
          destination: { name: "LHR", code: "LHR" },
        },
      ],
    };
    await importMessage("u1", email({ id: "m3" }), deps(store, async () => flight));
    const filed = [...store.segments.values()].find((s) => s.id === "m3-0")!;
    expect(filed.cancelledBy).toBe("m2");
    const trip = [...store.trips.values()].find((t) => t.id === filed.tripId)!;
    expect(store.trips.size).toBe(1);
    expect(trip).toMatchObject({ start: "2026-06-10", end: "2026-06-14", liveStart: "2026-06-10", liveEnd: "2026-06-13" });
  });

  it("widen a trip's own dates, not those it is shown with, when another email fills out a cancelled booking", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    const noEnd: ExtractedBooking = { ...confirmation, segments: confirmation.segments.map(({ end: _, ...s }) => s) };
    await importMessage("u1", email(), deps(store, async () => noEnd));
    await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")));
    // The same booking again, now with its check-out: merged into the cancelled one.
    expect(await importMessage("u1", email({ id: "m3" }), deps(store, async () => confirmation))).toBe("imported");
    expect(store.segments.size).toBe(1);
    expect([...store.segments.values()][0]).toMatchObject({ end: "2026-06-13T11:00:00+02:00", cancelledBy: "m2" });
    expect([...store.trips.values()]).toMatchObject([{ start: "2026-06-10", end: "2026-06-13" }]);
  });

  it("cancel a booking once a later email fills in the reference a cancellation named", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "1234567890" }] })));
    const unnumbered: ExtractedBooking = { ...confirmation, segments: confirmation.segments.map(({ confirmation: _, ...s }) => s) };
    await importMessage("u1", email(), deps(store, async () => unnumbered));
    expect([...store.segments.values()][0]?.cancelledAt).toBeUndefined();
    // The same stay again, now with its booking number: merged, and cancelled.
    expect(await importMessage("u1", email({ id: "m3" }), deps(store, async () => confirmation))).toBe("imported");
    expect(store.segments.size).toBe(1);
    expect([...store.segments.values()][0]).toMatchObject({ id: "m1-0", confirmation: "1234.567.890", cancelledBy: "m2" });
    expect(store.parsed.get("u1/m2")).toMatchObject({ reason: "cancelled 1 booking", segmentIds: ["m1-0"] });
  });

  it("leave a booking filled in by an email sent after the cancellation live", async () => {
    const store = memoryStore();
    clock = "2026-05-26T08:00:00Z";
    const cancelSent = email({ id: "m2", subject: "Booking cancelled", date: "Wed, 20 May 2026 08:00:00 +0000" });
    await importMessage("u1", cancelSent, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "1234567890" }] })));
    const unnumbered: ExtractedBooking = { ...confirmation, segments: confirmation.segments.map(({ confirmation: _, ...s }) => s) };
    await importMessage("u1", email(), deps(store, async () => unnumbered));
    await importMessage("u1", email({ id: "m3", date: "Mon, 25 May 2026 09:00:00 +0000" }), deps(store, async () => confirmation));
    expect(store.segments.size).toBe(1);
    expect([...store.segments.values()][0]?.cancelledAt).toBeUndefined();
  });

  it("bring a cancelled booking back when an email sent after the cancellation confirms it again", async () => {
    const store = memoryStore();
    clock = "2026-05-26T08:00:00Z";
    const cancelSent = email({ id: "m2", subject: "Booking cancelled", date: "Wed, 20 May 2026 08:00:00 +0000" });
    // 1 May confirmation, then the 20 May cancellation: cancelled.
    await importMessage("u1", email(), deps(store, async () => confirmation));
    await importMessage("u1", cancelSent, deps(store, async () => cancellation("1234567890")));
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
    // 25 May, booked again under the same number: live again.
    expect(await importMessage("u1", email({ id: "m3", date: "Mon, 25 May 2026 09:00:00 +0000" }), deps(store, async () => confirmation))).toBe("imported");
    expect(store.segments.size).toBe(1);
    expect(store.segments.get("m1-0")?.cancelledAt).toBeUndefined();
    // The same three read newest first end the same way.
    const newestFirst = memoryStore();
    await importMessage("u1", email({ id: "m3", date: "Mon, 25 May 2026 09:00:00 +0000" }), deps(newestFirst, async () => confirmation));
    await importMessage("u1", cancelSent, deps(newestFirst, async () => cancellation("1234567890")));
    await importMessage("u1", email(), deps(newestFirst, async () => confirmation));
    expect(newestFirst.segments.size).toBe(1);
    expect([...newestFirst.segments.values()][0]?.cancelledAt).toBeUndefined();
  });

  describe("and a payment receipt a booking upgrades", () => {
    const provider = "Example Academy of Performing Arts";
    const receipt: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Stage Stars Holiday Club payment", provider, start: "2026-12-14T00:00:00+00:00" }],
    };
    const club: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Stage Stars! Holiday Club - Day 1", provider, start: "2026-12-21T09:00:00+00:00", end: "2026-12-21T15:00:00+00:00" }],
    };
    const cancelling = (start: string, place: string): ExtractedBooking => ({ isBooking: false, segments: [], cancellations: [{ type: "activity", provider, place, start }] });

    it("cancel the upgraded booking for a cancellation already read", async () => {
      const store = memoryStore();
      await importMessage("u1", email({ id: "m-paid" }), deps(store, async () => receipt));
      await importMessage("u1", cancelEmail, deps(store, async () => cancelling("2026-12-21T09:00:00+00:00", "Stage Stars Holiday Club")));
      expect(store.segments.get("m-paid-0")?.cancelledAt).toBeUndefined();
      await importMessage("u1", email({ id: "m-club" }), deps(store, async () => club));
      expect(store.segments.get("m-paid-0")).toMatchObject({ title: "Stage Stars! Holiday Club - Day 1", cancelledBy: "m2" });
      expect(store.parsed.get("u1/m2")).toMatchObject({ reason: "cancelled 1 booking", segmentIds: ["m-paid-0"] });
    });

    it("keep a cancelled receipt cancelled, and unedited, and file the booking beside it", async () => {
      const store = memoryStore();
      await importMessage("u1", email({ id: "m-paid" }), deps(store, async () => receipt));
      await importMessage("u1", cancelEmail, deps(store, async () => cancelling("2026-12-14T00:00:00+00:00", "Stage Stars Holiday Club")));
      const cancelled = store.segments.get("m-paid-0")!;
      expect(cancelled.cancelledBy).toBe("m2");
      // Marked by an import, not edited by the user: still replaceable.
      expect(cancelled.updatedAt).toBe(cancelled.createdAt);
      // A cancelled booking is never upgraded or revived by another email
      // without the same number: the club is a booking of its own.
      await importMessage("u1", email({ id: "m-club" }), deps(store, async () => club));
      expect(store.segments.get("m-paid-0")).toMatchObject({ title: "Stage Stars Holiday Club payment", cancelledBy: "m2" });
      expect(store.segments.get("m-club-0")?.cancelledAt).toBeUndefined();
    });
  });

  describe("and forwarded emails", () => {
    // A confirmation forwarded on 25 May: the original was sent on 1 May.
    const forwarded = (id: string, originalDate: string) =>
      email({
        id,
        from: "Me <me@example.com>",
        subject: "Fwd: Your booking is confirmed at Example Hotel Gamla Stan",
        date: "Mon, 25 May 2026 09:00:00 +0000",
        text: `FYI\n\n---------- Forwarded message ---------\nFrom: Booking.com <noreply@booking.example>\n${originalDate}\nSubject: Your booking is confirmed\n\nBooking number 1234.567.890.`,
      });
    const cancelSent = email({ id: "m2", subject: "Booking cancelled", date: "Wed, 20 May 2026 08:00:00 +0000" });

    it("date a forward by its original, so an old confirmation forwarded later is still cancelled", async () => {
      const store = memoryStore();
      clock = "2026-05-26T08:00:00Z";
      await importMessage("u1", cancelSent, deps(store, async () => cancellation("1234567890")));
      await importMessage("u1", forwarded("m-fwd", "Date: Fri, May 1, 2026 at 10:00 AM"), { ...deps(store, async () => confirmation) }, { source: "forward" });
      expect(store.segments.get("m-fwd-0")?.cancelledBy).toBe("m2");
      expect(store.segments.get("m-fwd-0")?.sources?.[0]?.sentAt).toBe("2026-05-01T10:00:00.000Z");
    });

    it("order a forward with no readable original date against nothing", async () => {
      const store = memoryStore();
      clock = "2026-05-26T08:00:00Z";
      // Read first, it doesn't protect the booking from the older cancellation...
      await importMessage("u1", forwarded("m-fwd", "To: me@example.com"), deps(store, async () => confirmation), { source: "forward" });
      expect(store.segments.get("m-fwd-0")?.sources?.[0]?.sentAt).toBeUndefined();
      await importMessage("u1", cancelSent, deps(store, async () => cancellation("1234567890")));
      expect(store.segments.get("m-fwd-0")?.cancelledBy).toBe("m2");
      // ...and read after, it doesn't escape it either.
      const later = memoryStore();
      await importMessage("u1", cancelSent, deps(later, async () => cancellation("1234567890")));
      await importMessage("u1", forwarded("m-fwd", "To: me@example.com"), deps(later, async () => confirmation), { source: "forward" });
      expect(later.segments.get("m-fwd-0")?.cancelledBy).toBe("m2");
    });
  });

  it("keep a booking cancelled when a refund receipt sent after the cancellation is read", async () => {
    const store = memoryStore();
    clock = "2026-05-26T08:00:00Z";
    const cancelSent = email({ id: "m2", subject: "Booking cancelled", date: "Wed, 20 May 2026 08:00:00 +0000" });
    await importMessage("u1", email(), deps(store, async () => confirmation));
    await importMessage("u1", cancelSent, deps(store, async () => cancellation("1234567890")));
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
    // The hotel's refund receipt, sent later, read as the same stay.
    const refund = email({ id: "m3", subject: "Your refund receipt - Example Hotel Gamla Stan", date: "Mon, 25 May 2026 09:00:00 +0000" });
    await importMessage("u1", refund, deps(store, async () => confirmation));
    expect(store.segments.size).toBe(1);
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
    // Read before the cancellation, it doesn't shield the booking either.
    const first = memoryStore();
    await importMessage("u1", email(), deps(first, async () => confirmation));
    await importMessage("u1", refund, deps(first, async () => confirmation));
    await importMessage("u1", cancelSent, deps(first, async () => cancellation("1234567890")));
    expect(first.segments.get("m1-0")?.cancelledBy).toBe("m2");
  });

  it("keep a booking cancelled when a payment confirmation sent after the cancellation is read", async () => {
    const store = memoryStore();
    clock = "2026-05-26T08:00:00Z";
    const cancelSent = email({ id: "m2", subject: "Booking cancelled", date: "Wed, 20 May 2026 08:00:00 +0000" });
    await importMessage("u1", email(), deps(store, async () => confirmation));
    await importMessage("u1", cancelSent, deps(store, async () => cancellation("1234567890")));
    // Timed, titled as a payment, as the extraction prompt asks for one.
    const paid: ExtractedBooking = { ...confirmation, segments: confirmation.segments.map((s) => ({ ...s, title: "Example Hotel Gamla Stan payment" })) };
    await importMessage("u1", email({ id: "m3", subject: "Payment confirmation", date: "Mon, 25 May 2026 09:00:00 +0000" }), deps(store, async () => paid));
    expect(store.segments.size).toBe(1);
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
  });

  it("file a show booked again under a new reference as a booking of its own", async () => {
    const show = (confirmation: string): ExtractedBooking => ({
      isBooking: true,
      segments: [
        {
          type: "activity",
          title: "Hamlet at the Example Theatre",
          provider: "Example Theatre",
          confirmation,
          start: "2026-06-10T19:30:00+01:00",
          destination: { name: "Example Theatre", city: "London", country: "GB" },
        },
      ],
    });
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", email(), deps(store, async () => show("FIRST-123")));
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "activity", confirmation: "FIRST-123" }] })));
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
    await importMessage("u1", email({ id: "m3" }), deps(store, async () => show("SECOND-456")));
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
    expect(store.segments.get("m3-0")).toMatchObject({ confirmation: "SECOND-456" });
    expect(store.segments.get("m3-0")?.cancelledAt).toBeUndefined();
  });

  it("attach an unreferenced refund receipt to the cancelled booking, still cancelled", async () => {
    const store = memoryStore();
    clock = "2026-05-26T08:00:00Z";
    const show: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "activity", title: "Hamlet at the Example Theatre", provider: "Example Theatre", confirmation: "ABC123", start: "2026-06-10T19:30:00+01:00" }],
    };
    await importMessage("u1", email(), deps(store, async () => show));
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "activity", confirmation: "ABC123" }] })));
    const receipt: ExtractedBooking = { isBooking: true, segments: [{ ...show.segments[0]!, confirmation: undefined, title: "Hamlet at the Example Theatre payment" }] };
    await importMessage("u1", email({ id: "m3", subject: "Refund receipt for your booking", date: "Mon, 25 May 2026 09:00:00 +0000" }), deps(store, async () => receipt));
    expect(store.segments.size).toBe(1);
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
    expect(store.segments.get("m1-0")?.sources?.map((s) => s.id)).toContain("m3");
  });

  describe("read in any order", () => {
    // One reference: confirmed 1 May, cancelled 10 May, booked again 15 May,
    // cancelled again 20 May. By date, it ends cancelled by the 20 May email.
    const sent = (day: string) => `${day} May 2026 09:00:00 +0000`;
    const emails = {
      confirmed: () => importMessage("u1", email({ id: "c01", date: sent("1") }), deps(store, async () => confirmation)),
      cancelled10: () => importMessage("u1", email({ id: "x10", subject: "Booking cancelled", date: sent("10") }), deps(store, async () => cancellation("1234567890"))),
      reconfirmed: () => importMessage("u1", email({ id: "c15", date: sent("15") }), deps(store, async () => confirmation)),
      cancelled20: () => importMessage("u1", email({ id: "x20", subject: "Booking cancelled", date: sent("20") }), deps(store, async () => cancellation("1234567890"))),
    };
    let store = memoryStore();
    const final = () => [...store.segments.values()].map((s) => s.cancelledBy ?? "live");
    const run = async (order: (keyof typeof emails)[]) => {
      store = memoryStore();
      clock = "2026-05-26T08:00:00Z";
      for (const name of order) await emails[name]();
      return final();
    };

    it("ends cancelled by the latest cancellation, as Codex's order shows", async () => {
      expect(await run(["confirmed", "cancelled10", "cancelled20", "reconfirmed"])).toEqual(["x20"]);
    });

    it("ends the same whichever order the emails come in", async () => {
      const orders: (keyof typeof emails)[][] = [
        ["confirmed", "cancelled10", "reconfirmed", "cancelled20"],
        ["cancelled20", "reconfirmed", "cancelled10", "confirmed"],
        ["reconfirmed", "confirmed", "cancelled20", "cancelled10"],
        ["cancelled10", "cancelled20", "confirmed", "reconfirmed"],
        ["confirmed", "cancelled10", "cancelled20", "reconfirmed"],
      ];
      for (const order of orders) expect(await run(order), order.join(", ")).toEqual(["x20"]);
      // Without the last cancellation, the reconfirmation stands.
      expect(await run(["cancelled10", "reconfirmed", "confirmed"])).toEqual(["live"]);
      expect(await run(["confirmed", "reconfirmed", "cancelled10"])).toEqual(["live"]);
    });
  });

  describe("after Restore", () => {
    const sent = (day: string) => `${day} 2026 09:00:00 +0000`;
    // Confirmed 1 May, cancelled 10 May and again 20 May; restored on 26 May.
    const restored = async () => {
      const store = memoryStore();
      clock = "2026-05-21T08:00:00Z";
      await importMessage("u1", email({ id: "c01", date: sent("1 May") }), deps(store, async () => confirmation));
      await importMessage("u1", email({ id: "x10", subject: "Booking cancelled", date: sent("10 May") }), deps(store, async () => cancellation("1234567890")));
      await importMessage("u1", email({ id: "x20", subject: "Booking cancelled", date: sent("20 May") }), deps(store, async () => cancellation("1234567890")));
      expect(store.segments.get("c01-0")?.cancelledBy).toBe("x20");
      // Restore, as the web and Android write it.
      clock = "2026-05-26T08:00:00Z";
      const { cancelledAt: _at, cancelledBy: _by, cancelledSentAt: _sent, ...live } = store.segments.get("c01-0")!;
      store.segments.set("c01-0", { ...live, restoredFrom: ["x20"], restoredAt: clock });
      return store;
    };

    it("keeps the booking live when an older confirmation of it is read, whichever cancellation won", async () => {
      const store = await restored();
      clock = "2026-05-27T08:00:00Z";
      await importMessage("u1", email({ id: "c02", date: sent("2 May") }), deps(store, async () => confirmation));
      expect(store.segments.get("c01-0")?.cancelledAt).toBeUndefined();
    });

    it("still cancels it by a cancellation sent after the Restore", async () => {
      const store = await restored();
      clock = "2026-05-31T08:00:00Z";
      await importMessage("u1", email({ id: "x30", subject: "Booking cancelled", date: sent("30 May") }), deps(store, async () => cancellation("1234567890")));
      expect(store.segments.get("c01-0")?.cancelledBy).toBe("x30");
    });
  });

  describe("after cleanup removes a cancellation that stopped waiting", () => {
    const sent = (day: string) => `${day} 2026 09:00:00 +0000`;
    const lisbon: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "lodging", title: "Example Hotel Lisboa", confirmation: "LX-9", start: "2026-09-01T15:00:00+01:00", end: "2026-09-04T11:00:00+01:00", destination: { name: "Example Hotel Lisboa", city: "Lisbon", country: "PT" } }],
    };
    // Confirmed 1 May, cancelled 20 May, booked again 25 May (read last). An
    // unrelated import in late July, after the June stay and the month's
    // grace, deletes the cancellation that stopped waiting.
    const run = async (cleanup: boolean) => {
      const store = memoryStore();
      clock = "2026-05-26T08:00:00Z";
      await importMessage("u1", email({ id: "c01", date: sent("1 May") }), deps(store, async () => confirmation));
      await importMessage("u1", email({ id: "x20", subject: "Booking cancelled", date: sent("20 May") }), deps(store, async () => cancellation("1234567890")));
      if (cleanup) {
        clock = "2026-07-30T08:00:00Z";
        await importMessage("u1", email({ id: "lx", date: sent("30 Jul") }), deps(store, async () => lisbon));
        expect(store.pending.size).toBe(0);
      }
      await importMessage("u1", email({ id: "c25", date: sent("25 May") }), deps(store, async () => confirmation));
      return store.segments.get("c01-0")?.cancelledBy ?? "live";
    };

    it("still dates the cancellation the booking records, so a later confirmation stands", async () => {
      expect(await run(true)).toBe("live");
    });

    it("ends the same with or without the cleanup", async () => {
      expect(await run(true)).toBe(await run(false));
    });
  });

  it("leave a restored booking live when its confirmation is read again, and still cancel its other legs", async () => {
    const leg = (start: string, from: string, to: string): ExtractedBooking => ({
      isBooking: true,
      segments: [{ type: "flight", title: `Example Air ${from} to ${to}`, confirmation: "XQ7P2L", start, origin: { name: from, code: from }, destination: { name: to, code: to } }],
    });
    const out = leg("2026-06-10T08:00:00+01:00", "LHR", "ARN");
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", email(), deps(store, async () => out));
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "flight", confirmation: "XQ7P2L" }] })));
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
    // Restore, as the web and Android write it.
    const { cancelledAt: _at, cancelledBy: _by, ...restored } = store.segments.get("m1-0")!;
    store.segments.set("m1-0", { ...restored, restoredFrom: ["m2"] });
    // The same confirmation again, and the cancellation email read again: still live.
    expect(await importMessage("u1", email({ id: "m3" }), deps(store, async () => out))).toBe("imported");
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "flight", confirmation: "XQ7P2L" }] })), { force: true, reclaim: true });
    expect(store.segments.get("m1-0")?.cancelledAt).toBeUndefined();
    // The return leg under the same reference is still cancelled by it.
    await importMessage("u1", email({ id: "m4" }), deps(store, async () => leg("2026-06-13T12:00:00+02:00", "ARN", "LHR")));
    expect(store.segments.get("m4-0")?.cancelledBy).toBe("m2");
  });

  it("keep a booking the person marked cancelled that way when its confirmation is read again", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", email(), deps(store, async () => confirmation));
    // Mark cancelled, as the web and Android write it.
    store.segments.set("m1-0", { ...store.segments.get("m1-0")!, cancelledAt: "2026-05-20T09:00:00Z", userCancelled: "booking" });
    clock = "2026-05-26T08:00:00Z";
    expect(await importMessage("u1", email({ id: "m3", date: "Mon, 25 May 2026 09:00:00 +0000" }), deps(store, async () => confirmation))).toBe("imported");
    expect(store.segments.size).toBe(1);
    expect(store.segments.get("m1-0")).toMatchObject({ cancelledAt: "2026-05-20T09:00:00Z", userCancelled: "booking" });
  });

  it("file a booking into a trip its owner marked cancelled as cancelled with it", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", email(), deps(store, async () => confirmation));
    const trip = [...store.trips.values()][0]!;
    store.trips.set(trip.id, { ...trip, cancelledAt: "2026-05-20T09:00:00Z" });
    store.segments.set("m1-0", { ...store.segments.get("m1-0")!, cancelledAt: "2026-05-20T09:00:00Z", userCancelled: "trip" });
    const flight: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "flight", title: "SK 1530 LHR to ARN", start: "2026-06-10T08:00:00+01:00", end: "2026-06-10T11:30:00+02:00", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "Arlanda", code: "ARN" } }],
    };
    clock = "2026-05-21T08:00:00Z";
    expect(await importMessage("u1", email({ id: "m5", subject: "Your flight to Stockholm" }), deps(store, async () => flight))).toBe("imported");
    expect(store.trips.size).toBe(1);
    expect(store.segments.get("m5-0")).toMatchObject({ tripId: trip.id, cancelledAt: "2026-05-21T08:00:00Z", userCancelled: "trip" });
  });

  it("choose the trip by what is still booked, not by a booking filed cancelled", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    // June in Stockholm, already filed.
    await importMessage("u1", email(), deps(store, async () => confirmation));
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "PAR-1" }] })));
    // One email: a Paris stay in June (cancelled already) and a Rome stay in July.
    const parisAndRome: ExtractedBooking = {
      isBooking: true,
      segments: [
        { type: "lodging", title: "Example Hotel Paris", confirmation: "PAR-1", start: "2026-06-12T15:00:00+02:00", end: "2026-06-14T11:00:00+02:00", destination: { name: "Example Hotel Paris", city: "Paris", country: "FR" } },
        { type: "lodging", title: "Example Hotel Roma", confirmation: "ROM-1", start: "2026-07-10T15:00:00+02:00", end: "2026-07-12T11:00:00+02:00", destination: { name: "Example Hotel Roma", city: "Rome", country: "IT" } },
      ],
    };
    await importMessage("u1", email({ id: "m3" }), deps(store, async () => parisAndRome));
    const stockholm = store.trips.get(store.segments.get("m1-0")!.tripId)!;
    expect(stockholm).toMatchObject({ start: "2026-06-10", end: "2026-06-13" });
    expect(store.segments.get("m3-1")!.tripId).not.toBe(stockholm.id);
  });

  it("don't let a duplicate of a cancelled booking pull a live one into its trip", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    // June in Stockholm, filed and then cancelled.
    await importMessage("u1", email(), deps(store, async () => confirmation));
    await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")));
    // One email: the Stockholm stay again (a duplicate of the cancelled one)
    // and a live Rome stay in July.
    const stockholmAndRome: ExtractedBooking = {
      isBooking: true,
      segments: [
        ...confirmation.segments,
        { type: "lodging", title: "Example Hotel Roma", confirmation: "ROM-1", start: "2026-07-10T15:00:00+02:00", end: "2026-07-12T11:00:00+02:00", destination: { name: "Example Hotel Roma", city: "Rome", country: "IT" } },
      ],
    };
    await importMessage("u1", email({ id: "m3" }), deps(store, async () => stockholmAndRome));
    const stockholm = store.trips.get(store.segments.get("m1-0")!.tripId)!;
    expect(store.segments.get("m1-0")?.cancelledBy).toBe("m2");
    expect(stockholm).toMatchObject({ start: "2026-06-10", end: "2026-06-13" });
    expect(store.segments.get("m3-1")!.tripId).not.toBe(stockholm.id);
    expect(store.trips.get(store.segments.get("m3-1")!.tripId)).toMatchObject({ start: "2026-07-10", end: "2026-07-12" });
  });

  it("keep back-to-back cancelled stays in one trip that spans them", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    const stay = (title: string, ref: string, start: string, end: string): ExtractedBooking => ({
      isBooking: true,
      segments: [{ type: "lodging", title, confirmation: ref, start, end, destination: { name: title, city: "Lyon", country: "FR" } }],
    });
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: ["L-1", "L-2", "L-3"].map((confirmation) => ({ type: "lodging" as const, confirmation })) })));
    await importMessage("u1", email({ id: "ma" }), deps(store, async () => stay("Example Hotel One", "L-1", "2026-06-01T15:00:00+02:00", "2026-06-03T11:00:00+02:00")));
    await importMessage("u1", email({ id: "mb" }), deps(store, async () => stay("Example Hotel Two", "L-2", "2026-06-04T15:00:00+02:00", "2026-06-06T11:00:00+02:00")));
    await importMessage("u1", email({ id: "mc" }), deps(store, async () => stay("Example Hotel Three", "L-3", "2026-06-07T15:00:00+02:00", "2026-06-09T11:00:00+02:00")));
    expect([...store.segments.values()].every((s) => s.cancelledBy === "m2")).toBe(true);
    expect([...store.trips.values()]).toMatchObject([{ start: "2026-06-01", end: "2026-06-09" }]);
  });

  it("don't let a trip of cancelled bookings only bridge the live ones that join it", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    const stay = (id: string, title: string, city: string, country: string, confirmationNumber: string, start: string, end: string): ExtractedBooking => ({
      isBooking: true,
      segments: [{ type: "lodging", title, confirmation: confirmationNumber, start, end, destination: { name: title, city, country } }],
    });
    // A month's stay, cancelled before it is read: a trip by its booked dates.
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "lodging", confirmation: "RES-1" }] })));
    await importMessage("u1", email({ id: "ma" }), deps(store, async () => stay("ma", "Example Residence", "Lyon", "FR", "RES-1", "2026-06-01T15:00:00+02:00", "2026-06-30T11:00:00+02:00")));
    // Two live stays weeks apart within that month.
    await importMessage("u1", email({ id: "mb" }), deps(store, async () => stay("mb", "Example Hotel Paris", "Paris", "FR", "PAR-2", "2026-06-05T15:00:00+02:00", "2026-06-07T11:00:00+02:00")));
    await importMessage("u1", email({ id: "mc" }), deps(store, async () => stay("mc", "Example Hotel Roma", "Rome", "IT", "ROM-2", "2026-06-20T15:00:00+02:00", "2026-06-22T11:00:00+02:00")));
    const paris = store.segments.get("mb-0")!.tripId;
    const rome = store.segments.get("mc-0")!.tripId;
    expect(paris).not.toBe(rome);
    expect(store.trips.get(paris)).toMatchObject({ liveStart: "2026-06-05", liveEnd: "2026-06-07" });
  });

  it("give a new trip every booking's dates, shown by what is still booked in it", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", cancelEmail, deps(store, async () => ({ isBooking: false, segments: [], cancellations: [{ type: "flight", confirmation: "XQ7P2L" }] })));
    const stayAndFlight: ExtractedBooking = {
      isBooking: true,
      segments: [
        ...confirmation.segments,
        {
          type: "flight",
          title: "Example Air 12 ARN to LHR",
          confirmation: "XQ7P2L",
          start: "2026-06-15T12:00:00+02:00",
          end: "2026-06-15T13:40:00+01:00",
          origin: { name: "ARN", code: "ARN" },
          destination: { name: "LHR", code: "LHR" },
        },
      ],
    };
    await importMessage("u1", email(), deps(store, async () => stayAndFlight));
    expect(store.segments.get("m1-1")?.cancelledBy).toBe("m2");
    expect(store.segments.get("m1-0")?.cancelledAt).toBeUndefined();
    expect([...store.trips.values()]).toMatchObject([{ start: "2026-06-10", end: "2026-06-15", liveStart: "2026-06-10", liveEnd: "2026-06-13" }]);
  });

  it("keep waiting for a booking named by reference only after another it names has passed", async () => {
    const store = memoryStore();
    clock = "2026-05-01T08:00:00Z";
    await importMessage("u1", cancelEmail, deps(store, async () => ({
      isBooking: false,
      segments: [],
      cancellations: [
        { type: "lodging", confirmation: "ST-1", start: "2026-05-05T15:00:00+02:00", end: "2026-05-10T11:00:00+02:00" },
        { type: "flight", confirmation: "FL-1" },
      ],
    })));
    clock = "2026-06-15T08:00:00Z";
    const flight: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "flight", title: "Example Air 9 LHR to ARN", confirmation: "FL-1", start: "2026-12-01T08:00:00+00:00", origin: { name: "LHR", code: "LHR" }, destination: { name: "ARN", code: "ARN" } }],
    };
    await importMessage("u1", email({ id: "m3" }), deps(store, async () => flight));
    expect(store.segments.get("m3-0")?.cancelledBy).toBe("m2");
    expect(store.pending.size).toBe(1);
    // The stay it named has passed: that part no longer waits.
    const stay: ExtractedBooking = {
      isBooking: true,
      segments: [{ type: "lodging", title: "Example Hotel", confirmation: "ST-1", start: "2026-05-05T15:00:00+02:00", end: "2026-05-10T11:00:00+02:00" }],
    };
    await importMessage("u1", email({ id: "m4" }), deps(store, async () => stay));
    expect(store.segments.get("m4-0")?.cancelledAt).toBeUndefined();
  });

  it("stop waiting a month after they're read, once the booking's dates have passed", async () => {
    const store = memoryStore();
    clock = "2026-05-20T08:00:00Z";
    await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")));
    clock = "2026-06-30T08:00:00Z";
    await importMessage("u1", email(), deps(store, async () => confirmation));
    expect([...store.segments.values()][0]?.cancelledAt).toBeUndefined();
    expect(store.pending.size).toBe(0);
  });

  describe("and the same stay booked again after them, without confirmation numbers", () => {
    const unnumbered: ExtractedBooking = { ...confirmation, segments: confirmation.segments.map(({ confirmation: _, ...s }) => s) };
    const byPlace: ExtractedBooking = { ...cancellation(""), cancellations: [{ ...cancellation("").cancellations![0]!, confirmation: undefined }] };
    const cancelSent = email({ id: "m2", subject: "Booking cancelled", date: "Wed, 20 May 2026 08:00:00 +0000" });
    const rebooked = email({ id: "m3", date: "Mon, 25 May 2026 09:00:00 +0000" });

    it("file the new booking live when it is read after the cancellation", async () => {
      const store = memoryStore();
      clock = "2026-05-26T08:00:00Z";
      await importMessage("u1", cancelSent, deps(store, async () => byPlace));
      await importMessage("u1", rebooked, deps(store, async () => unnumbered));
      expect([...store.segments.values()].map((s) => [s.id, s.cancelledAt ?? "live"])).toEqual([["m3-0", "live"]]);
      // The original confirmation, read last, is the same stay as far as
      // anything shows: it joins the live booking rather than adding one.
      await importMessage("u1", email(), deps(store, async () => unnumbered));
      expect([...store.segments.values()].map((s) => [s.id, s.cancelledAt ?? "live"])).toEqual([["m3-0", "live"]]);
    });

    it("leave the new booking live when the older cancellation is read after it", async () => {
      const store = memoryStore();
      clock = "2026-05-26T08:00:00Z";
      await importMessage("u1", rebooked, deps(store, async () => unnumbered));
      expect(await importMessage("u1", cancelSent, deps(store, async () => byPlace))).toBe("cancellation");
      expect([...store.segments.values()].map((s) => [s.id, s.cancelledAt ?? "live"])).toEqual([["m3-0", "live"]]);
      expect(store.parsed.get("u1/m2")?.reason).toBe("no matching booking found");
    });

    it("keep the new booking apart from the cancelled one when it is read before", async () => {
      const store = memoryStore();
      clock = "2026-05-26T08:00:00Z";
      await importMessage("u1", email(), deps(store, async () => unnumbered));
      await importMessage("u1", cancelSent, deps(store, async () => byPlace));
      expect(await importMessage("u1", rebooked, deps(store, async () => unnumbered))).toBe("imported");
      const byId = Object.fromEntries([...store.segments.values()].map((s) => [s.id, s]));
      expect(byId["m1-0"]?.cancelledBy).toBe("m2");
      expect(byId["m3-0"]).toBeDefined();
      expect(byId["m3-0"]?.cancelledAt).toBeUndefined();
      // Reading the original again still finds the cancelled booking.
      await importMessage("u1", email(), deps(store, async () => unnumbered), { force: true, reclaim: true });
      expect(store.segments.size).toBe(2);
    });
  });

  it("still cancel a booking whose first import failed and was retried", async () => {
    const store = memoryStore();
    await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")));
    expect(
      await importMessage("u1", email(), deps(store, async () => {
        throw new Error("model rate-limited");
      })),
    ).toBe("failed");
    expect(store.pending.size).toBe(1);
    expect(await importMessage("u1", email(), deps(store, async () => confirmation), { retryFailed: true })).toBe("imported");
    expect([...store.segments.values()][0]?.cancelledBy).toBe("m2");
  });

  it("don't cancel an unrelated booking imported later", async () => {
    const store = memoryStore();
    await importMessage("u1", cancelEmail, deps(store, async () => cancellation("999")));
    await importMessage("u1", email(), deps(store, async () => confirmation));
    expect([...store.segments.values()][0]?.cancelledAt).toBeUndefined();
    expect(store.pending.size).toBe(1);
  });

  it("leave a booking with another confirmation number alone and say nothing matched", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    await importMessage("u1", email(), deps(store, async () => confirmation));
    expect(await importMessage("u1", cancelEmail, deps(store, async () => cancellation("999")))).toBe("cancellation");

    expect([...store.segments.values()][0]!.cancelledAt).toBeUndefined();
    expect(store.parsed.get("u1/m2")).toMatchObject({ outcome: "cancellation", reason: "no matching booking found", segmentIds: [] });
  });

  it("only touch the user's own bookings", async () => {
    const store = memoryStore();
    clock = "2026-05-01T12:00:00Z";
    await importMessage("u2", email(), deps(store, async () => confirmation));
    expect(await importMessage("u1", cancelEmail, deps(store, async () => cancellation("1234567890")))).toBe("cancellation");

    expect([...store.segments.values()][0]!.cancelledAt).toBeUndefined();
    expect(store.parsed.get("u1/m2")?.reason).toBe("no matching booking found");
  });
});
