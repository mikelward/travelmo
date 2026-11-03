import { parseIcs, stableHash, type GoogleCalendarChoice } from "@travelmo/core";
import type { calendar_v3 } from "googleapis";
import { sameAccount, eventAliases, eventTime, mergeCalendarList, nativeUid, readCalendar, toIcsCalendar, toIcsEvent, withResults, type CalendarIo } from "./googleCalendar";
import type { ImportDeps } from "./importer";
import { memoryStore } from "./testStore";

const flight = {
  isBooking: true,
  segments: [{ type: "flight" as const, title: "XX1 AAA to BBB", start: "2030-01-01T09:00:00+00:00", origin: { name: "A", code: "AAA" }, destination: { name: "B", code: "BBB" } }],
};

const event = (extra: calendar_v3.Schema$Event = {}): calendar_v3.Schema$Event => ({
  id: "abc",
  iCalUID: "uid-1@example.com",
  status: "confirmed",
  summary: "Flight XX1 AAA to BBB",
  start: { dateTime: "2030-01-01T09:00:00Z", timeZone: "Europe/London" },
  end: { dateTime: "2030-01-01T11:00:00Z", timeZone: "Europe/London" },
  updated: "2029-12-01T00:00:00Z",
  ...extra,
});

describe("eventTime", () => {
  it("shows a timed event in its own zone, an all-day one as a date", () => {
    // Google answers in the calendar's zone; the event was made in Tokyo.
    expect(eventTime({ dateTime: "2030-07-01T10:00:00+01:00", timeZone: "Asia/Tokyo" }, "Europe/London")).toEqual({
      date: "2030-07-01",
      time: "18:00",
      offset: "+09:00",
      zone: "Asia/Tokyo",
    });
    expect(eventTime({ dateTime: "2030-07-01T10:00:00+01:00" }, "Europe/London")).toMatchObject({ time: "10:00", offset: "+01:00", zone: "Europe/London" });
    expect(eventTime({ date: "2030-07-01" })).toEqual({ date: "2030-07-01" });
  });

  it("takes the offset in force at the instant when clocks go back and an hour repeats", () => {
    // 01:30 happens twice in New York on 2026-11-01: first at -04:00, then at -05:00.
    expect(eventTime({ dateTime: "2026-11-01T05:30:00Z", timeZone: "America/New_York" })).toMatchObject({ time: "01:30", offset: "-04:00" });
    expect(eventTime({ dateTime: "2026-11-01T06:30:00Z", timeZone: "America/New_York" })).toMatchObject({ time: "01:30", offset: "-05:00" });
  });

  it("keeps the offset Google sent when the zone is unknown or missing", () => {
    expect(eventTime({ dateTime: "2030-07-01T10:00:00-04:00", timeZone: "Nowhere/Unknown" })).toEqual({ date: "2030-07-01", time: "10:00", offset: "-04:00" });
    expect(eventTime({ dateTime: "2030-07-01T10:00:00Z" })).toEqual({ date: "2030-07-01", time: "10:00", offset: "+00:00" });
    expect(eventTime({ dateTime: "garbage" })).toBeUndefined();
    expect(eventTime(undefined)).toBeUndefined();
  });
});

describe("toIcsEvent", () => {
  it("keys an event by its iCalendar UID, as a calendar file of the same event would be", () => {
    const fromFile = parseIcs(
      ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:uid-1@example.com", "DTSTART:20300101T090000Z", "SUMMARY:Flight", "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
    ).events[0]!;
    expect(toIcsEvent(event())?.key).toBe(fromFile.key);
    expect(toIcsEvent(event())).toMatchObject({ summary: "Flight XX1 AAA to BBB", start: { time: "09:00", zone: "Europe/London" }, recurring: false, cancelled: false });
  });

  it("marks repeating events and their exceptions, and keeps a deleted event with no times", () => {
    expect(toIcsEvent(event({ iCalUID: "trip-t1@export.travelmo" }))?.exported).toBe(true);
    expect(toIcsEvent(event())?.exported).toBeUndefined();
    expect(toIcsEvent(event({ recurrence: ["RRULE:FREQ=WEEKLY"] }))?.recurring).toBe(true);
    expect(toIcsEvent(event({ recurringEventId: "series" }))?.recurring).toBe(true);
    expect(toIcsEvent({ id: "abc", iCalUID: "uid-1@example.com", status: "cancelled" })).toMatchObject({ key: stableHash("uid-1@example.com"), cancelled: true });
    expect(toIcsEvent({ status: "confirmed" })).toBeUndefined();
  });

  it("finds what a deleted event imported from its id alone, made in Google or brought in", () => {
    const native = toIcsEvent({ id: "n1", iCalUID: nativeUid("n1"), status: "confirmed", summary: "Hotel", start: { date: "2030-01-01" } });
    expect(toIcsEvent({ id: "n1", status: "cancelled" })?.key).toBe(native?.key);
    const aliases = eventAliases([event()]);
    expect(aliases).toEqual({ abc: "uid-1@example.com" });
    expect(toIcsEvent({ id: "abc", status: "cancelled" }, undefined, aliases)?.key).toBe(toIcsEvent(event())?.key);
  });
});

describe("eventAliases", () => {
  it("keeps an alias while Google still lists the event, deleted or not, and drops it after", () => {
    const previous = { abc: "uid-1@example.com", gone: "old@example.com" };
    expect(eventAliases([{ id: "abc", status: "cancelled" }], previous)).toEqual({ abc: "uid-1@example.com" });
    expect(eventAliases([{ id: "n1", iCalUID: nativeUid("n1") }], previous)).toEqual({});
  });
});

describe("toIcsCalendar", () => {
  it("drops status blocks and birthdays, and Gmail's own events only when Gmail is connected", () => {
    const events = [event(), event({ id: "o", iCalUID: "o", eventType: "outOfOffice" }), event({ id: "b", iCalUID: "b", eventType: "birthday" }), event({ id: "g", iCalUID: "g", eventType: "fromGmail" })];
    expect(toIcsCalendar("Travel", events, { mailboxImported: true }).events).toHaveLength(1);
    expect(toIcsCalendar("Travel", events, { mailboxImported: false }).events).toHaveLength(2);
    expect(toIcsCalendar("TripIt", [], { mailboxImported: false }).prodId).toBe("Google Calendar: TripIt");
  });
});

describe("sameAccount", () => {
  it("skips Gmail-made events only for the mailbox Gmail imports", () => {
    expect(sameAccount("Me@Example.com", "me@example.com")).toBe(true);
    expect(sameAccount("other@example.com", "me@example.com")).toBe(false);
    expect(sameAccount(undefined, "me@example.com")).toBe(false);
  });
});

describe("mergeCalendarList", () => {
  it("keeps choices and results, adds new calendars unchosen and drops gone ones", () => {
    const existing: GoogleCalendarChoice[] = [
      { id: "a", summary: "Old name", selected: true, lastResult: "1 imported" },
      { id: "gone", summary: "Gone", selected: true },
    ];
    expect(mergeCalendarList(existing, [{ id: "a", summary: "Travel", primary: true }, { id: "b", summary: "Work" }])).toEqual([
      { id: "a", summary: "Travel", primary: true, selected: true, lastResult: "1 imported" },
      { id: "b", summary: "Work", selected: false },
    ]);
  });
});

describe("withResults", () => {
  it("records results without undoing a choice made while reading", () => {
    const current: GoogleCalendarChoice[] = [{ id: "a", summary: "Travel", selected: false }, { id: "b", summary: "Work", selected: true }];
    const results: GoogleCalendarChoice[] = [{ id: "a", summary: "Travel", selected: true, lastReadAt: "2030-01-01T00:00:00Z", lastResult: "1 imported" }];
    expect(withResults(current, results)).toEqual([
      { id: "a", summary: "Travel", selected: false, lastReadAt: "2030-01-01T00:00:00Z", lastResult: "1 imported" },
      { id: "b", summary: "Work", selected: true },
    ]);
  });
});

describe("readCalendar", () => {
  const choice: GoogleCalendarChoice = { id: "travel@example.com", summary: "Travel", selected: true, lastError: "old" };
  const io = (events: CalendarIo["events"]): CalendarIo & { logs: unknown[][]; store: ReturnType<typeof memoryStore> } => {
    const logs: unknown[][] = [];
    const store = memoryStore();
    const deps: ImportDeps = { store, extract: async () => flight, now: () => "2030-01-01T00:00:00Z", log: (...a) => void logs.push(a) };
    const saved = new Map<string, Record<string, string>>();
    const aliases = { load: async (id: string) => saved.get(id) ?? {}, save: async (id: string, a: Record<string, string>) => void saved.set(id, a) };
    return { events, aliases, mailboxImported: false, deps, logs, store };
  };

  it("imports a chosen calendar's events and says what it did", async () => {
    const env = io(async () => ({ events: [event()], zone: "Europe/London" }));
    const result = await readCalendar("u1", choice, env);
    expect(result).toEqual({ id: choice.id, summary: "Travel", selected: true, lastReadAt: "2030-01-01T00:00:00Z", lastResult: "1 imported" });
    expect(env.store.trips.size).toBe(1);
    // Read again, nothing is imported twice; a deletion removes the booking.
    await readCalendar("u1", choice, env);
    expect(env.store.segments.size).toBe(1);
    // Google may send a deleted event with its id alone.
    const deleted: CalendarIo = { ...env, events: async () => ({ events: [{ id: "abc", status: "cancelled" }] }) };
    expect((await readCalendar("u1", choice, deleted)).lastResult).toBe("0 imported, 1 removed as cancelled");
    expect(env.store.segments.size).toBe(0);
  });

  it("records a failure for the owner instead of throwing, and logs no calendar address", async () => {
    const env = io(async () => Promise.reject(new Error("Backend Error")));
    const failed = await readCalendar("u1", choice, env);
    expect(failed.lastError).toBe("This calendar could not be read; it will be tried again tomorrow.");
    expect(JSON.stringify(env.logs)).not.toContain("travel@example.com");
    const withdrawn = await readCalendar("u1", choice, io(async () => Promise.reject(Object.assign(new Error("invalid_grant"), { response: { data: { error: "invalid_grant" } } }))));
    expect(withdrawn.lastError).toBe("Google Calendar access was withdrawn; disconnect and connect it again.");
  });
});
