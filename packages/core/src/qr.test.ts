import { describe, expect, it } from "vitest";
import { encodeQrMatrix } from "./qr";

describe("encodeQrMatrix", () => {
  it("encodes an IATA BCBP boarding pass payload into a valid square QR matrix", () => {
    const bcbp = "M1EXAMPLE/SAM        E4K8M2P MANDOHQR 0022 332Y014A0042 100";
    const matrix = encodeQrMatrix(bcbp);
    expect(matrix).toBeDefined();
    const n = matrix!.length;
    expect(n).toBe(33); // Version 4 for 60 bytes at EC M
    expect(matrix!.every((row) => row.length === n)).toBe(true);
    // Top-left finder pattern outer border is dark.
    expect(matrix![0]!.slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
    expect(matrix![1]!.slice(0, 7)).toEqual([true, false, false, false, false, false, true]);
    expect(matrix![3]![3]).toBe(true);
  });

  it("preserves alignment patterns centered on timing row/col 6 for version 7+ payloads", () => {
    const matrix = encodeQrMatrix("A".repeat(110));
    expect(matrix).toBeDefined();
    expect(matrix!.length).toBe(45); // Version 7
    // Alignment pattern centered at (6, 22) and (22, 6): 5x5 dark border, light ring, dark center.
    for (const [r, c] of [[6, 22], [22, 6]] as const) {
      expect(matrix![r]![c]).toBe(true);
      expect(matrix![r - 1]![c - 1]).toBe(false);
      expect(matrix![r + 1]![c + 1]).toBe(false);
      expect(matrix![r - 2]![c - 2]).toBe(true);
      expect(matrix![r + 2]![c + 2]).toBe(true);
    }
  });

  it("returns undefined for empty or oversized input", () => {
    expect(encodeQrMatrix("")).toBeUndefined();
    expect(encodeQrMatrix("x".repeat(300))).toBeUndefined();
  });
});
