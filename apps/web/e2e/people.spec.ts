import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, readPerson, seedPerson } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("Profile lists the people bookings name, guesses which is the user, and takes This is me", async ({ page }) => {
  const uid = await signIn(page, owner);
  // Mum's forwarded bookings name her more often; the user's own mail names them.
  await seedPerson(uid, { id: "mum", name: "Pat Example", bookings: 6, direct: 0 });
  await seedPerson(uid, { id: "me", name: "Sam Example", bookings: 4, direct: 4 });
  await page.goto("/profile");
  const people = page.getByRole("list", { name: "People" });
  await expect(people.getByRole("listitem")).toHaveText([/Pat Example\s*This is me/, /Sam Example\s*You/]);

  await people.getByRole("listitem").filter({ hasText: "Pat Example" }).getByRole("button", { name: "This is me" }).click();
  await expect(people.getByRole("listitem").filter({ hasText: "Pat Example" })).toContainText("You");
  await expect.poll(async () => (await readPerson(uid, "mum"))?.me).toBe(true);
});
