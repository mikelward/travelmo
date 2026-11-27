import { devices, expect, test } from "@playwright/test";
import { bookingAction, openBooking, owner, partner, signIn, signOut } from "./helpers";
import { gmailIdPrefix } from "@travelmo/core";
import { clearData, deleteTripDoc, readSegments, readSenderPatterns, seedFlight, seedGmail, seedTrip, readTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("an imported email opens in the Gmail account it came from", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  const work = "owner@work.example";
  await seedGmail(ownerUid, { emailAddress: "owner.mail@example.com", connectedAt: "2026-11-01T00:00:00Z", idPrefix: "" });
  await seedGmail(ownerUid, { emailAddress: work, connectedAt: "2026-11-02T00:00:00Z", idPrefix: gmailIdPrefix(work) });
  await seedTrip(ownerUid, "e2e-trip", {
    sources: [
      { kind: "gmail", id: "m1", label: "Your stay at Cove", uid: ownerUid, at: "2026-11-01T00:00:00Z" },
      { kind: "gmail", id: `${gmailIdPrefix(work)}m7`, label: "Your stay is coming up", uid: ownerUid, at: "2026-11-03T00:00:00Z" },
    ],
  });
  await page.goto("/trips/e2e-trip");
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();
  const sources = await openBooking(page, "Cove Liverpool");
  await expect(sources.getByRole("link", { name: "Your stay at Cove" })).toHaveAttribute(
    "href",
    "https://mail.google.com/mail/u/?authuser=owner.mail%40example.com#all/m1",
  );
  await expect(sources.getByRole("link", { name: "Your stay is coming up" })).toHaveAttribute(
    "href",
    "https://mail.google.com/mail/u/?authuser=owner%40work.example#all/m7",
  );
});

// Bookings are searched too, not only titles (SPEC "Searching trips").
test("the trips list finds trips by a booking's provider or place, and by date", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-liverpool", { provider: "Cove Hotels" });
  await seedTrip(
    ownerUid,
    "e2e-lisbon",
    { title: "Hotel Avenida", provider: "Hilton", start: "2025-03-28T15:00:00+00:00", end: "2025-04-02T11:00:00+00:00", destination: { name: "Hotel Avenida", city: "Lisbon", country: "PT" } },
    { title: "Portugal", start: "2025-03-28", end: "2025-04-02" },
  );
  await page.goto("/");
  const cards = page.getByRole("link", { name: /Liverpool|Portugal/ });
  await expect(cards).toHaveCount(2);
  await page.getByRole("button", { name: "Search trips" }).click();
  const search = page.getByRole("searchbox", { name: "Search trips" });
  await expect(search).toBeFocused();

  await search.fill("hilton");
  await expect(cards).toHaveText([/Portugal/]);
  await search.fill("lisbon");
  await expect(cards).toHaveText([/Portugal/]);
  await search.fill("December 2026");
  await expect(cards).toHaveText([/Liverpool/]);
  await search.fill("madrid");
  await expect(page.getByText("No trips match.")).toBeVisible();
  await expect(cards).toHaveCount(0);
  await search.fill("");
  await expect(cards).toHaveCount(2);
});

test.describe("on a phone", () => {
  // The device but not its browser type, which a describe block can't set.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, permissions: ["clipboard-read", "clipboard-write"] });

  // Gmail's mobile site drops the link's message id, so a search goes too.
  test("tapping an imported email also copies a search for it", async ({ page, context }) => {
    await context.route("https://mail.google.com/**", (route) => route.fulfill({ body: "" }));
    const ownerUid = await signIn(page, owner);
    await seedTrip(ownerUid, "e2e-trip", {
      sender: "cove.example",
      sources: [{ kind: "gmail", id: "m1", label: "Your stay at Cove", uid: ownerUid, at: "2026-11-01T09:00:00Z", sentAt: "2026-10-31T23:00:00Z" }],
    });
    await page.goto("/trips/e2e-trip");
    const sources = await openBooking(page, "Cove Liverpool");
    await sources.getByRole("link", { name: "Your stay at Cove" }).click();
    await expect(sources.getByText("Search copied. Paste it in Gmail's search.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('from:cove.example subject:"Your stay at Cove" after:2026/10/30 before:2026/11/02');
  });
});

test("a tap on a booking opens its details: the small print, its place in Maps, the reference to copy and a pencil to edit", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip", {
    confirmation: "CV1234",
    provider: "Cove",
    notes: "Late check-in after 22:00",
    destination: { name: "Cove Liverpool", city: "Liverpool", country: "GB", address: "4 Hope Street, Liverpool L1 9AB" },
  });
  await page.goto("/trips/e2e-trip");
  // The row keeps only what tells the bookings apart.
  await expect(page.getByText("Ref CV1234", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Late check-in after 22:00")).toHaveCount(0);
  // A tap anywhere on the row opens it, not only on the title.
  await page.getByText("Check-in 15:00", { exact: false }).click();
  const details = page.getByRole("dialog", { name: "Cove Liverpool" });
  await expect(details).toContainText("Sat 12 Dec");
  await expect(details).toContainText("Late check-in after 22:00");
  await expect(details.getByRole("link", { name: /Cove Liverpool/ })).toHaveAttribute(
    "href",
    "https://www.google.com/maps/search/?api=1&query=Cove%20Liverpool%2C%204%20Hope%20Street%2C%20Liverpool%20L1%209AB",
  );
  await details.getByRole("button", { name: "Ref CV1234" }).click();
  await expect(details.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("CV1234");
  await details.getByRole("button", { name: "Edit" }).click();
  await expect(details).toBeHidden();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
});

test("the owner renames a trip from its menu", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");
  await page.goto("/trips/e2e-trip");
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
  await page.getByRole("button", { name: "Trip actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox").first().fill("Liverpool weekend");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Liverpool weekend" })).toBeVisible();
});

test("the owner sees an imported trip, shares it, and the partner can add a booking", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");

  await expect(page.getByRole("heading", { name: "Liverpool" })).toBeVisible();
  // An upcoming trip's card says only when it is; what comes next is for a trip under way.
  await expect(page.getByRole("link", { name: /Liverpool/ })).toContainText("12–14 Dec 2026");
  await expect(page.getByText("Check-in Cove Liverpool", { exact: false })).toHaveCount(0);
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Liverpool" })).toBeVisible();
  // Next keeps the previous page mounted but hidden across a soft navigation,
  // so text lookups must be exact or role-based to avoid matching it.
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();
  // A booking's type is an icon a screen reader names.
  await expect(page.getByRole("img", { name: "Stay", exact: true })).toBeVisible();
  // Every source of the booking, kept out of the row, the email opening in Gmail for the owner.
  await expect(page.getByText("Your stay at Cove")).toHaveCount(0);
  const sources = await openBooking(page, "Cove Liverpool");
  await expect(sources.getByTestId("segment-sources")).toHaveText("Your stay at CoveEmailLiverpool weekendTripIt");
  await expect(sources).toContainText("From cove.example · Always import this sender · Never import this sender");
  await expect(sources.getByRole("link", { name: "Your stay at Cove" })).toHaveAttribute("href", /^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/m1$/);
  // Closing it puts focus back on the booking that opened it.
  await page.keyboard.press("Escape");
  await expect(sources).toBeHidden();
  await expect(page.getByRole("button", { name: "Cove Liverpool", exact: true })).toBeFocused();

  await page.getByPlaceholder("partner@example.com").fill(partner);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(partner, { exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, partner);
  const card = page.getByRole("link", { name: /Liverpool/ });
  await expect(card).toBeVisible();
  await expect(card.getByText("Shared")).toBeVisible();
  await card.click();

  await expect(page.getByRole("button", { name: "Trip actions" })).toHaveCount(0);
  // The email is in the owner's mailbox, so a partner sees it named, not linked.
  const partnerSources = await openBooking(page, "Cove Liverpool");
  await expect(partnerSources.getByTestId("segment-sources")).toContainText("Your stay at Cove");
  await expect(partnerSources.getByTestId("segment-sources").getByRole("link")).toHaveCount(0);
  // With no reference and no other trip, the menu leaves those out.
  await partnerSources.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Booking actions" }).first().click();
  await expect(page.getByRole("menuitem")).toHaveText(["Directions", "Edit", "Mark cancelled", "Delete"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", { name: "Add a booking" }).click();
  await page.getByPlaceholder("BA 117 LHR to JFK").fill("FR 123 MAN to DUB");
  const startDate = page.locator('input[type="date"]').first();
  await startDate.fill("2026-12-15");
  // Airport codes preselect each end's time zone once the table has loaded.
  const zone = page.getByTitle("Time zone");
  await page.getByPlaceholder("LHR", { exact: true }).fill("MAN");
  await expect(zone.first()).toHaveValue("Europe/London");
  await page.getByPlaceholder("JFK", { exact: true }).fill("DUB");
  await expect(zone.nth(1)).toHaveValue("Europe/Dublin");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // A flight is headed by its airline, its flight number leading the route.
  await expect(page.getByRole("button", { name: "Ryanair", exact: true })).toBeVisible();
  // Its logo sits below the plane, in the row's icon column.
  await expect(page.getByRole("listitem").filter({ hasText: "Ryanair" }).getByTestId("airline-logo")).toBeVisible();
  await expect(page.getByText("FR 123", { exact: true })).toBeVisible();
  await expect(page.getByTestId("trip-dates")).toContainText("12–15 Dec 2026");
});

test("a stranger sees no trips", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-private");
  await signOut(page);
  await signIn(page, "stranger@example.com");
  await expect(page.getByText("No trips yet.")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("a booking's details keep the width beside its actions, and the page fits", async ({ page }) => {
    const ownerUid = await signIn(page, owner);
    await seedTrip(ownerUid, "e2e-trip");
    // Another trip with a long name, once a "Move to" list that widened the row.
    await seedTrip(ownerUid, "e2e-other", {}, { title: "Junior Adventures Group Club Weekend Away", start: "2027-01-08", end: "2027-01-09" });
    await page.getByRole("link", { name: /^Liverpool/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Liverpool" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Booking actions" })).toBeInViewport({ ratio: 1 });
    // Squeezed beside the actions, the title had no width left at all.
    const title = page.getByText("Cove Liverpool", { exact: true });
    expect((await title.boundingBox())?.width).toBeGreaterThan(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });

  // A long title once widened the whole list past the screen, so a phone showed it zoomed out.
  test("the trip list fits, however long a trip's title", async ({ page }) => {
    const ownerUid = await signIn(page, owner);
    await seedTrip(ownerUid, "e2e-trip");
    await seedTrip(ownerUid, "e2e-long", {}, { title: "Holiday Camp East Finchley - Junior Group Summer Session", start: "2026-08-10", end: "2026-08-14" });
    await expect(page.getByTestId("trip-card")).toHaveCount(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
});

test("a booking's menu copies its reference and moves it to another trip", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip", { confirmation: "CV1234" });
  // Its list flags say every booking was cancelled, which the move makes untrue.
  await seedTrip(ownerUid, "e2e-other", {}, { title: "Manchester", start: "2027-01-08", end: "2027-01-09", allCancelled: true, localOnly: false });
  await page.getByRole("link", { name: /^Liverpool/ }).click();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Booking actions" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Directions", "Copy reference", "Edit", "Mark cancelled", "Move to another trip…", "Delete"]);
  // Directions open Google Maps to the stay, in a new tab.
  const directions = page.getByRole("menuitem", { name: "Directions" });
  await expect(directions).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&destination=Cove%20Liverpool");
  await expect(directions).toHaveAttribute("target", "_blank");
  await page.getByRole("menuitem", { name: "Copy reference" }).click();
  await expect(page.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("CV1234");

  // New trip first, then the trips around the booking's dates, the rest behind More.
  await seedTrip(ownerUid, "e2e-near", {}, { title: "Chester", start: "2026-12-20", end: "2026-12-21" });
  await bookingAction(page, "Move to another trip…");
  const dialog = page.getByRole("dialog", { name: "Move to another trip" });
  await expect(dialog.getByRole("button")).toHaveText(["New trip", /^Chester/, "More…", "Close"]);
  await dialog.getByRole("button", { name: "More…" }).click();
  await expect(dialog.getByRole("button")).toHaveText(["New trip", /^Chester/, /^Manchester/, "Close"]);
  await dialog.getByRole("button", { name: /Manchester/ }).click();
  await expect.poll(async () => (await readSegments("e2e-other")).map((s) => s.title).sort()).toEqual(["Cove Liverpool", "Cove Liverpool"]);
  // The trip it went into no longer claims to know, so the list reads its bookings again.
  const other = await readTrip("e2e-other");
  expect(other?.allCancelled).toBeUndefined();
  expect(other?.localOnly).toBeUndefined();
});

test("a booking moved to a new trip gets a trip of its own", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");
  await seedFlight("e2e-trip");
  await page.goto("/trips/e2e-trip");
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();
  await bookingAction(page, "Move to another trip…");
  await page.getByRole("dialog", { name: "Move to another trip" }).getByRole("button", { name: "New trip" }).click();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /^Liverpool/ })).toHaveCount(2);
});

test("Split… moves every booking from one email to a new trip", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");
  // Two flights from someone else's itinerary, filed into the user's trip.
  const theirs = { kind: "gmail" as const, id: "their-email", label: "Their itinerary", at: "2026-11-01T00:00:00Z" };
  await seedFlight("e2e-trip", { gmailMessageIds: [], sources: [theirs] });
  await seedFlight("e2e-trip", { id: "e2e-trip-back", title: "XX 101 DXB to MAN", start: "2026-12-20T09:00:00+04:00", end: "2026-12-20T13:00:00+00:00", gmailMessageIds: [], sources: [theirs] });
  await page.goto("/trips/e2e-trip");
  await expect(page.getByText("XX 101 DXB to MAN", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trip actions" }).click();
  await page.getByRole("menuitem", { name: "Split…" }).click();
  const dialog = page.getByRole("dialog", { name: "Split trip" });
  await dialog.getByRole("button", { name: "Their itinerary (2)" }).click();
  await dialog.getByRole("button", { name: "Move 2 bookings to a new trip" }).click();
  await expect(page).not.toHaveURL(/\/trips\/e2e-trip$/);
  await expect(page.getByText("XX 101 DXB to MAN", { exact: true })).toBeVisible();
  // What the email didn't give stays behind.
  expect((await readSegments("e2e-trip")).map((s) => s.title)).toEqual(["Cove Liverpool"]);
});

test("two bookings of one kind merge into the one whose menu was used", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");
  await seedFlight("e2e-trip");
  await seedFlight("e2e-trip", { id: "e2e-trip-again", title: "XX 100 Manchester to Dubai", gmailMessageIds: ["m3"] });
  await page.goto("/trips/e2e-trip");
  await expect(page.getByText("XX 100 Manchester to Dubai", { exact: true })).toBeVisible();
  // The stay has no other stay to merge with; the flights each have the other.
  await page.getByRole("button", { name: "Booking actions" }).first().click();
  await expect(page.getByRole("menuitem", { name: "Merge with…" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await bookingAction(page, "Merge with…", 1);
  await page.getByRole("dialog", { name: "Merge with" }).getByRole("button", { name: /XX 100/ }).click();
  await expect(page.getByRole("button", { name: "Booking actions" })).toHaveCount(2);
});

test("never importing a sender offers to delete what it already imported", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  // A trip with a flight and a stay, and a trip of nothing but another stay from the same sender.
  await seedTrip(ownerUid, "e2e-trip");
  await seedFlight("e2e-trip");
  await seedTrip(ownerUid, "e2e-class", {}, { title: "Class", start: "2026-12-19", end: "2026-12-20" });
  await page.goto("/trips/e2e-trip");
  await expect(page.getByRole("heading", { level: 1, name: "Liverpool" })).toBeVisible();
  await (await openBooking(page, "Cove Liverpool")).getByRole("button", { name: "Never import this sender" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete what it imported?" });
  await expect(confirm).toContainText("Mail from cove.example won’t be imported again. Delete 1 trip and 1 booking already imported from it?");
  await expect.poll(async () => (await readSenderPatterns(ownerUid))?.deny).toEqual(["cove.example"]);
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await readSegments("e2e-trip")).map((s) => s.type)).toEqual(["flight"]);
  await expect.poll(async () => (await readSegments("e2e-class")).length).toBe(0);
});

test("a booking that arrives while the offer is open keeps its trip", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");
  await seedTrip(ownerUid, "e2e-class", {}, { title: "Class", start: "2026-12-19", end: "2026-12-20" });
  await page.goto("/trips/e2e-trip");
  await (await openBooking(page, "Cove Liverpool")).getByRole("button", { name: "Never import this sender" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete what it imported?" });
  await expect(confirm).toContainText("Delete 2 trips already imported from it?");
  // Another sender's booking lands in the class trip before the answer.
  await seedFlight("e2e-class");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(async () => (await readSegments("e2e-class")).map((s) => s.type)).toEqual(["flight"]);
  await expect.poll(async () => (await readSegments("e2e-trip")).length).toBe(0);
});

test("a cleanup that deleted this trip and then failed is still there to retry", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  // This trip is nothing but the sender's stay; the other has a flight too.
  await seedTrip(ownerUid, "e2e-trip");
  await seedTrip(ownerUid, "e2e-other", {}, { title: "Other", start: "2026-12-19", end: "2026-12-20" });
  await seedFlight("e2e-other");
  await page.goto("/trips/e2e-trip");
  await (await openBooking(page, "Cove Liverpool")).getByRole("button", { name: "Never import this sender" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete what it imported?" });
  await expect(confirm).toContainText("Delete 1 trip and 1 booking already imported from it?");
  // The other trip goes elsewhere, so deleting its stay fails after this trip is gone.
  await deleteTripDoc("e2e-other");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("This trip does not exist or is not shared with you.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Delete what it imported?" })).toBeVisible();
});
