import { describe, expect, it } from "vitest";
import { failureMessage } from "./api";

describe("failureMessage", () => {
  it("shows the parser's own words for a refused request when asked", () => {
    expect(failureMessage("/fastmail/connect", 400, "Fastmail didn't accept that API token. Check it, or make a new one.", true)).toBe(
      "Fastmail didn't accept that API token. Check it, or make a new one.",
    );
    expect(failureMessage("/fastmail/connect", 409, "A different Fastmail mailbox is connected", true)).toBe("A different Fastmail mailbox is connected");
  });

  it("keeps the details for other failures", () => {
    expect(failureMessage("/fastmail/connect", 500, "Internal Server Error", true)).toBe("/fastmail/connect failed: 500 Internal Server Error");
    expect(failureMessage("/fastmail/connect", 400, "  ", true)).toBe("/fastmail/connect failed: 400   ");
    expect(failureMessage("/feeds/add", 400, "Bad feed")).toBe("/feeds/add failed: 400 Bad feed");
  });
});
