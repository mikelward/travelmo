import { describe, expect, it } from "vitest";
import { namedProgram } from "./airlinePrograms";

const flight = (title: string) => ({ type: "flight" as const, title });

describe("namedProgram", () => {
  it("files a number under a generic label by the airline code written before it", () => {
    expect(namedProgram({ program: "Frequent Flyer", number: "UA-*****505" }, [])).toBe("United MileagePlus");
    expect(namedProgram({ program: "Frequent flyer number", number: "BA 12345678" }, [])).toBe("British Airways Executive Club");
    // An account number that starts with a letter, on another airline's booking.
    expect(namedProgram({ program: "Frequent Flyer", number: "UA-A1234567" }, [flight("BA 123 LHR to DEN")])).toBe("United MileagePlus");
  });

  it("else by the one airline every flight of the booking is with", () => {
    const united = [flight("UA 123 LHR to DEN"), flight("UA 456 DEN to SLC")];
    expect(namedProgram({ program: "Frequent Flyer", number: "XXXXX166" }, united)).toBe("United MileagePlus");
    // Two airlines: which program is not known.
    expect(namedProgram({ program: "Frequent Flyer", number: "XXXXX166" }, [...united, flight("DL 9 SLC to JFK")])).toBe("Frequent Flyer");
  });

  it("takes a program named by an airline's code as that airline's, a partner's number on another airline's booking included", () => {
    expect(namedProgram({ program: "BA", number: "12345678" }, [flight("UA 123 LHR to DEN")])).toBe("British Airways Executive Club");
    expect(namedProgram({ program: "ZZ", number: "12345678" }, [flight("UA 123 LHR to DEN")])).toBe("ZZ");
  });

  it("keeps an unlisted airline's code before the number over the booking's airline", () => {
    expect(namedProgram({ program: "Frequent Flyer", number: "AY-12345678" }, [flight("BA 123 LHR to HEL")])).toBe("Frequent Flyer");
  });

  it("leaves a generic hotel or rental label alone on a booking with a flight", () => {
    const united = [flight("UA 123 LHR to DEN")];
    expect(namedProgram({ program: "Hotel Rewards", number: "12345678" }, united)).toBe("Hotel Rewards");
    expect(namedProgram({ program: "Loyalty number", number: "12345678" }, united)).toBe("Loyalty number");
    expect(namedProgram({ program: "Frequent flier no.", number: "12345678" }, united)).toBe("United MileagePlus");
  });

  it("keeps a name that already says which program, and one for an airline not listed", () => {
    expect(namedProgram({ program: "Qatar Airways Privilege Club", number: "UA-123" }, [])).toBe("Qatar Airways Privilege Club");
    expect(namedProgram({ program: "Frequent Flyer", number: "ZZ-12345" }, [])).toBe("Frequent Flyer");
    expect(namedProgram({ program: "Frequent Flyer", number: "12345678" }, [flight("Hotel")])).toBe("Frequent Flyer");
  });
});
