import { describe, expect, it } from "vitest";
import { normalizeTrusted } from "./travelProfile";

describe("normalizeTrusted", () => {
  it("keeps one lowercase address per person and never the owner's own", () => {
    expect(normalizeTrusted([" Partner@Example.com ", "partner@example.com", "not an email", "Me@example.com"], "me@example.com")).toEqual(["partner@example.com"]);
  });
});
