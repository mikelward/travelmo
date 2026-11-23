import { describe, expect, it } from "vitest";
import type { HomePeriod } from "./home";
import { rentalCompanies, rideCompaniesFor, rideNeedKey, rideNeeds, withRideCompany, withoutRideCompany } from "./rides";
import { RideCompany, UserProfile, type Place, type Segment } from "./schema";

const lhr: Place = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
const bos: Place = { name: "Boston Logan", code: "BOS", city: "Boston", country: "US" };
const jfk: Place = { name: "New York JFK", code: "JFK", city: "New York", country: "US" };
const london: HomePeriod[] = [{ city: "London", country: "GB" }];
const now = "2026-11-20T00:00:00Z";

const seg = (id: string, type: Segment["type"], start: string, end: string | undefined, origin?: Place, destination?: Place): Segment => ({
  id,
  tripId: "t",
  type,
  title: id,
  start,
  ...(end ? { end } : {}),
  ...(origin ? { origin } : {}),
  ...(destination ? { destination } : {}),
  source: "gmail",
  gmailMessageIds: [],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
});
const out = seg("out", "flight", "2026-11-24T17:20:00+00:00", "2026-11-24T20:15:00-05:00", lhr, bos);
const back = seg("back", "flight", "2026-11-29T19:00:00-05:00", "2026-11-30T07:00:00+00:00", bos, lhr);

describe("rideNeeds", () => {
  it("asks for a ride to and from the airport at home and a car where the flight lands", () => {
    expect(rideNeeds([out, back], { periods: london, now })).toEqual([
      { segmentId: "out", kind: "toAirport" },
      { segmentId: "out", kind: "car" },
      { segmentId: "back", kind: "fromAirport" },
    ]);
  });

  it("needs no car when one is hired on landing, nor a ride a transfer already covers", () => {
    const hire = seg("hire", "car_rental", "2026-11-24T21:00:00-05:00", "2026-11-29T16:00:00-05:00", bos, bos);
    const cab = seg("cab", "other", "2026-11-24T14:30:00+00:00", "2026-11-24T15:15:00+00:00", { name: "Home", city: "London", country: "GB" }, lhr);
    const home = seg("home", "other", "2026-11-30T08:00:00+00:00", undefined, lhr, { name: "Home", city: "London", country: "GB" });
    expect(rideNeeds([out, back, hire, cab, home], { periods: london, now })).toEqual([]);
  });

  it("counts a transfer only for the end of the flight it meets", () => {
    const cab = seg("cab", "other", "2026-11-24T14:30:00+00:00", "2026-11-24T15:15:00+00:00", { name: "Home", city: "London", country: "GB" }, lhr);
    expect(rideNeeds([out, back, cab], { periods: london, now }).map(rideNeedKey)).toEqual(["out/car", "back/fromAirport"]);
    const pickup = seg("pickup", "other", "2026-11-24T21:00:00-05:00", undefined, bos, { name: "Example Hotel", city: "Boston", country: "US" });
    expect(rideNeeds([out, back, pickup], { periods: london, now }).map(rideNeedKey)).toEqual(["out/toAirport", "back/fromAirport"]);
  });

  it("counts a car only when it is collected where the flight lands", () => {
    // A car returned in London before the flight is no car in Boston.
    const londonCar = seg("ldn", "car_rental", "2026-11-24T08:00:00+00:00", "2026-11-24T13:00:00+00:00", { name: "Example Rentals", city: "London", country: "GB" }, { name: "Example Rentals", city: "London", country: "GB" });
    expect(rideNeeds([out, back, londonCar], { periods: london, now }).map(rideNeedKey)).toContain("out/car");
    const downtown = seg("dt", "car_rental", "2026-11-25T09:00:00-05:00", undefined, { name: "Example Rentals Back Bay", city: "Boston", country: "US" });
    expect(rideNeeds([out, back, downtown], { periods: london, now }).map(rideNeedKey)).not.toContain("out/car");
  });

  it("needs nothing at an airport where the traveler connects", () => {
    const toJfk = seg("toJfk", "flight", "2026-11-24T09:00:00+00:00", "2026-11-24T12:00:00-05:00", lhr, jfk);
    const toBos = seg("toBos", "flight", "2026-11-24T14:00:00-05:00", "2026-11-24T15:15:00-05:00", jfk, bos);
    expect(rideNeeds([toJfk, toBos], { periods: london, now }).map(rideNeedKey)).toEqual(["toJfk/toAirport", "toBos/car"]);
  });

  it("without a home, suggests a car only where a later journey shows the landing is away", () => {
    expect(rideNeeds([out, back], { periods: [], now })).toEqual([{ segmentId: "out", kind: "car" }]);
    // Home only from a later date is no home for these flights either.
    expect(rideNeeds([out, back], { periods: [{ city: "Paris", country: "FR", from: "2027-01-01" }], now })).toEqual([{ segmentId: "out", kind: "car" }]);
  });

  it("asks only for what is still ahead", () => {
    // Boarding: too late for a ride to the airport, not for a car on landing.
    expect(rideNeeds([out, back], { periods: london, now: "2026-11-24T18:00:00Z" }).map(rideNeedKey)).toEqual(["out/car", "back/fromAirport"]);
    expect(rideNeeds([out, back], { periods: london, now: "2026-12-01T00:00:00Z" })).toEqual([]);
  });

  it("leaves out what was dismissed and what was cancelled", () => {
    const cancelled = { ...back, cancelledAt: "2026-11-20T00:00:00Z", cancelledBy: "m9" };
    expect(rideNeeds([out, cancelled], { periods: london, hidden: ["out/car"], now })).toEqual([{ segmentId: "out", kind: "toAirport" }]);
  });
});

describe("rideCompaniesFor", () => {
  const abc = { name: "Example Cars", url: "https://cars.example.com/book", near: "home" } as const;
  const own = { name: "Example Rentals", url: "https://rentals.example.com/", near: "anywhere" } as const;

  it("offers the rental companies then the traveler's own for a car, and only their own near home for a ride", () => {
    expect(rideCompaniesFor("car", [abc, own]).map((c) => c.name)).toEqual([...rentalCompanies.map((c) => c.name), "Example Rentals"]);
    expect(rideCompaniesFor("toAirport", [abc, own])).toEqual([{ name: "Example Cars", url: "https://cars.example.com/book" }]);
    expect(rideCompaniesFor("fromAirport", [])).toEqual([]);
  });

  it("takes only a named https link", () => {
    expect(RideCompany.safeParse(abc).success).toBe(true);
    expect(RideCompany.safeParse({ ...abc, url: "http://cars.example.com" }).success).toBe(false);
    expect(RideCompany.safeParse({ ...abc, url: "javascript:alert(1)" }).success).toBe(false);
    expect(RideCompany.safeParse({ ...abc, name: " " }).success).toBe(false);
  });

  it("leaves a malformed company out of a profile rather than failing it", () => {
    const profile = UserProfile.parse({ email: "traveler@example.com", rideCompanies: [abc, { ...abc, url: "javascript:alert(1)" }] });
    expect(profile.rideCompanies).toEqual([abc]);
    expect(profile.email).toBe("traveler@example.com");
  });
});

describe("withRideCompany", () => {
  const cabs = { name: "Cabs", url: "https://cabs.example/", near: "home" as const };
  it("adds a company once and takes it away", () => {
    expect(withRideCompany([], cabs)).toEqual([cabs]);
    expect(withRideCompany([cabs], cabs)).toEqual([cabs]);
    expect(withoutRideCompany([cabs], { ...cabs })).toEqual([]);
  });
  it("refuses one past the limit", () => {
    const full = Array.from({ length: 20 }, (_, i) => ({ ...cabs, name: `Cabs ${i}` }));
    expect(() => withRideCompany(full, cabs)).toThrow("At most 20.");
  });
});
