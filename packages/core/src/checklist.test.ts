import { describe, expect, it } from "vitest";
import {
  checklistEmail,
  checklistNotification,
  dueEntries,
  dueText,
  homeCountry,
  isInternational,
  leadText,
  reminderDue,
  tripChecklist,
  bySlot,
  freeSlot,
  withDone,
} from "./checklist";
import { OneOffReminder, StandingReminder, TripChecklist, maxDoneReminders, type Place, type Segment, type Trip } from "./schema";

const lhr: Place = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
const lis: Place = { name: "Lisbon", code: "LIS", city: "Lisbon", country: "PT" };
const man: Place = { name: "Manchester", code: "MAN", city: "Manchester", country: "GB" };
// Airports named by code alone: their country comes from the table.
const lhrBare: Place = { name: "London Heathrow", code: "LHR", city: "London" };
const lisBare: Place = { name: "Lisbon", code: "LIS" };
const lookup = (code: string) => ({ LHR: { country: "GB", lat: 51.47, lon: -0.45 }, LIS: { country: "PT", lat: 38.77, lon: -9.13 } })[code];

const seg = (id: string, type: Segment["type"], start: string, end: string | undefined, origin?: Place, destination?: Place, extra: Partial<Segment> = {}): Segment => ({
  id,
  tripId: "t",
  type,
  title: id,
  start,
  ...(end ? { end } : {}),
  ...(origin ? { origin } : {}),
  ...(destination ? { destination } : {}),
  source: "gmail",
  gmailMessageIds: [],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...extra,
});
const trip: Trip = { id: "lisbon", title: "Lisbon", start: "2026-12-12", end: "2026-12-19", ownerUid: "u", sharedWith: [], createdAt: "", updatedAt: "" };
const out = seg("out", "flight", "2026-12-12T08:00:00+00:00", "2026-12-12T10:45:00+00:00", lhr, lis);
const back = seg("back", "flight", "2026-12-19T12:30:00+00:00", "2026-12-19T15:10:00+00:00", lis, lhr);

describe("reminderDue", () => {
  it("counts days, weeks and calendar months back from the trip's first day", () => {
    expect(reminderDue("2026-12-12", { amount: 30, unit: "days" })).toBe("2026-11-12");
    expect(reminderDue("2026-12-12", { amount: 2, unit: "weeks" })).toBe("2026-11-28");
    expect(reminderDue("2026-03-31", { amount: 1, unit: "months" })).toBe("2026-02-28");
    expect(reminderDue("2026-12-12", { amount: 0, unit: "days" })).toBe("2026-12-12");
  });

  it("takes a one-off's own date", () => {
    expect(reminderDue("2026-12-12", { date: "2026-12-01" })).toBe("2026-12-01");
  });
});

describe("leadText", () => {
  it("says how long before in words", () => {
    expect(leadText({ amount: 30, unit: "days" })).toBe("30 days before");
    expect(leadText({ amount: 1, unit: "weeks" })).toBe("1 week before");
    expect(leadText({ amount: 2, unit: "months" })).toBe("2 months before");
    expect(leadText({ amount: 0, unit: "days" })).toBe("The day it starts");
  });
});

describe("isInternational", () => {
  it("is when a booking is in another country than home, where the trip's round trip starts", () => {
    expect(homeCountry([out, back], [], trip.start)).toBe("GB");
    expect(isInternational(trip, [out, back], [])).toBe(true);
  });

  it("is not for a trip within the home country", () => {
    const north = seg("north", "train", "2026-12-12T08:00:00+00:00", "2026-12-12T10:00:00+00:00", lhr, man);
    const south = seg("south", "train", "2026-12-14T08:00:00+00:00", "2026-12-14T10:00:00+00:00", man, lhr);
    expect(isInternational(trip, [north, south], [])).toBe(false);
  });

  it("finds home's country from the airport table when the bookings name none", () => {
    const o = seg("out", "flight", "2026-12-12T08:00:00+00:00", "2026-12-12T10:45:00+00:00", lhrBare, lisBare);
    const b = seg("back", "flight", "2026-12-19T12:30:00+00:00", "2026-12-19T15:10:00+00:00", lisBare, lhrBare);
    expect(isInternational(trip, [o, b], [])).toBe(false);
    expect(homeCountry([o, b], [], trip.start, lookup)).toBe("GB");
    expect(isInternational(trip, [o, b], [], lookup)).toBe(true);
  });

  it("is not without a known home: a one-way trip, until Profile says where home is", () => {
    expect(isInternational(trip, [out], [])).toBe(false);
    expect(isInternational(trip, [out], [{ city: "London", country: "GB", from: "2020-01-01" }])).toBe(true);
    // Home moved to Lisbon before the trip: a stay there is at home.
    const stay = seg("stay", "lodging", "2026-12-12T15:00:00+00:00", "2026-12-19T11:00:00+00:00", undefined, lis);
    expect(isInternational(trip, [stay], [{ city: "Lisbon", country: "PT", from: "2026-01-01" }])).toBe(false);
  });

  it("is not when no booking says where it is, or every booking was cancelled", () => {
    expect(isInternational(trip, [], [{ city: "London", country: "GB", from: "2020-01-01" }])).toBe(false);
    const cancelled = { cancelledAt: "2026-11-01T00:00:00Z" };
    expect(isInternational(trip, [seg("o", "flight", out.start, out.end, lhr, lis, cancelled), seg("b", "flight", back.start, back.end, lis, lhr, cancelled)], [])).toBe(false);
  });
});

describe("tripChecklist", () => {
  const visa = { id: "visa", text: "Apply for a visa", amount: 30, unit: "days" } as const;
  const meds = { id: "meds", text: "Request prescriptions", amount: 2, unit: "weeks" } as const;
  const adapter = { id: "adapter", text: "Pack the adapter", date: "2026-12-10" };

  it("lists the standing reminders for an international trip and its one-offs, soonest first, ticked ones marked", () => {
    const list = tripChecklist(trip, [meds, visa], { done: ["meds"], added: [adapter] }, true);
    expect(list).toEqual([
      { id: "visa", text: "Apply for a visa", due: "2026-11-12", done: false, oneOff: false },
      { id: "meds", text: "Request prescriptions", due: "2026-11-28", done: true, oneOff: false },
      { id: "adapter", text: "Pack the adapter", due: "2026-12-10", done: false, oneOff: true },
    ]);
  });

  it("leaves out the standing reminders for a trip at home, keeping its one-offs", () => {
    expect(tripChecklist(trip, [visa], { done: [], added: [adapter] }, false).map((e) => e.id)).toEqual(["adapter"]);
  });

  it("dates from when the person travels, not the trip's own dates", () => {
    const moved = { ...trip, liveStart: "2026-12-14", liveEnd: "2026-12-19" };
    expect(tripChecklist(moved, [visa], { done: [], added: [] }, true)[0]!.due).toBe("2026-11-14");
  });

  it("sends what is due and not ticked off, at once for a trip booked late, and nothing once it started", () => {
    const list = tripChecklist(trip, [meds, visa], { done: ["meds"], added: [adapter] }, true);
    expect(dueEntries(trip, list, "2026-11-11")).toEqual([]);
    expect(dueEntries(trip, list, "2026-11-12").map((e) => e.id)).toEqual(["visa"]);
    // Booked on 1 December: the visa reminder is long due, so it goes now.
    expect(dueEntries(trip, list, "2026-12-01").map((e) => e.id)).toEqual(["visa"]);
    expect(dueEntries(trip, list, "2026-12-12").map((e) => e.id)).toEqual(["visa", "adapter"]);
    expect(dueEntries(trip, list, "2026-12-13")).toEqual([]);
  });
});

describe("dueText", () => {
  it("says the day it is due", () => {
    expect(dueText("2026-11-12", "2026-11-01")).toBe("By Thu 12 Nov");
    expect(dueText("2026-11-12", "2026-11-12")).toBe("Today");
  });
});

describe("editing", () => {
  it("puts a new reminder in the first free slot, and none once all are taken", () => {
    expect(freeSlot([], "s", 20)).toBe("s0");
    expect(freeSlot(["s0", "s2"], "s", 20)).toBe("s1");
    expect(freeSlot(["a0", "a1"], "a", 2)).toBeUndefined();
    expect([{ slot: "s10" }, { slot: "s2" }].sort(bySlot)).toEqual([{ slot: "s2" }, { slot: "s10" }]);
  });

  it("ticks and unticks, keeping the newest when full", () => {
    expect(withDone(["a"], "b", true)).toEqual(["a", "b"]);
    expect(withDone(["a", "b"], "a", false)).toEqual(["b"]);
    expect(withDone(["a"], "a", true)).toEqual(["a"]);
    const full = Array.from({ length: maxDoneReminders }, (_, i) => `r${i}`);
    expect(withDone(full, "new", true)).toEqual([...full.slice(1), "new"]);
  });
});

describe("schemas", () => {
  it("takes a reminder with text, a lead time and a short id", () => {
    expect(StandingReminder.safeParse({ id: "r1", text: " Apply for a visa ", amount: 30, unit: "days" }).data).toEqual({ id: "r1", text: "Apply for a visa", amount: 30, unit: "days" });
    expect(StandingReminder.safeParse({ id: "r1", text: "", amount: 30, unit: "days" }).success).toBe(false);
    expect(StandingReminder.safeParse({ id: "r1", text: "x".repeat(201), amount: 30, unit: "days" }).success).toBe(false);
    expect(StandingReminder.safeParse({ id: "r1", text: "x", amount: 13, unit: "months" }).success).toBe(false);
    expect(StandingReminder.safeParse({ id: "r1", text: "x", amount: 1.5, unit: "days" }).success).toBe(false);
    expect(StandingReminder.safeParse({ id: "a/b", text: "x", amount: 1, unit: "days" }).success).toBe(false);
    expect(OneOffReminder.safeParse({ id: "r1", text: "Pack", date: "2026-12-01" }).success).toBe(true);
    expect(OneOffReminder.safeParse({ id: "r1", text: "Pack", date: "soon" }).success).toBe(false);
  });

  it("leaves out ticked ids that do not parse, not the whole list", () => {
    expect(TripChecklist.parse({ done: ["r1", 3, "a/b"], updatedAt: "2026-11-01T00:00:00Z" })).toEqual({ done: ["r1"], updatedAt: "2026-11-01T00:00:00Z" });
    expect(TripChecklist.parse({})).toEqual({ done: [] });
  });
});

describe("messages", () => {
  const sent = { trip, entry: { id: "visa", text: "Apply for a visa" } };

  it("mails one reminder in plain words, with the trip's link", () => {
    const { subject, text } = checklistEmail(sent, { origin: "https://travelmo.example", today: "2026-11-12" });
    expect(subject).toBe("Apply for a visa — Lisbon trip in 30 days");
    expect(text).toContain("Lisbon trip in 30 days, 12–19 Dec 2026.");
    expect(text).toContain("https://travelmo.example/trips/lisbon");
    expect(text).toContain("https://travelmo.example/settings");
  });

  it("does not say trip twice, and says tomorrow and today", () => {
    expect(checklistEmail({ ...sent, trip: { ...trip, title: "Ski trip\nto Zermatt" } }, { origin: "o", today: "2026-12-11" }).subject).toBe(
      "Apply for a visa — Ski trip to Zermatt tomorrow",
    );
    expect(checklistEmail(sent, { origin: "o", today: "2026-12-12" }).subject).toBe("Apply for a visa — Lisbon trip today");
  });

  it("notifies with the reminder as the title and the trip as the tap target", () => {
    expect(checklistNotification(sent, { origin: "https://travelmo.example", today: "2026-11-12" })).toEqual({
      title: "Apply for a visa",
      body: "Lisbon trip in 30 days, 12–19 Dec 2026.",
      url: "https://travelmo.example/trips/lisbon",
      tag: "checklist-lisbon-visa",
    });
  });
});
