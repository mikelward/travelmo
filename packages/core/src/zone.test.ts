import { formatOffset, resolveOffset, timeZones, zoneForOffset, zoneOffset } from "./zone";

describe("zoneOffset", () => {
  it("follows daylight saving", () => {
    expect(zoneOffset("America/New_York", "2026-12-01", "09:00")).toBe("-05:00");
    expect(zoneOffset("America/New_York", "2026-07-01", "09:00")).toBe("-04:00");
    expect(zoneOffset("Europe/London", "2026-07-01", "09:00")).toBe("+01:00");
    expect(zoneOffset("Europe/London", "2026-12-01", "09:00")).toBe("+00:00");
  });

  it("handles half-hour zones and UTC", () => {
    expect(zoneOffset("Asia/Kolkata", "2026-12-01", "09:00")).toBe("+05:30");
    expect(zoneOffset("UTC", "2026-12-01", "09:00")).toBe("+00:00");
    expect(zoneOffset("Pacific/Auckland", "2026-01-15", "09:00")).toBe("+13:00");
  });

  it("resolves the wall time just after a DST change to the new offset", () => {
    // London springs forward at 01:00 UTC on 2026-03-29; 02:30 local is after the jump.
    expect(zoneOffset("Europe/London", "2026-03-29", "02:30")).toBe("+01:00");
    expect(zoneOffset("Europe/London", "2026-03-29", "00:30")).toBe("+00:00");
  });

  it("rejects an unknown zone", () => {
    expect(() => zoneOffset("Mars/Olympus", "2026-12-01", "09:00")).toThrow();
  });
});

describe("formatOffset", () => {
  it("renders minutes as ±HH:MM", () => {
    expect(formatOffset(0)).toBe("+00:00");
    expect(formatOffset(-300)).toBe("-05:00");
    expect(formatOffset(330)).toBe("+05:30");
  });
});

describe("zoneForOffset and resolveOffset", () => {
  it("keeps the preferred zone when its offset matches, else pins the literal offset", () => {
    expect(zoneForOffset("-05:00", "2026-12-01", "09:00", "America/New_York")).toBe("America/New_York");
    expect(zoneForOffset("+09:00", "2026-12-01", "09:00", "America/New_York")).toBe("offset:+09:00");
    expect(resolveOffset("offset:+09:00", "2026-12-01", "09:00")).toBe("+09:00");
    expect(resolveOffset("Asia/Tokyo", "2026-12-01", "09:00")).toBe("+09:00");
  });
});

describe("timeZones", () => {
  it("lists IANA zones including UTC", () => {
    const zones = timeZones();
    expect(zones).toContain("UTC");
    expect(zones).toContain("Europe/London");
    expect(zones.length).toBeGreaterThan(100);
  });
});
