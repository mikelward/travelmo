import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { gmailIdPrefix } from "@travelmo/core";
import { clearData, seedFeed, seedGmail, seedGoogleCalendar, seedImap, seedLegacyGmail } from "./seed";

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
  expect(sent).toEqual([{ emailAddress: "traveler@example.com" }]);
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
  expect(sent[1]).toEqual({ emailAddress: "traveler@example.com" });
});

test("several Gmail accounts each import and disconnect on their own", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedGmail(uid, {
    emailAddress: "traveler@example.com",
    connectedAt: "2026-11-01T00:00:00Z",
    backfill: { scanned: 900, imported: 3, done: true, updatedAt: "2026-11-01T00:00:00Z" },
  });
  await seedGmail(uid, { emailAddress: "trips@example.org", connectedAt: "2026-11-02T00:00:00Z", idPrefix: gmailIdPrefix("trips@example.org") });
  const sent: { path: string; body: unknown }[] = [];
  for (const path of ["/gmail/backfill", "/gmail/disconnect"]) {
    await page.route(`http://localhost:8080${path}`, async (route) => {
      sent.push({ path, body: route.request().postDataJSON() });
      await route.fulfill(
        path === "/gmail/disconnect"
          ? { status: 204 }
          : { json: { progress: { scanned: 0, imported: 0, done: false, running: true, updatedAt: new Date().toISOString() } } },
      );
    });
  }
  await page.goto("/settings");
  const mailboxes = page.getByTestId("gmail-mailbox");
  await expect(mailboxes).toHaveCount(2);
  const first = mailboxes.filter({ hasText: "traveler@example.com" });
  const second = mailboxes.filter({ hasText: "trips@example.org" });
  await expect(first.getByTestId("backfill-progress")).toHaveText("Whole mailbox read: 900 booking-like emails read, 3 bookings imported.");
  await expect(second.getByTestId("backfill-progress")).toHaveCount(0);
  await second.getByRole("button", { name: "Import past bookings" }).click();
  await expect.poll(() => sent).toEqual([{ path: "/gmail/backfill", body: { emailAddress: "trips@example.org" } }]);
  await first.getByRole("button", { name: "Disconnect" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ path: "/gmail/disconnect", body: { emailAddress: "traveler@example.com" } });
  await expect(page.getByRole("button", { name: "Connect another Gmail account" })).toBeVisible();
});

test("no more Gmail accounts can be connected past the limit", async ({ page }) => {
  const uid = await signIn(page, owner);
  for (let i = 0; i < 5; i++) await seedGmail(uid, { emailAddress: `box${i}@example.com`, connectedAt: `2026-11-0${i + 1}T00:00:00Z` });
  await page.goto("/settings");
  await expect(page.getByTestId("gmail-mailbox")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Connect another Gmail account" })).toHaveCount(0);
  await expect(page.getByText("You can connect up to 5 Gmail accounts. Disconnect one to connect another.")).toBeVisible();
});

test("a Gmail account connected before there could be several still shows", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedLegacyGmail(uid, { emailAddress: "traveler@example.com", connectedAt: "2026-11-01T00:00:00Z" });
  await page.goto("/settings");
  await expect(page.getByTestId("gmail-mailbox")).toHaveText(/traveler@example\.com/);
  await expect(page.getByRole("button", { name: "Connect another Gmail account" })).toBeVisible();
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
  await expect.poll(() => sent).toEqual([{ emailAddress: "traveler@example.com", restart: true }]);
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

test("another mailbox connects over IMAP with an app password, the server filled in for known providers", async ({ page }) => {
  const uid = await signIn(page, owner);
  const sent: unknown[] = [];
  await page.route("http://localhost:8080/imap/connect", async (route) => {
    const body = route.request().postDataJSON() as { emailAddress: string };
    sent.push(body);
    await seedImap(uid, { emailAddress: body.emailAddress, connectedAt: "2026-11-01T00:00:00Z" });
    await route.fulfill({ json: { emailAddress: body.emailAddress } });
  });
  await page.goto("/settings");
  const form = page.getByTestId("imap-connect");
  await expect(form.getByRole("link", { name: "iCloud" })).toHaveAttribute("href", "https://support.apple.com/en-us/102654");
  await form.getByLabel("Email address").fill("traveler@icloud.com");
  await expect(form.getByLabel("Server")).toHaveCount(0);
  await form.getByLabel("App password").fill("abcd-efgh-ijkl-mnop");
  await expect(form.getByLabel("App password")).toHaveAttribute("type", "password");
  await form.getByRole("button", { name: "Connect" }).click();
  await expect.poll(() => sent).toEqual([{ emailAddress: "traveler@icloud.com", password: "abcd-efgh-ijkl-mnop" }]);
  await expect(page.getByText("Connected traveler@icloud.com. Import your past bookings below.")).toBeVisible();
  await expect(page.getByTestId("imap-mailbox")).toHaveText(/traveler@icloud\.com/);
  await expect(form.getByLabel("App password")).toHaveValue("");

  // Another provider's server is the user's to name.
  await form.getByLabel("Email address").fill("me@example.org");
  await form.getByLabel("App password").fill("secret");
  await expect(form.getByRole("button", { name: "Connect" })).toBeDisabled();
  await form.getByLabel("Server").fill("imap.example.org");
  await form.getByRole("button", { name: "Connect" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ emailAddress: "me@example.org", password: "secret", server: "imap.example.org" });
});

test("at the limit, a connected IMAP mailbox can still be given a new app password", async ({ page }) => {
  const uid = await signIn(page, owner);
  for (let i = 1; i <= 5; i++) await seedImap(uid, { emailAddress: `me${i}@icloud.com`, connectedAt: `2026-11-0${i}T00:00:00Z`, loginFailedAt: "2026-11-20T00:00:00Z" });
  const sent: unknown[] = [];
  await page.route("http://localhost:8080/imap/connect", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { emailAddress: "me1@icloud.com" } });
  });
  await page.goto("/settings");
  await expect(page.getByTestId("imap-mailbox")).toHaveCount(5);
  await expect(page.getByText("You can connect up to 5 mailboxes this way.", { exact: false })).toBeVisible();
  const form = page.getByTestId("imap-connect");
  await form.getByLabel("Email address").fill("me1@icloud.com");
  await form.getByLabel("App password").fill("new-app-password");
  await form.getByRole("button", { name: "Connect" }).click();
  await expect.poll(() => sent).toEqual([{ emailAddress: "me1@icloud.com", password: "new-app-password" }]);
});

test("Gmail and Fastmail addresses are sent to their own sections", async ({ page }) => {
  await signIn(page, owner);
  await page.goto("/settings");
  const form = page.getByTestId("imap-connect");
  await form.getByLabel("Email address").fill("me@gmail.com");
  await expect(form.getByText("For a Gmail address, use Connect Gmail above.")).toBeVisible();
  await form.getByLabel("App password").fill("secret");
  await expect(form.getByRole("button", { name: "Connect" })).toBeDisabled();
  await form.getByLabel("Email address").fill("me@fastmail.com");
  await expect(form.getByText("For a Fastmail address, use the Fastmail section above.")).toBeVisible();
});

test("each IMAP mailbox imports past bookings and disconnects on its own", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedImap(uid, {
    emailAddress: "traveler@icloud.com",
    connectedAt: "2026-11-01T00:00:00Z",
    backfill: { scanned: 40, imported: 2, done: true, updatedAt: "2026-11-01T00:00:00Z" },
  });
  await seedImap(uid, { emailAddress: "trips@yahoo.com", connectedAt: "2026-11-02T00:00:00Z", loginFailedAt: "2026-11-03T00:00:00Z" });
  const sent: { path: string; body: unknown }[] = [];
  for (const path of ["/imap/backfill", "/imap/disconnect"]) {
    await page.route(`http://localhost:8080${path}`, async (route) => {
      sent.push({ path, body: route.request().postDataJSON() });
      await route.fulfill(
        path === "/imap/disconnect"
          ? { status: 204 }
          : { json: { progress: { scanned: 0, imported: 0, done: false, running: true, updatedAt: new Date().toISOString() } } },
      );
    });
  }
  await page.goto("/settings");
  const mailboxes = page.getByTestId("imap-mailbox");
  await expect(mailboxes).toHaveCount(2);
  const first = mailboxes.filter({ hasText: "traveler@icloud.com" });
  const second = mailboxes.filter({ hasText: "trips@yahoo.com" });
  await expect(first.getByTestId("imap-backfill-progress")).toHaveText("Whole mailbox read: 40 booking-like emails read, 2 bookings imported.");
  await expect(second.getByText("The server turned down the app password. Connect again with a new one.")).toBeVisible();
  await expect(first.getByText("turned down")).toHaveCount(0);
  await second.getByRole("button", { name: "Import past bookings" }).click();
  await expect.poll(() => sent).toEqual([{ path: "/imap/backfill", body: { emailAddress: "trips@yahoo.com" } }]);
  await first.getByRole("button", { name: "Disconnect" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ path: "/imap/disconnect", body: { emailAddress: "traveler@icloud.com" } });
  await expect(page.getByText("Disconnected. Delete the app password with your email provider too.")).toBeVisible();
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
