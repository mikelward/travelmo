import { describe, expect, it } from "vitest";
import { airlineCheckIn, airlineCheckIns, airlineCode, airlineNamed, airlineNames, bookingHeading, checkInHoursBefore, defaultCheckInHours, headedRouteLine, placeLabel, routeLine } from "./airlines";

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

describe("bookingHeading", () => {
  it("heads a flight with its airline and leads the route with its flight number", () => {
    expect(bookingHeading(flight("VS 11 LHR to BOS"))).toEqual({ headline: "Virgin Atlantic", airline: "VS", flightNumber: "VS 11" });
    expect(bookingHeading(flight("FR1401 London (Stansted) to Stockholm (ARN)"))).toEqual({ headline: "Ryanair", airline: "FR", flightNumber: "FR 1401" });
  });
  it("names the airline flying a codeshare, as its provider gives it", () => {
    expect(bookingHeading({ ...flight("VS4012 BOS to LHR"), provider: "Delta" })).toEqual({ headline: "Delta Air Lines", airline: "DL", flightNumber: "VS 4012" });
  });
  it("names the airline its provider gives when the title has no flight number", () => {
    expect(bookingHeading({ ...flight("Delta BOS to LHR"), provider: "Delta Air Lines" })).toEqual({ headline: "Delta Air Lines", airline: "DL" });
  });
  it("keeps the title of anything else: a booking site, an airline not listed, a train", () => {
    expect(bookingHeading({ ...flight("Flight to Paris"), provider: "Expedia" })).toEqual({ headline: "Flight to Paris" });
    expect(bookingHeading(flight("ZZ 12 SYD to MEL"))).toEqual({ headline: "ZZ 12 SYD to MEL" });
    expect(bookingHeading({ type: "train", title: "Eurostar 9014" })).toEqual({ headline: "Eurostar 9014" });
  });
  it("takes a provider for an airline only when it names one", () => {
    expect(airlineNamed("Aeromexico")).toEqual({ code: "AM", name: "Aeroméxico" });
    expect(airlineNamed("Virgin")).toBeUndefined();
    expect(airlineNamed("AirAsia X")).toEqual({ code: "D7", name: "AirAsia X" });
    expect(airlineNamed("Transavia France")).toEqual({ code: "TO", name: "Transavia France" });
    expect(airlineNamed("Norwegian")).toEqual({ code: "D8", name: "Norwegian" });
    for (const code of Object.keys(airlineNames)) expect(code).toMatch(/^[A-Z0-9]{2}$/);
  });
});

describe("headedRouteLine", () => {
  it("leads a flight's route with its number, and names a stay's town", () => {
    const flight = {
      type: "flight" as const,
      title: "Jet2.com LS1439 London Stansted to Faro",
      provider: "Jet2.com",
      origin: { name: "London Stansted", city: "London", code: "STN" },
      destination: { name: "Faro", city: "Faro", code: "FAO" },
    };
    expect(headedRouteLine(flight)).toBe("LS 1439 · STN London → FAO Faro");
    expect(routeLine({ destination: { name: "Salgados Palm Village", city: "Albufeira" } })).toBe("Albufeira");
    expect(placeLabel({ name: "Salgados Palm Village" })).toBe("Salgados Palm Village");
    expect(headedRouteLine({ type: "activity", title: "Show" })).toBeUndefined();
  });
});
