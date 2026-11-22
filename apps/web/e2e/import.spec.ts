import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedFeed, seedGmail, seedGoogleCalendar } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// Invented data in the export's shape.
const at = (date: string, time: string) => ({ date, time, timezone: "Europe/London", utc_offset: "+00:00" });
const exportFile = {
  Trips: [
    {
      TripData: { display_name: "Example trip", start_date: "2030-01-01", end_date: "2030-01-03" },
      Objects: [
        { Segment: { StartDateTime: at("2030-01-01", "08:00"), start_airport_code: "AAA", end_airport_code: "BBB", marketing_airline_code: "XX", marketing_flight_number: "1" } },
        { text: "A note" },
      ],
    },
  ],
};

test("a TripIt export is previewed in the browser, then sent only when the user imports it", async ({ page }) => {
  await signIn(page, owner);
  const sent: unknown[] = [];
  await page.route("http://localhost:8080/import/tripit", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { trips: 1, imported: 1, duplicates: 0, skipped: 0, failed: 0, notImported: 1 } });
  });
  await page.goto("/settings");

  await page.getByLabel("TripIt export file").setInputFiles({
    name: "tripit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exportFile)),
  });
  await expect(page.getByText("1 trip with 1 booking (1 flight), from 2030-01-01 to 2030-01-01.", { exact: false })).toBeVisible();
  // Items not imported are grouped by reason, the names folded under each.
  await page.getByText("Not imported").click();
  await page.getByText("notes are not bookings (1)").click();
  await expect(page.getByText("(untitled)", { exact: true })).toBeVisible();
  expect(sent).toHaveLength(0);

  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported 1 booking into 1 new or existing trip.")).toBeVisible();
  expect(sent).toEqual([{ export: exportFile }]);
});

test("a file that is not a TripIt export is refused before anything is sent", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/settings");
  await page.getByLabel("TripIt export file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.getByText("This file is not a TripIt export", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
});

test("a calendar file is previewed, then sent as text when the user imports it", async ({ page }) => {
  await signIn(page, owner);
  const sent: unknown[] = [];
  await page.route("http://localhost:8080/import/ics", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { skipped: 0, filtered: 0, not_booking: 0, imported: 1, failed: 0, recurring: 1, cancelled: 0, remaining: 0 } });
  });
  await page.goto("/settings");
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:a",
    "DTSTART:20300101T090000Z",
    "SUMMARY:XX1 AAA to BBB",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:b",
    "DTSTART:20300101T090000Z",
    "RRULE:FREQ=DAILY",
    "SUMMARY:Standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  await page.getByLabel("Calendar file").setInputFiles({ name: "trip.ics", mimeType: "text/calendar", buffer: Buffer.from(ics) });
  await expect(page.getByText("2 events; 1 will be checked for bookings. Skipping 1 repeating event.")).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("1 event imported.")).toBeVisible();
  expect(sent).toEqual([{ text: ics }]);

  // The same file again, as the result asks when events are left over.
  await page.getByLabel("Calendar file").setInputFiles({ name: "trip.ics", mimeType: "text/calendar", buffer: Buffer.from(ics) });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect.poll(() => sent.length).toBe(2);
});

test("a calendar feed is added through the parser and listed by host, with its last result or error", async ({ page }) => {
  const uid = await signIn(page, owner);
  const sent: unknown[] = [];
  await page.route("http://localhost:8080/feeds/add", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { id: "f1", skipped: 0, filtered: 0, not_booking: 0, imported: 2, failed: 0, recurring: 0, cancelled: 0, remaining: 0, removed: 0 } });
  });
  await page.goto("/settings");
  await page.getByLabel("Calendar feed link").fill("webcal://feeds.example.com/ical/SECRET.ics");
  await page.getByRole("button", { name: "Add feed" }).click();
  await expect(page.getByText("2 events imported.")).toBeVisible();
  expect(sent).toEqual([{ url: "webcal://feeds.example.com/ical/SECRET.ics" }]);

  // The parser stores the feed; the page lists it without its secret link.
  await seedFeed(uid, {
    id: "f1",
    url: "https://feeds.example.com/ical/SECRET.ics",
    addedAt: "2026-11-01T00:00:00Z",
    lastFetchedAt: "2026-11-02T03:00:00Z",
    lastError: "The feed answered 404.",
  });
  await expect(page.getByText("feeds.example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("The feed answered 404.")).toBeVisible();
  await expect(page.getByText("SECRET")).toHaveCount(0);
});

test("importing past bookings starts once, then follows the parser's progress", async ({ page }) => {
  const uid = await signIn(page, owner);
  const gmail = { emailAddress: "traveler@example.com", connectedAt: "2026-11-01T00:00:00Z" };
  await seedGmail(uid, gmail);
  const sent: unknown[] = [];
  await page.route("http://localhost:8080/gmail/backfill", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { progress: { scanned: 0, imported: 0, done: false, running: true, updatedAt: new Date().toISOString() } } });
  });
  let stops = 0;
  await page.route("http://localhost:8080/gmail/backfill/stop", async (route) => {
    stops += 1;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Import past bookings" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent).toEqual([{}]);
  // The parser reads on by itself and records how far it got.
  const running = { scanned: 600, imported: 2, done: false, running: true, run: "r1", step: 2, updatedAt: new Date().toISOString() };
  await seedGmail(uid, { ...gmail, backfill: running });
  await expect(page.getByTestId("backfill-progress")).toHaveText(
    "Reading your mailbox… 600 booking-like emails read, 2 bookings imported so far. You can close this page.",
  );
  // Leaving the page and coming back neither stops nor restarts it.
  await page.getByRole("link", { name: "Travelmo" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/settings");
  await expect(page.getByTestId("backfill-progress")).toContainText("Reading your mailbox…");
  expect(sent).toHaveLength(1);
  await page.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => stops).toBe(1);
  await seedGmail(uid, { ...gmail, backfill: { ...running, running: false } });
  await expect(page.getByTestId("backfill-progress")).toHaveText(
    "Stopped part way: 600 booking-like emails read, 2 bookings imported. Continue to read the rest.",
  );
  await page.getByRole("button", { name: "Continue reading past emails" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({});
});

test("a finished reading starts over from the beginning when asked", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedGmail(uid, {
    emailAddress: "traveler@example.com",
    connectedAt: "2026-11-01T00:00:00Z",
    backfill: { scanned: 900, imported: 3, done: true, updatedAt: "2026-11-01T00:00:00Z" },
  });
  const sent: unknown[] = [];
  await page.route("http://localhost:8080/gmail/backfill", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { progress: { scanned: 0, imported: 0, done: false, running: true, updatedAt: new Date().toISOString() } } });
  });
  await page.goto("/settings");
  await expect(page.getByTestId("backfill-progress")).toHaveText("Whole mailbox read: 900 booking-like emails read, 3 bookings imported.");
  await page.getByRole("button", { name: "Read again from the start" }).click();
  await expect.poll(() => sent).toEqual([{ restart: true }]);
});

test("a batch with failed imports pauses the reading and says why", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedGmail(uid, {
    emailAddress: "traveler@example.com",
    connectedAt: "2026-11-01T00:00:00Z",
    backfill: { scanned: 300, imported: 0, failed: 3, lastFailed: 3, done: false, running: false, updatedAt: new Date().toISOString() },
  });
  await page.goto("/settings");
  await expect(page.getByText("Reading paused: 3 emails in the last batch could not be imported.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue reading past emails" })).toBeVisible();
});

test("Google Calendar finishes connecting on return from Google, apart from Gmail", async ({ page }) => {
  await signIn(page, owner);
  const calls: string[] = [];
  await page.route("http://localhost:8080/*/complete", async (route) => {
    calls.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: { emailAddress: "traveler@example.com", calendars: 2 } });
  });
  await page.goto("/settings?calendar=pending&state=abc");
  await expect(page.getByText("Google Calendar connected. Choose the calendars that hold your travel.")).toBeVisible();
  expect(calls).toEqual(["/calendar/complete"]);
});

test("choosing Google calendars saves the choice and shows how each was read", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedGoogleCalendar(uid, {
    emailAddress: "traveler@example.com",
    connectedAt: "2026-11-01T00:00:00Z",
    calendars: [
      { id: "traveler@example.com", summary: "Personal", primary: true, selected: true, lastReadAt: "2026-11-02T04:43:00Z", lastResult: "2 imported" },
      { id: "trips@example.com", summary: "Trips", selected: false },
      { id: "work@example.com", summary: "Work", selected: false, lastError: "never shown: not chosen" },
    ],
  });
  const sent: unknown[] = [];
  await page.route("http://localhost:8080/calendar/select", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { read: 1, failed: 0 } });
  });
  await page.goto("/settings");
  await expect(page.getByText("Read 2026-11-02 · 2 imported")).toBeVisible();
  await expect(page.getByText("never shown")).toHaveCount(0);
  const save = page.getByRole("button", { name: "Save choice" });
  await expect(save).toBeDisabled();
  await page.getByLabel("Trips").check();
  await save.click();
  await expect(page.getByText("Saved; the newly chosen calendars were read.")).toBeVisible();
  expect(sent).toEqual([{ ids: ["traveler@example.com", "trips@example.com"] }]);
});
