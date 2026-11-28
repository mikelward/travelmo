import { expect, test } from "@playwright/test";
import { owner, signIn } from "./helpers";
import { clearData, readPerson, seedPerson } from "./seed";

test.beforeEach(async () => {
  await clearData();
});

test("Profile shows You at the top, switches with Change, and merges with Also me", async ({ page }) => {
  const uid = await signIn(page, owner);
  // Mum's forwarded bookings name her more often; the user's own mail names them.
  await seedPerson(uid, { id: "mum", name: "Pat Example", bookings: 6, direct: 0 });
  await seedPerson(uid, { id: "me", name: "Sam Example", bookings: 4, direct: 4 });
  await seedPerson(uid, { id: "alt", name: "S Example", bookings: 1, direct: 0 });
  await page.goto("/profile");
  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("button", { name: /^People/ }).click();

  const you = page.getByLabel("You");
  await expect(you).toContainText("Sam Example");
  const people = page.getByRole("list", { name: "People" });
  await expect(people.getByRole("listitem")).toHaveText([/Pat Example\s*Also me/, /S Example\s*Also me/]);

  // "Also me" merges another spelling into You in one tap and shows it under You.
  await people.getByRole("listitem").filter({ hasText: "S Example" }).getByRole("button", { name: "Also me" }).click();
  await expect(you).toContainText("Also: S Example");
  await expect.poll(async () => (await readPerson(uid, "me"))?.aliases).toEqual(["S Example"]);
  await expect.poll(async () => await readPerson(uid, "alt")).toBeUndefined();

  // "Change" switches who You is.
  await you.getByRole("button", { name: "Change" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pat Example" }).click();
  await expect(you).toContainText("Pat Example");
  await expect.poll(async () => (await readPerson(uid, "mum"))?.me).toBe(true);
});

test("Same person as… merges two people, keeping every spelling", async ({ page }) => {
  const uid = await signIn(page, owner);
  await seedPerson(uid, { id: "now", name: "Pat Example", aliases: ["P Example"], bookings: 6, direct: 0 });
  await seedPerson(uid, { id: "before", name: "Pat Sample", aliases: ["SAMPLE/PAT MS"], bookings: 2, direct: 0 });
  await seedPerson(uid, { id: "me", name: "Sam Example", bookings: 4, direct: 4 });
  await page.goto("/profile");
  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("button", { name: /^People/ }).click();
  const people = page.getByRole("list", { name: "People" });
  await people.getByRole("listitem").filter({ hasText: "Pat Sample" }).getByRole("button", { name: "Same person as…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pat Example" }).click();
  await expect(people.getByRole("listitem")).toHaveCount(1);
  await expect(people.getByRole("listitem").first()).toContainText("Also: P Example, Pat Sample, SAMPLE/PAT MS");
  await expect.poll(async () => (await readPerson(uid, "now"))?.aliases).toEqual(["P Example", "Pat Sample", "SAMPLE/PAT MS"]);
  await expect.poll(async () => await readPerson(uid, "before")).toBeUndefined();
});
