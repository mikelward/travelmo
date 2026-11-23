import { describe, expect, it } from "vitest";
import { airlineCheckIn, airlineCheckIns, airlineCode, checkInHoursBefore, defaultCheckInHours } from "./airlines";

const flight = (title: string) => ({ type: "flight" as const, title });

describe("airline check-in windows", () => {
  it("reads the airline from the flight number in the title", () => {
    expect(airlineCode(flight("QF 1 SYD to LHR"))).toBe("QF");
    expect(airlineCode(flight("U2 8012 LGW to GVA"))).toBe("U2");
    expect(airlineCode(flight("Flight to Paris"))).toBeUndefined();
    expect(airlineCode({ type: "train", title: "ES 9014 London to Paris" })).toBeUndefined();
  });

  it("gives the listed airline's window, and a day for any other", () => {
    expect(checkInHoursBefore(flight("EK 18 MAN to DXB"))).toBe(48);
    expect(checkInHoursBefore(flight("AF 1180 CDG to LHR"))).toBe(30);
    expect(checkInHoursBefore(flight("LH 400 FRA to JFK"))).toBe(23);
    expect(checkInHoursBefore(flight("U2 8012 LGW to GVA"))).toBe(720);
    expect(checkInHoursBefore(flight("XX 100 MAN to DXB"))).toBe(defaultCheckInHours);
    expect(checkInHoursBefore(flight("Flight to Paris"))).toBe(24);
    expect(airlineCheckIn(flight("QF 1 SYD to LHR"))?.site).toBe("https://www.qantas.com/");
    expect(airlineCheckIn(flight("XX 100 MAN to DXB"))).toBeUndefined();
  });

  it("lists only sane windows and https home pages", () => {
    // The same 19 airlines as the Android app's Airlines.kt.
    expect(Object.keys(airlineCheckIns)).toHaveLength(19);
    for (const [code, { hours, site }] of Object.entries(airlineCheckIns)) {
      expect(code).toMatch(/^[A-Z0-9]{2}$/);
      expect(hours).toBeGreaterThanOrEqual(1);
      expect(hours).toBeLessThanOrEqual(30 * 24);
      expect(new URL(site).protocol).toBe("https:");
      expect(new URL(site).pathname).toBe("/");
    }
  });
});
