import { describe, expect, it } from "vitest";
import { deletionUnfinishedText, isDeletionUnfinished } from "./accountDeletion";

describe("isDeletionUnfinished", () => {
  it("knows the parser's answer for a deletion that stopped part way, and nothing else", () => {
    expect(isDeletionUnfinished(410, `${deletionUnfinishedText}\n`)).toBe(true);
    expect(isDeletionUnfinished(410, "This account was deleted")).toBe(false);
    expect(isDeletionUnfinished(400, deletionUnfinishedText)).toBe(false);
  });
});
