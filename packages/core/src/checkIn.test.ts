import { describe, expect, it } from "vitest";
import { checkInEmail, checkInNotification, checkInReminderAt, checkInReminderDue, checkInReminderWindow } from "./checkIn";

// Invented bookings in their own offsets: an unlisted airline (a day's
// window), Emirates (two days) and easyJet (a month, capped at two days).
const base = { id: "f1", tripId: "t1", type: "flight" as const };
const unlisted = {
  ...base,
  title: "XX 100 MAN to DXB",
  start: "2026-12-13T09:00:00+05:00",
  destination: { name: "Dubai International", city: "Dubai", code: "DXB" },
  confirmation: "XX1234",
};
const emirates = { ...base, title: "EK 18 MAN to DXB", start: "2026-12-13T09:00:00-05:00" };
const easyjet = { ...base, title: "U2 8012 LGW to GVA", start: "2026-12-13T07:00:00+00:00", destination: { name: "Geneva" } };
const origin = "https://travelmo.example";

describe("checkInReminderAt", () => {
  it("is when check-in opens, in the departure's offset", () => {
    expect(checkInReminderAt(unlisted)).toBe("2026-12-12T09:00:00+05:00");
    expect(checkInReminderAt(emirates)).toBe("2026-12-11T09:00:00-05:00");
  });

  it("waits until two days before departure for an airline that opens earlier", () => {
    expect(checkInReminderAt(easyjet)).toBe("2026-12-11T07:00:00+00:00");
  });
});

describe("checkInReminderDue", () => {
  it("is due from the opening until an hour before departure", () => {
    // 09:00+05:00 on the 12th is 04:00Z.
    expect(checkInReminderDue(unlisted, "2026-12-12T03:59:00Z")).toBe(false);
    expect(checkInReminderDue(unlisted, "2026-12-12T04:00:00Z")).toBe(true);
    // Booked late: still due while departure is more than an hour off.
    expect(checkInReminderDue(unlisted, "2026-12-13T02:59:00Z")).toBe(true);
    expect(checkInReminderDue(unlisted, "2026-12-13T03:00:00Z")).toBe(false);
    expect(checkInReminderDue(unlisted, "2026-12-13T05:00:00Z")).toBe(false);
    expect(checkInReminderDue({ ...unlisted, type: "train" }, "2026-12-12T12:00:00Z")).toBe(false);
  });

  it("is never due for a cancelled booking", () => {
    expect(checkInReminderDue({ ...unlisted, cancelledAt: "2026-12-01T00:00:00Z" }, "2026-12-12T12:00:00Z")).toBe(false);
  });

  it("is never due for a flight outside the window the job reads", () => {
    const offsets = ["+14:00", "+05:00", "+00:00", "-05:00", "-12:00"];
    for (const segment of [unlisted, emirates, easyjet]) {
      for (const offset of offsets) {
        const moved = { ...segment, start: `${segment.start.slice(0, 19)}${offset}` };
        for (let h = -60; h <= 60; h += 1) {
          const now = new Date(Date.parse(moved.start) + h * 3_600_000).toISOString();
          if (!checkInReminderDue(moved, now)) continue;
          const { fromLocal, toLocal } = checkInReminderWindow(now);
          expect(moved.start >= fromLocal && moved.start <= `${toLocal}~`).toBe(true);
        }
      }
    }
  });
});

describe("checkInNotification", () => {
  it("names the flight and where it goes, when it leaves as written, and the booking reference", () => {
    expect(checkInNotification(unlisted, { origin })).toEqual({
      title: "Check in for XX 100 to Dubai",
      body: "Online check-in is open.\nDeparts Sun 13 Dec 09:00.\nBooking reference XX1234.",
      url: "https://travelmo.example/trips/t1",
      tag: "checkin-t1-f1",
      checkedIn: { tripId: "t1", segmentId: "f1" },
    });
  });

  it("opens the airline's site where it is known", () => {
    const n = checkInNotification(easyjet, { origin });
    expect(n.title).toBe("Check in for U2 8012 to Geneva");
    expect(n.body).toBe("Online check-in is open.\nDeparts Sun 13 Dec 07:00.");
    expect(n.url).toBe("https://www.easyjet.com/");
    expect(checkInNotification({ ...base, title: "Flight home", start: emirates.start }, { origin }).title).toBe("Check in for your flight");
  });

  it("mails the same with the airline's site and the trip", () => {
    const mail = checkInEmail(easyjet, { origin });
    expect(mail.subject).toBe("Check in for U2 8012 to Geneva");
    expect(mail.text).toContain("Online check-in is open.");
    expect(mail.text).toContain("Check in: https://www.easyjet.com/\nYour trip: https://travelmo.example/trips/t1");
    expect(mail.text).toContain("https://travelmo.example/settings");
    expect(checkInEmail(unlisted, { origin }).text).not.toContain("Check in:");
  });
});
