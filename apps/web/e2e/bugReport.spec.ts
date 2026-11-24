import { expect, test, type Page } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, seedFlight, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// The parser is stubbed; what it does with a report is its own tests' concern.
async function stubReports(page: Page, status = 200): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = [];
  await page.route("http://localhost:8080/reports", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill(status === 200 ? { status, json: { id: "r1" } } : { status, body: "Too many reports today" });
  });
  return bodies;
}

test("a report from a trip's page says what goes and sends what was written with the trip's bookings", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip", { confirmation: "CV123", destination: { name: "Cove Liverpool", address: "39 Paradise Street", city: "Liverpool", country: "GB", lat: 53.4, lon: -2.98 } });
  await seedFlight("e2e-trip");
  const bodies = await stubReports(page);

  await page.goto("/trips/e2e-trip");
  await expect(page.getByText("Cove Liverpool", { exact: true })).toBeVisible();
  await page.getByRole("contentinfo").getByRole("button", { name: "Report a bug" }).click();
  const dialog = page.getByRole("dialog", { name: "Report a bug" });
  await expect(
    dialog.getByText(
      "We'll see this trip's bookings, including addresses, confirmation numbers and names, plus this page's address and your browser. We use them only to fix the problem.",
    ),
  ).toBeVisible();
  // Nothing written, nothing to send.
  await expect(dialog.getByRole("button", { name: "Send" })).toBeDisabled();
  await dialog.getByLabel("What went wrong?").fill("The hotel shows in the wrong city");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByText("Sent. We'll reply by email.")).toBeVisible();

  expect(bodies).toHaveLength(1);
  const [body] = bodies;
  expect(body).toMatchObject({ text: "The hotel shows in the wrong city", page: "/trips/e2e-trip", app: "web" });
  expect(typeof body!.version).toBe("string");
  expect(body!.userAgent).toBe(await page.evaluate(() => navigator.userAgent));
  const trip = body!.trip as { id: string; title: string; bookings: { id: string; confirmation?: string; destination?: unknown }[] };
  expect(trip.id).toBe("e2e-trip");
  expect(trip.title).toBe("Liverpool");
  expect(trip.bookings.map((b) => b.id).sort()).toEqual(["e2e-trip-flight", "e2e-trip-stay"]);
  const stay = trip.bookings.find((b) => b.id === "e2e-trip-stay")!;
  expect(stay.confirmation).toBe("CV123");
  expect(stay.destination).toEqual({ name: "Cove Liverpool", address: "39 Paradise Street", city: "Liverpool", country: "GB", lat: 53.4, lon: -2.98 });

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("a report from elsewhere carries no bookings, and a refusal says why", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");
  const bodies = await stubReports(page, 429);

  await page.goto("/settings");
  await page.getByRole("contentinfo").getByRole("button", { name: "Report a bug" }).click();
  const dialog = page.getByRole("dialog", { name: "Report a bug" });
  await expect(dialog.getByText("We'll see this page's address and your browser. We use them only to fix the problem.")).toBeVisible();
  await dialog.getByLabel("What went wrong?").fill("Settings won't load");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog.getByText("Couldn't send the report. You've sent the most reports for today. Try again tomorrow.")).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ text: "Settings won't load", page: "/settings", app: "web" });
  expect(bodies[0]).not.toHaveProperty("trip");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("signed out, there is nothing to report from", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByRole("contentinfo").getByRole("button", { name: "Report a bug" })).toHaveCount(0);
});
