import { describe, expect, it } from "vitest";
import { directionsUrl, mapsUrl } from "./directions";
import type { ExtractedSegment } from "./schema";

const stay: ExtractedSegment = {
  type: "lodging",
  title: "Motel Example",
  start: "2026-12-12T15:00:00-08:00",
  end: "2026-12-13T11:00:00-08:00",
  destination: { name: "Motel Example", city: "Las Vegas", country: "US", address: "123 Example Blvd, Las Vegas, NV 89101", lat: 36.17, lon: -115.14 },
};
const destination = (url: string | undefined) => (url ? new URL(url).searchParams.get("destination") : undefined);

describe("directionsUrl", () => {
  it("leads to a stay by its name and address in Google Maps", () => {
    const url = directionsUrl(stay);
    expect(url?.startsWith("https://www.google.com/maps/dir/?api=1&destination=")).toBe(true);
    expect(destination(url)).toBe("Motel Example, 123 Example Blvd, Las Vegas, NV 89101");
  });

  it("searches the name and town without an address, else the spot on the map", () => {
    // A geocoded spot may be only the town's middle: the name finds the motel.
    expect(destination(directionsUrl({ ...stay, destination: { name: "Motel Example", city: "Las Vegas", lat: 36.17, lon: -115.14 } }))).toBe("Motel Example, Las Vegas");
    expect(destination(directionsUrl({ ...stay, destination: { name: "Motel Example", lat: 36.17, lon: -115.14 } }))).toBe("36.17,-115.14");
    expect(destination(directionsUrl({ ...stay, destination: { name: "Motel Example" } }))).toBe("Motel Example");
    expect(destination(directionsUrl({ ...stay, destination: { name: "Las Vegas Motel", city: "Las Vegas" } }))).toBe("Las Vegas Motel");
  });

  it("leads to where a journey or a car rental starts", () => {
    const flight: ExtractedSegment = {
      type: "flight",
      title: "XX 100 LHR to LAS",
      start: "2026-12-12T09:00:00+00:00",
      origin: { name: "London Heathrow", code: "LHR" },
      destination: { name: "Harry Reid International", code: "LAS" },
    };
    expect(destination(directionsUrl(flight))).toBe("London Heathrow");
    expect(destination(directionsUrl({ ...flight, type: "car_rental", origin: { name: "Example Cars", address: "1 Airport Rd" } }))).toBe("Example Cars, 1 Airport Rd");
  });

  it("offers none for a cancelled booking or one with no place", () => {
    expect(directionsUrl({ ...stay, cancelledAt: "2026-11-01T00:00:00Z" } as ExtractedSegment)).toBeUndefined();
    expect(directionsUrl({ type: "other", title: "Note", start: "2026-12-12T09:00:00+00:00" })).toBeUndefined();
  });
});

describe("mapsUrl", () => {
  it("shows the place in Google Maps, found as directions find it", () => {
    expect(mapsUrl(stay.destination!)).toBe("https://www.google.com/maps/search/?api=1&query=Motel%20Example%2C%20123%20Example%20Blvd%2C%20Las%20Vegas%2C%20NV%2089101");
  });
});
