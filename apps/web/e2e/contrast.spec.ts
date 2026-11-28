import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { contrastRatio, openBooking, owner, partner, signIn } from "./helpers";
import { clearData, seedFeed, seedFlight, seedGmail, seedLisbonTrip, seedTravelProfile, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// Text against WCAG AA (axe's color-contrast rule); then what axe does not
// check: placeholders at 4.5:1, and the outline of each text field and
// dropdown at 3:1, against the page.
async function expectReadable(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`))).toEqual([]);
  const fields = await page.locator("input:not([type=checkbox]):not([type=file]):not([type=hidden]), select, textarea").evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({
        label: el.outerHTML.slice(0, 80),
        border: getComputedStyle(el).borderTopColor,
        placeholder: el.hasAttribute("placeholder") ? getComputedStyle(el, "::placeholder").color : undefined,
      })),
  );
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(fields.filter((f) => contrastRatio(f.border, background) < 3).map((f) => `${f.label}: outline ${f.border}`)).toEqual([]);
  expect(
    fields.filter((f) => f.placeholder && contrastRatio(f.placeholder, background) < 4.5).map((f) => `${f.label}: placeholder ${f.placeholder}`),
  ).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`every main page is readable in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    // Native controls, such as a dropdown's list, are drawn in the same scheme.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain(colorScheme);
    await expectReadable(page);
    // A keyboard user sees which control has focus, even on a filled button.
    const signInButton = page.getByRole("button", { name: "Sign in with Google" });
    await signInButton.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(signInButton).toBeFocused();
    const ring = await signInButton.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, color: s.outlineColor, offset: parseFloat(s.outlineOffset) };
    });
    expect(ring.style).toBe("solid");
    expect(ring.offset).toBeGreaterThan(0);
    const pageBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(contrastRatio(ring.color, pageBackground)).toBeGreaterThanOrEqual(3);

    const uid = await signIn(page, owner);
    await seedTrip(uid, "e2e-trip", {}, { sharedWith: [partner] });
    await seedFlight("e2e-trip", { confirmation: "XX1234" });
    await seedTrip(uid, "e2e-other", {}, { title: "Paris", start: "2027-01-08", end: "2027-01-09" });
    await seedLisbonTrip(uid, "e2e-lisbon");
    await seedTravelProfile(uid, {
      ownerEmail: owner,
      trustedEmails: [],
      documents: [{ title: "Travel document: Passport", fields: [{ label: "Expiration date", value: "2027-03-01" }, { label: "Issuing country", value: "GB" }] }],
      loyalty: [],
      travelers: [],
    });
    await seedGmail(uid, {
      emailAddress: "traveler@example.com",
      connectedAt: "2026-11-01T00:00:00Z",
      backfill: { scanned: 300, imported: 0, failed: 3, failures: 6, done: false, running: false, updatedAt: "2026-11-01T00:00:00Z" },
    });
    await seedFeed(uid, { id: "f1", url: "https://feeds.example.com/trips.ics", addedAt: "2026-11-01T00:00:00Z", lastError: "The feed answered 404." });

    await page.goto("/");
    await expect(page.getByRole("link", { name: /Paris/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Document warnings" })).toBeVisible();
    await expectReadable(page);

    await page.goto("/trips/e2e-trip");
    await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();
    // The booking menu and its Sources dialog, as well as the page.
    await page.getByRole("button", { name: "Booking actions" }).first().click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectReadable(page);
    await page.keyboard.press("Escape");
    const sources = await openBooking(page, "Cove Liverpool");
    await expect(sources).toBeVisible();
    await expectReadable(page);
    await sources.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Add a booking" }).click();
    await expect(page.getByRole("combobox", { name: "Type" })).toBeVisible();
    await expectReadable(page);

    await page.goto("/settings");
    await expect(page.getByText("Reading stopped after repeated errors", { exact: false })).toBeVisible();
    await expectReadable(page);
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: /^Calendars/ }).click();
    await expect(page.getByText("The feed answered 404.")).toBeVisible();
    await expectReadable(page);

    for (const [path, ready] of [
      ["/reports", page.getByTestId("summary")],
      ["/calendar", page.getByRole("heading", { level: 1, name: "November 2026" })],
      ["/profile", page.getByText("Travel document: Passport")],
      ["/privacy", page.getByRole("heading", { level: 1 })],
    ] as const) {
      await page.goto(path);
      await expect(ready).toBeVisible();
      await expectReadable(page);
    }
  });
}

test("the page follows a change of the system's color scheme without a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/privacy");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await background()).toBe("rgb(255, 255, 255)");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background()).toBe("rgb(10, 10, 10)");
});
