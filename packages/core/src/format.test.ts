import { formatDate, formatDateRange, localTime } from "./format";

describe("localTime", () => {
  it("reads the wall-clock time without converting zones", () => {
    expect(localTime("2026-12-01T09:05:00-05:00")).toBe("09:05");
  });
});

describe("formatDate", () => {
  it("formats a calendar date with weekday", () => {
    expect(formatDate("2026-12-12")).toBe("Sat 12 Dec");
  });
});

describe("formatDateRange", () => {
  it("collapses shared month and year", () => {
    expect(formatDateRange("2026-12-12", "2026-12-14")).toBe("12–14 Dec 2026");
  });
  it("keeps both months within a year", () => {
    expect(formatDateRange("2026-11-28", "2026-12-02")).toBe("28 Nov – 2 Dec 2026");
  });
  it("spells out both years across a year boundary", () => {
    expect(formatDateRange("2026-12-28", "2027-01-02")).toBe("28 Dec 2026 – 2 Jan 2027");
  });
  it("shows a single day once", () => {
    expect(formatDateRange("2026-12-12", "2026-12-12")).toBe("12 Dec 2026");
  });
});
