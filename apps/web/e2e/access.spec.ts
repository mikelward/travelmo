import { expect, test, type Page } from "@playwright/test";
import { owner, signIn, signOut } from "./helpers";
import { clearData, seedLinkedEmails, seedTrip, setAdmins } from "./seed";

const admin = "admin@example.com";
const newcomer = "newcomer@example.com";

test.beforeEach(async () => {
  await clearData();
  await setAdmins([admin]);
});

// The parser is stubbed: what it settles and whom it tells are its own
// tests' concern. Returns the calls it got.
async function stubCheck(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route("http://localhost:8080/access/check", async (route) => {
    calls.push(route.request().headers()["authorization"] ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "none" }) });
  });
  return calls;
}

async function signOutWaiting(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
}

test("a new account asks for access, and an admin approves it", async ({ page }) => {
  const calls = await stubCheck(page);
  await signIn(page, newcomer, { approved: false });
  await expect(page.getByRole("heading", { name: "Travelmo is invite-only" })).toBeVisible();
  await expect(page.getByText(`You're signed in as ${newcomer}.`, { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Trips" })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Travelmo is invite-only" })).toBeVisible();

  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByText("Request sent. Travelmo opens here once it's approved.")).toBeVisible();
  // Once on opening, once after asking, so the admins hear of it.
  await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2);
  expect(calls.every((c) => c.startsWith("Bearer "))).toBe(true);
  await signOutWaiting(page);

  await signIn(page, admin, { approved: false });
  await page.getByRole("link", { name: "Access" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Access" })).toBeVisible();
  const request = page.getByRole("listitem").filter({ hasText: newcomer });
  await expect(request).toBeVisible();
  await request.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("No requests.")).toBeVisible();
  const approved = page.getByRole("listitem").filter({ hasText: newcomer });
  await expect(approved.getByRole("button", { name: "Revoke" })).toBeVisible();
  // The admin is listed too, and cannot revoke themself.
  await expect(page.getByRole("listitem").filter({ hasText: admin })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: admin }).getByRole("button", { name: "Revoke" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, newcomer, { approved: false });
  await expect(page.getByText("No trips yet.")).toBeVisible();
});

test("an admin invites an address, and revoking it shuts the app again", async ({ page }) => {
  await stubCheck(page);
  await signIn(page, admin, { approved: false });
  await page.goto("/access");
  await page.getByLabel("Email address to invite").fill(" Newcomer@Example.com ");
  await page.getByRole("button", { name: "Invite" }).click();
  const invited = page.getByRole("listitem").filter({ hasText: newcomer });
  await expect(invited).toBeVisible();
  await signOut(page);

  await signIn(page, newcomer, { approved: false });
  await expect(page.getByText("No trips yet.")).toBeVisible();
  await signOut(page);

  await signIn(page, admin, { approved: false });
  await page.goto("/access");
  await page.getByRole("listitem").filter({ hasText: newcomer }).getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: newcomer })).toHaveCount(0);
  await signOut(page);

  await signIn(page, newcomer, { approved: false });
  await expect(page.getByText(`Your request for ${newcomer} wasn't approved.`)).toBeVisible();
});

test("sharing a trip lets the address in without asking", async ({ page }) => {
  await stubCheck(page);
  const ownerUid = await signIn(page, owner);
  await seedTrip(ownerUid, "e2e-trip");
  await page.getByRole("link", { name: /Liverpool/ }).click();
  await page.getByPlaceholder("partner@example.com").fill(newcomer);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(newcomer, { exact: true })).toBeVisible();
  // Only admins see the Access page.
  await expect(page.getByRole("link", { name: "Access" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, newcomer, { approved: false });
  await expect(page.getByRole("link", { name: /Liverpool/ }).getByText("Shared")).toBeVisible();
});

test("linking an admin's address opens the Access page without a reload", async ({ page }) => {
  await stubCheck(page);
  const uid = await signIn(page, owner);
  await expect(page.getByRole("link", { name: "Trips" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Access" })).toHaveCount(0);
  await seedLinkedEmails(uid, [admin]);
  await expect(page.getByRole("link", { name: "Access" })).toBeVisible();
});

// Someone invited at a work address who signs in with another links the
// work one from the invite-only screen (SPEC "Linked email addresses"). The
// parser is stubbed: which addresses it mails is its own tests' concern.
test("an account without access sends a link to the address it was invited at", async ({ page }) => {
  await stubCheck(page);
  const work = "newcomer@work.example";
  const asked: unknown[] = [];
  await page.route("http://localhost:8080/emails/add", async (route) => {
    const body = route.request().postDataJSON() as { email: string };
    asked.push(body);
    if (body.email === work) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ email: work }) });
    } else {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ refusal: "notInvited" }) });
    }
  });
  await signIn(page, newcomer, { approved: false });
  await expect(page.getByRole("heading", { name: "Invited at another address?" })).toBeVisible();

  await page.getByRole("textbox", { name: "Email address" }).fill("stranger@work.example");
  await page.getByRole("button", { name: "Add email address" }).click();
  await expect(page.getByText("That address hasn't been invited to Travelmo.")).toBeVisible();

  await page.getByRole("textbox", { name: "Email address" }).fill(" Newcomer@Work.example ");
  await page.getByRole("button", { name: "Add email address" }).click();
  await expect(page.getByText(`We sent a link to ${work}. Open it here to confirm.`)).toBeVisible();
  expect(asked).toEqual([{ email: "stranger@work.example" }, { email: work }]);
  // Still waiting until the link is opened.
  await expect(page.getByRole("heading", { name: "Travelmo is invite-only" })).toBeVisible();
});

test("an account without access opens its confirmation link, which lets it in", async ({ page }) => {
  await stubCheck(page);
  const work = "newcomer@work.example";
  let uid = "";
  const tokens: string[] = [];
  // As the parser does once the invited address is confirmed: it links the
  // address and writes the user document, which approves the account.
  await page.route("http://localhost:8080/emails/confirm", async (route) => {
    tokens.push((route.request().postDataJSON() as { token: string }).token);
    await seedLinkedEmails(uid, [work]);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ email: work }) });
  });
  uid = await signIn(page, newcomer, { approved: false });
  await expect(page.getByRole("heading", { name: "Travelmo is invite-only" })).toBeVisible();

  await page.goto("/settings/email?token=a-token");
  await expect(page.getByText(`${work} is now yours on Travelmo.`)).toBeVisible();
  expect(tokens).toEqual(["a-token"]);
  // In without a reload.
  await page.getByRole("link", { name: "Trips" }).click();
  await expect(page.getByText("No trips yet.")).toBeVisible();
});

test("the confirmation page opens to an account without access, but not the rest of Settings", async ({ page }) => {
  await stubCheck(page);
  await page.route("http://localhost:8080/emails/confirm", (route) =>
    route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ refusal: "expired" }) }),
  );
  await signIn(page, newcomer, { approved: false });
  await page.goto("/settings/email?token=old-token");
  await expect(page.getByText("This link has expired or is for another account. Add the address again.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Travelmo is invite-only" })).toBeVisible();
});

// Settings, where accounts are deleted, is closed to an account without
// access, so the invite-only screen offers deletion too.
test("an account without access can still delete itself", async ({ page }) => {
  await stubCheck(page);
  const calls: (string | undefined)[] = [];
  await page.route("http://localhost:8080/account/delete", async (route) => {
    calls.push(route.request().headers()["authorization"]);
    await route.fulfill({ status: 204 });
  });
  await signIn(page, newcomer, { approved: false });
  await expect(page.getByRole("heading", { name: "Travelmo is invite-only" })).toBeVisible();

  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByText("Delete your account and everything in it? This cannot be undone.")).toBeVisible();
  await page.getByRole("button", { name: "Keep" }).click();
  expect(calls).toEqual([]);

  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account deleted" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatch(/^Bearer /);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});
