import { expect, test } from "@playwright/test";
import { bookingAction, owner, partner, signIn, signOut } from "./helpers";
import { gmailIdPrefix } from "@travelmo/core";
import { clearData, readSegments, seedGmail, seedTrip } from "./seed";

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
  await bookingAction(page, "Sources");
  const sources = page.getByRole("dialog", { name: "Sources" });
  await expect(sources.getByRole("link", { name: "Your stay at Cove" })).toHaveAttribute(
    "href",
    "https://mail.google.com/mail/u/?authuser=owner.mail%40example.com#all/m1",
  );
  await expect(sources.getByRole("link", { name: "Your stay is coming up" })).toHaveAttribute(
    "href",
    "https://mail.google.com/mail/u/?authuser=owner%40work.example#all/m7",
  );
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
  await bookingAction(page, "Sources");
  const sources = page.getByRole("dialog", { name: "Sources" });
  await expect(sources.getByTestId("segment-sources")).toHaveText("Your stay at CoveEmailLiverpool weekendTripIt");
  await expect(sources).toContainText("From cove.example · Always import this sender");
  await expect(sources.getByRole("link", { name: "Your stay at Cove" })).toHaveAttribute("href", /^https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/m1$/);
  // Closing it puts focus back on the booking's menu button.
  await page.keyboard.press("Escape");
  await expect(sources).toBeHidden();
  await expect(page.getByRole("button", { name: "Booking actions" })).toBeFocused();

  await page.getByPlaceholder("partner@example.com").fill(partner);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(partner, { exact: true })).toBeVisible();

  await signOut(page);
  await signIn(page, partner);
  const card = page.getByRole("link", { name: /Liverpool/ });
  await expect(card).toBeVisible();
  await expect(card.getByText("Shared")).toBeVisible();
  await card.click();

  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
  // The email is in the owner's mailbox, so a partner sees it named, not linked.
  await bookingAction(page, "Sources");
  const partnerSources = page.getByRole("dialog", { name: "Sources" });
  await expect(partnerSources.getByTestId("segment-sources")).toContainText("Your stay at Cove");
  await expect(partnerSources.getByRole("link")).toHaveCount(0);
  // With no reference and no other trip, the menu leaves those out.
  await partnerSources.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Booking actions" }).first().click();
  await expect(page.getByRole("menuitem")).toHaveText(["Sources", "Edit", "Delete"]);
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
  await expect(page.getByText("FR 123 MAN to DUB", { exact: true })).toBeVisible();
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
});

test("a booking's menu copies its reference and moves it to another trip", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip", { confirmation: "CV1234" });
  await seedTrip(ownerUid, "e2e-other", {}, { title: "Manchester", start: "2027-01-08", end: "2027-01-09" });
  await page.getByRole("link", { name: /^Liverpool/ }).click();
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Booking actions" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Copy reference", "Sources", "Edit", "Move to another trip…", "Delete"]);
  await page.getByRole("menuitem", { name: "Copy reference" }).click();
  await expect(page.getByRole("status")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("CV1234");

  await bookingAction(page, "Move to another trip…");
  await page.getByRole("dialog", { name: "Move to another trip" }).getByRole("button", { name: /Manchester/ }).click();
  await expect.poll(async () => (await readSegments("e2e-other")).map((s) => s.title).sort()).toEqual(["Cove Liverpool", "Cove Liverpool"]);
});
