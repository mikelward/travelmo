import { compareInstants, composeInstant, offsetOf, splitInstant } from "./instant";

describe("compareInstants", () => {
  it("orders by moment, so a date-line arrival on an earlier local date is still later", () => {
    expect(compareInstants("2026-12-02T00:30:00+09:00", "2026-12-01T12:30:00-10:00")).toBeLessThan(0);
    expect(compareInstants("2026-12-01T12:00:00Z", "2026-12-01T12:00:00+00:00")).toBe(0);
  });
});

describe("splitInstant", () => {
  it("separates date, time and offset", () => {
    expect(splitInstant("2026-12-01T09:05:00+01:00")).toEqual({ date: "2026-12-01", time: "09:05", offset: "+01:00" });
  });
  it("reads Z and compact offsets as +HH:MM", () => {
    expect(splitInstant("2026-12-01T09:05:00Z").offset).toBe("+00:00");
    expect(splitInstant("2026-12-01T09:05:00-0500").offset).toBe("-05:00");
  });
});

describe("composeInstant", () => {
  it("round-trips through splitInstant", () => {
    const instant = "2026-12-01T23:30:00-10:00";
    expect(composeInstant(splitInstant(instant))).toBe(instant);
  });
  it("rejects a malformed offset", () => {
    expect(() => composeInstant({ date: "2026-12-01", time: "09:00", offset: "GMT" })).toThrow(/Offset/);
  });
});

describe("offsetOf", () => {
  it("formats the zone offset of a date as +HH:MM", () => {
    const at = new Date("2026-06-01T12:00:00Z");
    const minutes = -at.getTimezoneOffset();
    const sign = minutes < 0 ? "-" : "+";
    const abs = Math.abs(minutes);
    const expected = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
    expect(offsetOf(at)).toBe(expected);
    expect(offsetOf(at)).toMatch(/^[+-]\d{2}:\d{2}$/);
  });
});
