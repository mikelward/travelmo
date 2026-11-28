import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, readSegments, readTrip, seedFlight, seedTrip } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

// Invented: one flight booked on the 15th and again, elsewhere, on the 17th.
const gatwick = { name: "London Gatwick", code: "LGW", city: "London", country: "GB" };
const dubai = { name: "Dubai", code: "DXB", city: "Dubai", country: "AE" };

async function seedTwice(ownerUid: string) {
  await seedTrip(ownerUid, "e2e-dubai", {}, { title: "Dubai", start: "2026-12-12", end: "2026-12-19" });
  await seedFlight("e2e-dubai", { id: "taken", title: "XX 10 LGW to DXB", start: "2026-12-15T20:25:00+00:00", end: "2026-12-16T07:20:00+04:00", origin: gatwick, destination: dubai });
  await seedFlight("e2e-dubai", { id: "old", title: "XX 10 LGW to DXB", start: "2026-12-17T21:45:00+00:00", end: "2026-12-18T07:35:00+04:00", origin: gatwick, destination: dubai });
}

test("a flight booked on two days asks which wasn't taken, and Mark cancelled settles it", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTwice(ownerUid);
  await page.goto("/trips/e2e-dubai");
  const notice = page.getByTestId("duplicate-flight");
  await expect(notice).toContainText("XX 10 LGW to DXB is booked on 15 Dec and 17 Dec.");
  await notice.getByRole("button", { name: "Mark 17 Dec cancelled" }).click();
  await expect.poll(async () => (await readSegments("e2e-dubai")).find((s) => s.id === "old")?.cancelledAt).toBeTruthy();
  await expect(notice).toBeHidden();
});

test("Both were taken stops asking", async ({ page }) => {
  const ownerUid = await signIn(page, owner);
  await seedTwice(ownerUid);
  await page.goto("/trips/e2e-dubai");
  await page.getByTestId("duplicate-flight").getByRole("button", { name: "Both were taken" }).click();
  await expect.poll(async () => (await readTrip("e2e-dubai"))?.bothTaken).toEqual(["old|taken"]);
  await expect(page.getByTestId("duplicate-flight")).toBeHidden();
});
