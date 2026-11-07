import { describe, expect, it } from "vitest";
import { dueForReminders, entryLine, newLines, reminderEmail, reminderLines, reminderNotifications, notificationPayloadLimit } from "./reminders";
import type { Segment, Trip } from "./schema";
import type { VisaTable } from "./visas";

// Invented trips and documents.
const at = "2026-10-01T00:00:00Z";
const trip = (id: string, start: string, end: string, over: Partial<Trip> = {}): Trip => ({ id, title: id, start, end, ownerUid: "u1", sharedWith: [], createdAt: at, updatedAt: at, ...over });

describe("dueForReminders", () => {
  it("takes trips under way or starting within a month, soonest first, never one being deleted", () => {
    const trips = [trip("later", "2026-12-02", "2026-12-05"), trip("soon", "2026-11-30", "2026-12-01"), trip("now", "2026-10-30", "2026-11-03"), trip("past", "2026-10-20", "2026-10-31"), trip("gone", "2026-11-10", "2026-11-12", { deleting: true })];
    expect(dueForReminders(trips, "2026-11-01").map((t) => t.id)).toEqual(["now", "soon"]);
  });
});

describe("newLines", () => {
  it("keeps the lines not sent before, in order", () => {
    expect(newLines(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });
});

const table: VisaTable = { fetched: "2026-11-07", destinations: ["AE", "GB"], days: {}, rules: { GB: "E-" } };
const segments: Segment[] = [
  {
    id: "f",
    tripId: "t",
    type: "flight",
    title: "XX 1 MAN to DXB",
    start: "2026-11-20T09:00:00+00:00",
    end: "2026-11-20T19:00:00+04:00",
    origin: { name: "Manchester", code: "MAN", country: "GB" },
    destination: { name: "Dubai", code: "DXB", country: "AE" },
    source: "manual",
    gmailMessageIds: [],
    createdAt: at,
    updatedAt: at,
  },
];

describe("reminderLines", () => {
  it("joins the document warnings and the entry needs that want action, worded as the app does", () => {
    const people = [{ uid: "u1", own: true, documents: [{ title: "Passport", kind: "passport" as const, expires: "2026-12-30", country: "GB" }] }];
    const lines = reminderLines(people, trip("t", "2026-11-20", "2026-11-25"), segments, "2026-11-01", { visaTable: table });
    expect(lines).toEqual([
      "Your passport expires on 30 Dec 2026, 1 month after this trip ends; many countries require six months’ validity.",
      "United Arab Emirates: e-visa needed with your United Kingdom passport",
    ]);
    // A held visa covers the country; a visa-free country is nothing to act on.
    const withVisa = [{ ...people[0]!, documents: [...people[0]!.documents, { title: "Visa", kind: "visa" as const, expires: "2027-01-01", country: "AE" }] }];
    expect(reminderLines(withVisa, trip("t", "2026-11-20", "2026-11-25"), segments, "2026-11-01", { visaTable: table })).toHaveLength(1);
    expect(entryLine({ own: false, email: "sam@example" }, { country: "AE", best: { rule: { kind: "eta" }, passport: "GB" } })).toBe(
      "United Arab Emirates: electronic travel authorization needed with sam@example’s United Kingdom passport",
    );
    const held = { title: "Visa", kind: "visa" as const, expires: "2027-01-01", country: "AE" };
    expect(entryLine({ own: true }, { country: "AE", best: { rule: { kind: "evisa" }, passport: "GB" }, visa: held })).toBe(
      "United Arab Emirates: e-visa needed with your United Kingdom passport · you hold a visa until 1 Jan 2027",
    );
    expect(entryLine({ own: false, email: "sam@example" }, { country: "AE", best: { rule: { kind: "evisa" }, passport: "GB" }, visa: held })).toBe(
      "United Arab Emirates: e-visa needed with sam@example’s United Kingdom passport · sam@example holds a visa until 1 Jan 2027",
    );
  });
});

describe("reminderEmail", () => {
  it("says when each trip starts, lists its lines and links the trip and the settings", () => {
    const { subject, text } = reminderEmail(
      [
        { trip: trip("Dubai", "2026-11-20", "2026-11-25"), lines: ["one", "two"] },
        { trip: trip("Rome", "2026-11-02", "2026-11-03"), lines: ["three"] },
      ],
      { origin: "https://travelmo.example", today: "2026-11-01" },
    );
    expect(subject).toBe("Before your next 2 trips");
    expect(text).toBe(
      [
        "Dubai (20–25 Nov 2026), starts in 19 days:\n  - one\n  - two\n  https://travelmo.example/trips/Dubai",
        "Rome (2–3 Nov 2026), starts tomorrow:\n  - three\n  https://travelmo.example/trips/Rome",
        "",
        "You get these because reminders by email are on in your Travelmo settings: https://travelmo.example/settings",
      ].join("\n\n"),
    );
    expect(reminderEmail([{ trip: trip("Rome", "2026-10-30", "2026-11-03"), lines: ["x"] }], { origin: "o", today: "2026-11-01" })).toMatchObject({
      subject: "Before your trip to Rome",
      text: expect.stringContaining("Rome (30 Oct – 3 Nov 2026), under way:"),
    });
  });
});

describe("reminderNotifications", () => {
  it("makes one notification per trip, tagged by trip, opening it", () => {
    const [dubai, rome] = reminderNotifications(
      [
        { trip: trip("Dubai", "2026-11-20", "2026-11-25"), lines: ["one", "two"] },
        { trip: trip("Rome", "2026-10-30", "2026-11-03"), lines: ["three"] },
      ],
      { origin: "https://travelmo.example", today: "2026-11-01" },
    );
    expect(dubai).toEqual({
      title: "Before your trip to Dubai",
      body: "Starts in 19 days, 20–25 Nov 2026.\none\ntwo",
      url: "https://travelmo.example/trips/Dubai",
      tag: "reminder-Dubai",
    });
    expect(rome).toMatchObject({ body: "Under way, 30 Oct – 3 Nov 2026.\nthree", tag: "reminder-Rome" });
  });

  it("keeps a notification within what a push service guarantees to carry, counting the rest", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}: ${"é".repeat(80)}`);
    const [n] = reminderNotifications([{ trip: trip("Dubai", "2026-11-20", "2026-11-25"), lines }], { origin: "https://travelmo.example", today: "2026-11-01" });
    expect(new TextEncoder().encode(JSON.stringify(n)).length).toBeLessThanOrEqual(notificationPayloadLimit);
    const shown = n!.body.split("\n").filter((l) => l.startsWith("Line ")).length;
    expect(shown).toBeGreaterThan(10);
    expect(n!.body.endsWith(`And ${60 - shown} more on the trip page.`)).toBe(true);
  });
});
