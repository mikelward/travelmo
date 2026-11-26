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

test("Same person as… merges two people, keeping every spelling", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedPerson(uid, { id: "now", name: "Pat Example", aliases: ["P Example"], bookings: 6, direct: 0 });
  await seedPerson(uid, { id: "before", name: "Pat Sample", aliases: ["SAMPLE/PAT MS"], bookings: 2, direct: 0 });
  await seedPerson(uid, { id: "me", name: "Sam Example", bookings: 4, direct: 4 });
  await page.goto("/profile");
  const people = page.getByRole("list", { name: "People" });
  await people.getByRole("listitem").filter({ hasText: "Pat Sample" }).getByRole("button", { name: "Same person as…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pat Example" }).click();
  await expect(people.getByRole("listitem")).toHaveCount(2);
  await expect.poll(async () => (await readPerson(uid, "now"))?.aliases).toEqual(["P Example", "Pat Sample", "SAMPLE/PAT MS"]);
  await expect.poll(async () => await readPerson(uid, "before")).toBeUndefined();
});
