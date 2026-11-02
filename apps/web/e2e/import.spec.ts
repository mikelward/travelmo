import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData } from "./seed";

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
  await page.getByText("Not imported").click();
  await expect(page.getByText("(untitled): notes are not bookings")).toBeVisible();
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
