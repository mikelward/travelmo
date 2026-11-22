import { describe, expect, it } from "vitest";
import { exportCalendar } from "./calendarExport";
import { dueForReminders } from "./reminders";
import { tripMonths, weekBars } from "./calendar";
import { documentWarnings } from "./documents";
import { displayTitles } from "./format";
import { travelReport, tripDays, tripPlaces } from "./reports";
import type { ExtractedCancellation, ExtractedSegment } from "./schema";
import { currentStay, flightCheckIn, tripStatus } from "./status";
import { allCancelled, bookedDateRange, cancels, displayBounds, findTripForRange, servicesConflict, groupTrips, liveBounds, isCancelled, liveSegments, nextEvent, pendingCancellationExpired, segmentDateRange, stillWaiting } from "./trips";

// An invented Stockholm stay booked through a booking site, and the email
// cancelling it.
const stay: ExtractedSegment = {
  type: "lodging",
  title: "Example Hotel Gamla Stan",
  provider: "Booking.com",
  confirmation: "1234.567.890",
  start: "2026-06-10T15:00:00+02:00",
  end: "2026-06-13T11:00:00+02:00",
  destination: { name: "Example Hotel Gamla Stan", city: "Stockholm", country: "SE" },
};
const flight: ExtractedSegment = {
  type: "flight",
  title: "SK 1530 LHR to ARN",
  start: "2026-06-10T08:00:00+01:00",
  end: "2026-06-10T11:30:00+02:00",
  origin: { name: "Heathrow", code: "LHR" },
  destination: { name: "Arlanda", code: "ARN" },
};
const cancelled = { ...stay, cancelledAt: "2026-05-01T09:00:00Z" };

describe("cancels", () => {
  const byReference: ExtractedCancellation = { type: "lodging", confirmation: "1234567890", place: "Example Hotel Gamla Stan" };

  it("matches the same confirmation number, however it is punctuated", () => {
    expect(cancels(byReference, stay)).toBe(true);
  });

  it("cancels only the leg a shared reference's cancellation names, and every leg when it names none", () => {
    const leg = (number: string, start: string, from: string, to: string): ExtractedSegment => ({
      type: "flight",
      title: `BA ${number} ${from} to ${to}`,
      confirmation: "ABC123",
      start,
      origin: { name: from, code: from },
      destination: { name: to, code: to },
    });
    const out = leg("117", "2026-06-10T11:00:00+01:00", "LHR", "JFK");
    const back = leg("116", "2026-06-13T18:00:00-04:00", "JFK", "LHR");
    const named: ExtractedCancellation = { type: "flight", confirmation: "ABC123", place: "BA 117 LHR to JFK", origin: "LHR", destination: "JFK", start: "2026-06-10T11:00:00+01:00" };
    expect(cancels(named, out)).toBe(true);
    expect(cancels(named, back)).toBe(false);
    // The leg by its date or its number alone.
    expect(cancels({ type: "flight", confirmation: "ABC123", start: "2026-06-13T00:00:00-04:00" }, back)).toBe(true);
    expect(cancels({ type: "flight", confirmation: "ABC123", start: "2026-06-13T00:00:00-04:00" }, out)).toBe(false);
    expect(cancels({ type: "flight", confirmation: "ABC123", place: "BA 116" }, out)).toBe(false);
    // The reference alone cancels the whole reservation.
    expect(cancels({ type: "flight", confirmation: "ABC123" }, out)).toBe(true);
    expect(cancels({ type: "flight", confirmation: "ABC123" }, back)).toBe(true);
  });

  // Invented flights under one recycled reference, a cancellation sent on 1 May 2026.
  const sent = "2026-05-01T09:00:00Z";
  const lufthansa = (start: string, provider = "Lufthansa"): ExtractedSegment => ({
    type: "flight",
    title: "LH 900 FRA to LHR",
    provider,
    confirmation: "ABC123",
    start,
    origin: { name: "Frankfurt", code: "FRA" },
    destination: { name: "Heathrow", code: "LHR" },
  });

  it("takes a shared reference from another airline for another booking", () => {
    const british: ExtractedCancellation = { type: "flight", provider: "British Airways", confirmation: "ABC123" };
    expect(cancels(british, lufthansa("2026-06-10T08:00:00+02:00"), sent)).toBe(false);
    expect(cancels(british, lufthansa("2027-03-02T08:00:00+01:00"), sent)).toBe(false);
    // The same airline, however it is written.
    expect(cancels(british, { ...lufthansa("2026-06-10T08:00:00+02:00", "BA"), title: "BA 903 FRA to LHR" }, sent)).toBe(true);
    // An airline by its code alone may be any: only a booking near the email's date.
    const coded: ExtractedCancellation = { type: "flight", provider: "BA", confirmation: "ABC123" };
    expect(cancels(coded, lufthansa("2026-06-10T08:00:00+02:00"), sent)).toBe(true);
    expect(cancels(coded, lufthansa("2024-06-10T08:00:00+02:00"), sent)).toBe(false);
    // Without a reference, the same route and minute from another airline is another flight.
    const byRoute: ExtractedCancellation = { type: "flight", provider: "British Airways", origin: "FRA", destination: "LHR", start: "2026-06-10T08:00:00+02:00" };
    expect(cancels(byRoute, lufthansa("2026-06-10T08:00:00+02:00"), sent)).toBe(false);
    expect(cancels({ ...byRoute, provider: "Lufthansa" }, lufthansa("2026-06-10T08:00:00+02:00"), sent)).toBe(true);
  });

  it("lets the agency that sold a booking cancel it, but not one long past under the same reference", () => {
    const expedia: ExtractedCancellation = { type: "flight", provider: "Expedia", confirmation: "ABC123" };
    expect(cancels(expedia, lufthansa("2026-06-10T08:00:00+02:00"), sent)).toBe(true);
    expect(cancels({ ...expedia, provider: "Trip.com" }, lufthansa("2026-06-10T08:00:00+02:00", "Expedia"), sent)).toBe(true);
    expect(cancels(expedia, lufthansa("2024-06-10T08:00:00+02:00"), sent)).toBe(false);
    expect(cancels(expedia, lufthansa("2029-06-10T08:00:00+02:00"), sent)).toBe(false);
  });

  it("refuses a different confirmation number even at the same hotel on the same dates", () => {
    expect(cancels({ ...byReference, confirmation: "999", start: stay.start }, stay)).toBe(false);
  });

  describe("an event without a confirmation number", () => {
    const show = (start: string): ExtractedSegment => ({
      type: "activity",
      title: "Hamlet at the Example Theatre",
      provider: "Example Theatre",
      start,
      destination: { name: "Example Theatre", city: "London", country: "GB" },
    });
    const cancelled: ExtractedCancellation = { type: "activity", provider: "Example Theatre", place: "Hamlet", start: "2026-06-10T14:00:00+01:00" };

    it("cancels the performance at the time the email gives", () => {
      expect(cancels(cancelled, show("2026-06-10T14:00:00+01:00"))).toBe(true);
    });

    it("leaves another performance that day alone", () => {
      expect(cancels(cancelled, show("2026-06-10T19:30:00+01:00"))).toBe(false);
    });

    it("leaves another film at the same time and cinema alone", () => {
      const film = (title: string): ExtractedSegment => ({
        type: "activity",
        title: `${title} at Everyman Muswell Hill`,
        provider: "Everyman",
        start: "2026-06-10T18:00:00+01:00",
        destination: { name: "Everyman Muswell Hill", city: "London", country: "GB" },
      });
      const toyStory4: ExtractedCancellation = { type: "activity", provider: "Everyman", place: "Toy Story 4", start: "2026-06-10T18:00:00+01:00" };
      expect(cancels(toyStory4, film("Toy Story 5"))).toBe(false);
      expect(cancels(toyStory4, film("Toy Story 4"))).toBe(true);
    });

    it("tells events apart by names in any script", () => {
      const film = (title: string): ExtractedSegment => ({
        type: "activity",
        title: `${title} at Everyman Muswell Hill`,
        provider: "Everyman",
        start: "2026-06-10T18:00:00+01:00",
        destination: { name: "Everyman Muswell Hill", city: "London", country: "GB" },
      });
      const spiritedAway: ExtractedCancellation = { type: "activity", provider: "Everyman", place: "千と千尋の神隠し at Everyman Muswell Hill", start: "2026-06-10T18:00:00+01:00" };
      expect(cancels(spiritedAway, film("となりのトトロ"))).toBe(false);
      expect(cancels(spiritedAway, film("千と千尋の神隠し"))).toBe(true);
    });

    it("goes by the name alone when the email gives no time", () => {
      expect(cancels({ ...cancelled, start: "2026-06-10T00:00:00+01:00" }, show("2026-06-10T19:30:00+01:00"))).toBe(true);
    });
  });

  it("leaves another hotel of the same chain alone, with no provider given", () => {
    const paddington: ExtractedSegment = {
      type: "lodging",
      title: "Hilton London Paddington",
      start: "2026-06-10T15:00:00+01:00",
      destination: { name: "Hilton London Paddington", city: "London", country: "GB" },
    };
    expect(cancels({ type: "lodging", place: "Hilton London Kensington", start: "2026-06-10T15:00:00+01:00" }, paddington)).toBe(false);
    expect(cancels({ type: "lodging", place: "Hilton London Paddington", start: "2026-06-10T15:00:00+01:00" }, paddington)).toBe(true);
    expect(cancels({ type: "lodging", place: "Hilton Paddington", start: "2026-06-10T15:00:00+01:00" }, paddington)).toBe(true);
  });

  it("matches a hotel with a short name", () => {
    const ned: ExtractedSegment = { type: "lodging", title: "The Ned", start: "2026-06-10T15:00:00+01:00", destination: { name: "The Ned", city: "London", country: "GB" } };
    expect(cancels({ type: "lodging", place: "The Ned", start: "2026-06-10T15:00:00+01:00" }, ned)).toBe(true);
    expect(cancels({ type: "lodging", place: "The Pig", start: "2026-06-10T15:00:00+01:00" }, ned)).toBe(false);
  });

  it("leaves a hotel in another city alone, however alike the name", () => {
    const london: ExtractedSegment = { type: "lodging", title: "ibis London City", start: "2026-06-10T15:00:00+01:00", destination: { name: "ibis London City", city: "London", country: "GB" } };
    expect(cancels({ type: "lodging", place: "ibis Paris City", start: "2026-06-10T15:00:00+01:00" }, london)).toBe(false);
    expect(cancels({ type: "lodging", place: "ibis London City", start: "2026-06-10T15:00:00+01:00" }, london)).toBe(true);
    expect(cancels({ type: "lodging", place: "ibis City", start: "2026-06-10T15:00:00+01:00" }, london)).toBe(true);
    // The city the email gives for the stay decides first.
    expect(cancels({ type: "lodging", place: "ibis City", city: "Paris", start: "2026-06-10T15:00:00+01:00" }, london)).toBe(false);
    expect(cancels({ type: "lodging", place: "ibis City", city: "London", start: "2026-06-10T15:00:00+01:00" }, london)).toBe(true);
  });

  it("doesn't take a city in a show's or hotel's own name for where it is", () => {
    const chicago: ExtractedSegment = {
      type: "activity",
      title: "Chicago at Phoenix Theatre",
      provider: "Phoenix Theatre",
      start: "2026-06-10T19:30:00+01:00",
      destination: { name: "Phoenix Theatre", city: "London", country: "GB" },
    };
    expect(cancels({ type: "activity", place: "Chicago at Phoenix Theatre", start: "2026-06-10T19:30:00+01:00" }, chicago)).toBe(true);
    const berlin: ExtractedSegment = { type: "lodging", title: "Hotel Berlin", start: "2026-06-10T15:00:00+02:00", destination: { name: "Hotel Berlin", city: "Munich", country: "DE" } };
    expect(cancels({ type: "lodging", place: "Hotel Berlin", start: "2026-06-10T15:00:00+02:00" }, berlin)).toBe(true);
  });

  it("tells hotels apart by short words too", () => {
    const city: ExtractedSegment = {
      type: "lodging",
      title: "ibis London City",
      start: "2026-06-10T15:00:00+01:00",
      destination: { name: "ibis London City", city: "London", country: "GB" },
    };
    expect(cancels({ type: "lodging", place: "ibis London Bow", start: "2026-06-10T15:00:00+01:00" }, city)).toBe(false);
    expect(cancels({ type: "lodging", place: "ibis London City", start: "2026-06-10T15:00:00+01:00" }, city)).toBe(true);
  });

  it("matches a stay named in another script", () => {
    const ryokan: ExtractedSegment = { type: "lodging", title: "東京旅館", start: "2026-06-10T15:00:00+09:00", destination: { name: "東京旅館", city: "Tokyo" } };
    expect(cancels({ type: "lodging", place: "東京旅館", start: "2026-06-10T15:00:00+09:00" }, ryokan)).toBe(true);
    expect(cancels({ type: "lodging", place: "大阪旅館", start: "2026-06-10T15:00:00+09:00" }, ryokan)).toBe(false);
  });

  it("compares only a stay's check-in date, not its time", () => {
    expect(cancels({ type: "lodging", place: "Example Hotel Gamla Stan", start: "2026-06-10T14:00:00+02:00" }, { ...stay, confirmation: undefined })).toBe(true);
  });

  describe("a journey without a confirmation number", () => {
    const leg = (start: string, from: string, to: string): ExtractedSegment => ({
      type: "flight",
      title: `Example Air ${from} to ${to}`,
      provider: "Example Air",
      start,
      origin: { name: from === "LHR" ? "Heathrow" : "Charles de Gaulle", code: from },
      destination: { name: to === "LHR" ? "Heathrow" : "Charles de Gaulle", code: to },
    });
    const out = leg("2026-06-10T08:00:00+01:00", "LHR", "CDG");
    const back = leg("2026-06-10T20:00:00+02:00", "CDG", "LHR");
    const cancelled: ExtractedCancellation = { type: "flight", provider: "Example Air", place: "London to Paris", origin: "LHR", destination: "CDG", start: "2026-06-10T08:00:00+01:00" };

    it("cancels the leg that goes the same way at the same time", () => {
      expect(cancels(cancelled, out)).toBe(true);
      expect(cancels({ ...cancelled, origin: "London Heathrow", destination: "Paris Charles de Gaulle" }, out)).toBe(true);
    });

    it("leaves the same-day return alone", () => {
      expect(cancels(cancelled, back)).toBe(false);
    });

    it("leaves another departure the same way alone", () => {
      expect(cancels(cancelled, leg("2026-06-10T14:00:00+01:00", "LHR", "CDG"))).toBe(false);
    });

    it("leaves another airport in the same city alone", () => {
      const gatwick = { ...out, origin: { name: "Gatwick", code: "LGW", city: "London" }, destination: { name: "Orly", code: "ORY", city: "Paris" } };
      const heathrow = { ...out, origin: { name: "Heathrow", code: "LHR", city: "London" }, destination: { name: "Charles de Gaulle", code: "CDG", city: "Paris" } };
      expect(cancels(cancelled, gatwick)).toBe(false);
      expect(cancels({ ...cancelled, origin: "London Heathrow", destination: "Paris Charles de Gaulle" }, gatwick)).toBe(false);
      expect(cancels({ ...cancelled, origin: "London", destination: "Paris" }, heathrow)).toBe(false);
      expect(cancels({ ...cancelled, origin: "London Heathrow", destination: "Paris Charles de Gaulle" }, heathrow)).toBe(true);
    });

    it("reads a short place name as a name, not a code", () => {
      const luton = { ...out, origin: { name: "Luton", code: "LTN", city: "London" }, destination: { name: "Charles de Gaulle", code: "CDG", city: "Paris" } };
      expect(cancels({ ...cancelled, origin: "Luton", destination: "CDG" }, luton)).toBe(true);
      expect(cancels({ ...cancelled, origin: "LTN", destination: "CDG" }, luton)).toBe(true);
      expect(cancels({ ...cancelled, origin: "STN", destination: "CDG" }, luton)).toBe(false);
      expect(cancels({ ...cancelled, origin: "Stansted", destination: "CDG" }, luton)).toBe(false);
    });

    it("cancels the leg that goes the same way when the email gives no time, as codes", () => {
      const untimed: ExtractedCancellation = { ...cancelled, place: "LHR to CDG", start: "2026-06-10T00:00:00+01:00" };
      expect(cancels(untimed, out)).toBe(true);
      expect(cancels(untimed, back)).toBe(false);
      // A flight number it names must still be this flight's.
      expect(cancels({ ...untimed, place: "Example Air 999 LHR to CDG" }, out)).toBe(false);
    });

    it("matches ends named exactly as the booking names them, but not a city alone", () => {
      const dublin = {
        ...out,
        origin: { name: "Dublin Airport", city: "Dublin" },
        destination: { name: "Edinburgh Airport", city: "Edinburgh" },
      };
      expect(cancels({ ...cancelled, origin: "Dublin Airport", destination: "Edinburgh Airport" }, dublin)).toBe(true);
      expect(cancels({ ...cancelled, origin: "dublin airport", destination: "Edinburgh  Airport" }, dublin)).toBe(true);
      expect(cancels({ ...cancelled, origin: "Dublin", destination: "Edinburgh" }, dublin)).toBe(false);
    });

    it("compares names in any script, never two names it can't read as equal", () => {
      const japan = { ...out, origin: { name: "成田空港", city: "Tokyo" }, destination: { name: "新千歳空港", city: "Sapporo" } };
      expect(cancels({ ...cancelled, origin: "羽田空港", destination: "関西国際空港" }, japan)).toBe(false);
      expect(cancels({ ...cancelled, origin: "成田空港", destination: "新千歳空港" }, japan)).toBe(true);
      expect(cancels({ ...cancelled, origin: "---", destination: "..." }, { ...japan, origin: { name: "--" }, destination: { name: "." } })).toBe(false);
    });

    it("leaves another flight number on the same route and day alone", () => {
      const jfk = (number: string): ExtractedSegment => ({
        type: "flight",
        title: `BA ${number} Heathrow to JFK`,
        start: "2026-06-10T11:00:00+01:00",
        origin: { name: "Heathrow", city: "London" },
        destination: { name: "John F Kennedy", city: "New York" },
      });
      const untimed: ExtractedCancellation = { type: "flight", place: "BA 999 Heathrow to JFK", origin: "Heathrow", destination: "John F Kennedy", start: "2026-06-10T00:00:00+01:00" };
      expect(cancels(untimed, jfk("117"))).toBe(false);
      expect(cancels(untimed, jfk("999"))).toBe(true);
    });

    it("doesn't take a generic word such as 'international' for the same airport", () => {
      const newark = { ...out, origin: { name: "Heathrow", city: "London" }, destination: { name: "Newark Liberty International Airport", city: "Newark" } };
      expect(cancels({ ...cancelled, origin: "Heathrow", destination: "John F Kennedy International Airport" }, newark)).toBe(false);
      expect(cancels({ ...cancelled, origin: "Heathrow", destination: "Newark Liberty International Airport" }, newark)).toBe(true);
      expect(cancels({ ...cancelled, origin: "Heathrow", destination: "Newark Liberty" }, newark)).toBe(true);
    });

    it("matches the same flight number however it is spaced", () => {
      const ba117: ExtractedSegment = { ...out, title: "BA 117 LHR to JFK", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "John F Kennedy", code: "JFK" } };
      const untimed: ExtractedCancellation = { type: "flight", place: "BA117 LHR to JFK", origin: "LHR", destination: "JFK", start: "2026-06-10T00:00:00+01:00" };
      expect(cancels(untimed, ba117)).toBe(true);
      expect(cancels({ ...untimed, place: "BA 117 LHR to JFK" }, { ...ba117, title: "BA117 LHR to JFK" })).toBe(true);
    });

    it("tells trains apart by a number after the operator's full name", () => {
      const train = (number: string): ExtractedSegment => ({
        type: "train",
        title: `Eurostar ${number} London St Pancras to Paris Gare du Nord`,
        start: "2026-06-10T08:01:00+01:00",
        origin: { name: "London St Pancras", city: "London" },
        destination: { name: "Paris Gare du Nord", city: "Paris" },
      });
      const untimed: ExtractedCancellation = { type: "train", place: "Eurostar 9014 London St Pancras to Paris Gare du Nord", origin: "London St Pancras", destination: "Paris Gare du Nord", start: "2026-06-10T00:00:00+01:00" };
      expect(cancels(untimed, train("9024"))).toBe(false);
      expect(cancels(untimed, train("9014"))).toBe(true);
      // By its code or its name, the same train.
      expect(cancels({ ...untimed, place: "ES 9014 London St Pancras to Paris Gare du Nord" }, train("9014"))).toBe(true);
      // One side numbered and the other not: the route's words alone don't say which train.
      expect(cancels({ ...untimed, place: "London St Pancras to Paris Gare du Nord" }, train("9024"))).toBe(false);
      expect(cancels(untimed, { ...train("9024"), title: "Eurostar London St Pancras to Paris Gare du Nord" })).toBe(false);
      // A flight given as "Flight 117" is BA 117, not another flight.
      expect(servicesConflict("Flight 117", "BA 117 LHR to JFK")).toBe(false);
      expect(servicesConflict("BA 117", "BA 118")).toBe(true);
    });

    it("leaves a station of the same name in another city alone", () => {
      const central: ExtractedSegment = { ...out, origin: { name: "Glasgow Central", city: "Glasgow" }, destination: { name: "Manchester Piccadilly", city: "Manchester" } };
      expect(cancels({ ...cancelled, origin: "London Central", destination: "Manchester Piccadilly" }, central)).toBe(false);
      expect(cancels({ ...cancelled, origin: "Glasgow Central", destination: "Manchester Piccadilly" }, central)).toBe(true);
    });

    it("matches nothing when the email doesn't say which way", () => {
      expect(cancels({ ...cancelled, origin: undefined, destination: undefined }, out)).toBe(false);
    });
  });

  it("refuses another kind of booking", () => {
    expect(cancels({ ...byReference, type: "flight" }, stay)).toBe(false);
  });

  it("matches without a number only on the same dates and a shared distinctive name", () => {
    const noRef: ExtractedCancellation = { place: "Example Hotel Gamla Stan", start: "2026-06-10T00:00:00+02:00", end: "2026-06-13T00:00:00+02:00" };
    expect(cancels(noRef, { ...stay, confirmation: undefined })).toBe(true);
    expect(cancels({ ...noRef, start: "2026-06-11T00:00:00+02:00" }, stay)).toBe(false);
    expect(cancels({ ...noRef, end: "2026-06-12T00:00:00+02:00" }, stay)).toBe(false);
    // A chain or a city alone is not this booking.
    expect(cancels({ ...noRef, place: "Hotel Stockholm" }, stay)).toBe(false);
    // No dates, no match.
    expect(cancels({ place: "Example Hotel Gamla Stan" }, stay)).toBe(false);
  });

  // Two hotels of one chain in one city on the same nights are two stays.
  const chainStay: ExtractedSegment = {
    type: "lodging",
    title: "Hilton London Paddington",
    provider: "Hilton",
    start: "2026-06-10T15:00:00+01:00",
    end: "2026-06-13T11:00:00+01:00",
    destination: { name: "Hilton London Paddington", city: "London", country: "GB" },
  };
  const sameNights = { start: "2026-06-10T15:00:00+01:00", end: "2026-06-13T11:00:00+01:00" };

  it("doesn't match another hotel of the same chain in the same city", () => {
    expect(cancels({ ...sameNights, provider: "Hilton", place: "Hilton London Kensington" }, chainStay)).toBe(false);
    expect(cancels({ ...sameNights, place: "Hilton London Kensington" }, chainStay)).toBe(false);
  });

  it("doesn't match on a chain or city name alone", () => {
    expect(cancels({ ...sameNights, provider: "Hilton", place: "Hilton London" }, chainStay)).toBe(false);
    expect(cancels({ ...sameNights, place: "Hilton" }, chainStay)).toBe(false);
  });

  it("still matches the property's own name", () => {
    expect(cancels({ ...sameNights, provider: "Hilton", place: "Hilton London Paddington" }, chainStay)).toBe(true);
    // An independent hotel whose provider is the property itself.
    const independent = { ...chainStay, title: "The Example Inn", provider: "The Example Inn", destination: { name: "The Example Inn", city: "London" } };
    expect(cancels({ ...sameNights, provider: "The Example Inn", place: "The Example Inn" }, independent)).toBe(true);
  });
});

describe("cancelled bookings", () => {
  it("are recognized and left out of the live ones", () => {
    expect(isCancelled(cancelled)).toBe(true);
    expect(isCancelled(stay)).toBe(false);
    expect(liveSegments([flight, cancelled])).toEqual([flight]);
  });

  it("don't count for a trip's dates", () => {
    expect(segmentDateRange([flight, { ...cancelled, end: "2026-06-20T11:00:00+02:00" }])).toEqual({ start: "2026-06-10", end: "2026-06-10" });
    expect(segmentDateRange([cancelled])).toBeUndefined();
  });

  it("leave the dates still booked beside the trip's own, which stay", () => {
    // The flight on 10 June, the cancelled stay stretching the trip to 20 June.
    const long = { ...cancelled, end: "2026-06-20T11:00:00+02:00" };
    expect(liveBounds({ start: "2026-06-10", end: "2026-06-20" }, [flight, long])).toEqual({ start: "2026-06-10", end: "2026-06-10" });
    // A trip planned to the 25th keeps it; one with nothing left booked, or nothing cancelled, has none of its own.
    expect(liveBounds({ start: "2026-06-10", end: "2026-06-25" }, [flight, long])).toBeUndefined();
    expect(liveBounds({ start: "2026-06-10", end: "2026-06-20" }, [long])).toBeUndefined();
    expect(liveBounds({ start: "2026-06-10", end: "2026-06-20" }, [flight])).toBeUndefined();
  });

  it("leave a trip's calendar event to the dates still booked", () => {
    const ics = exportCalendar(
      [{ trip: { id: "t", title: "Stockholm", start: "2026-06-10", end: "2026-06-13", updatedAt: "2026-05-01T09:00:00Z" }, segments: [{ ...flight, id: "s0" }, { ...cancelled, id: "s1" }] }],
      { stamp: "2026-05-01T09:00:00Z", tripUrl: (id) => `https://example.test/trips/${id}` },
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260610");
    expect(ics).toContain("DTEND;VALUE=DATE:20260611");
  });

  it("aren't what's next, the current stay or a check-in", () => {
    const now = "2026-06-11T12:00:00+02:00";
    expect(nextEvent([cancelled], now)).toBeUndefined();
    expect(currentStay([cancelled], now)).toBeUndefined();
    expect(tripStatus([cancelled], now)).toEqual({});
    const cancelledFlight = { ...flight, cancelledAt: "2026-05-01T09:00:00Z" };
    expect(flightCheckIn([cancelledFlight], "2026-06-09T12:00:00+01:00")).toBeUndefined();
  });

  it("leave the calendar export and reports", () => {
    const ics = exportCalendar(
      [{ trip: { id: "t", title: "Stockholm", start: "2026-06-10", end: "2026-06-13", updatedAt: "2026-05-01T09:00:00Z" }, segments: [{ ...cancelled, id: "s1" }] }],
      { stamp: "2026-05-01T09:00:00Z", tripUrl: (id) => `https://example.test/trips/${id}` },
    );
    expect(ics).not.toContain("Example Hotel");
    expect(tripPlaces([cancelled])).toEqual({ countries: new Set(), complete: false });
    const report = travelReport([{ trip: { id: "t", start: "2026-06-10", end: "2026-06-13" }, segments: [cancelled] }], "2026-07-01");
    expect(report.countries).toEqual([]);
    expect(report.places).toEqual([]);
  });
});

describe("a trip some of whose bookings were cancelled", () => {
  // London 1-3 June still booked; the Paris stay that ran to 20 June cancelled.
  const trip = { id: "t", title: "London and Paris", start: "2026-06-01", end: "2026-06-20", liveStart: "2026-06-01", liveEnd: "2026-06-03", ownerUid: "u", sharedWith: [], createdAt: "2026-05-01T09:00:00Z", updatedAt: "2026-05-01T09:00:00Z" };

  it("shows when the person now travels", () => {
    expect(displayBounds(trip)).toEqual({ start: "2026-06-01", end: "2026-06-03" });
    expect(displayBounds({ start: "2026-06-01", end: "2026-06-20" })).toEqual({ start: "2026-06-01", end: "2026-06-20" });
    expect(displayTitles([trip, { ...trip, id: "u" }]).get("t")).toBe("London and Paris (1–3 Jun 2026)");
  });

  it("draws in only what is near those dates, while its own dates cover every booking", () => {
    expect(findTripForRange([trip], { start: "2026-06-19", end: "2026-06-21" })).toBeUndefined();
    expect(findTripForRange([trip], { start: "2026-06-04", end: "2026-06-05" })).toBe(trip);
    expect(bookedDateRange([flight, { ...cancelled, end: "2026-06-20T11:00:00+02:00" }])).toEqual({ start: "2026-06-10", end: "2026-06-20" });
  });

  it("is past once those dates are, and spans only them in the calendar", () => {
    expect(groupTrips([trip], "2026-06-10").past).toEqual([trip]);
    const week = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"];
    expect(weekBars(week, [trip])).toMatchObject([{ from: 0, to: 2, continuesAfter: false }]);
    expect(weekBars(["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"], [trip])).toEqual([]);
    expect(tripMonths([trip])).toEqual(["2026-06"]);
  });

  it("gets no reminders once those dates are past", () => {
    expect(dueForReminders([trip], "2026-06-10")).toEqual([]);
    expect(dueForReminders([trip], "2026-06-02")).toEqual([trip]);
  });

  it("warns about documents for those dates", () => {
    const passport = { title: "Passport", kind: "passport" as const, country: "GB", expires: "2026-06-10" };
    expect(documentWarnings([passport], trip, "2026-05-01")).toMatchObject([{ when: "soon" }]);
    expect(documentWarnings([passport], { start: trip.start, end: trip.end }, "2026-05-01")).toMatchObject([{ when: "before" }]);
  });
});

describe("days away in reports", () => {
  const london: ExtractedSegment = {
    type: "lodging",
    title: "Example Hotel London",
    start: "2026-06-01T15:00:00+01:00",
    end: "2026-06-03T11:00:00+01:00",
    destination: { name: "Example Hotel London", city: "London", country: "GB" },
  };
  const paris = {
    type: "lodging" as const,
    title: "Example Hotel Paris",
    start: "2026-06-04T15:00:00+02:00",
    end: "2026-06-20T11:00:00+02:00",
    destination: { name: "Example Hotel Paris", city: "Paris", country: "FR" },
    cancelledAt: "2026-05-01T09:00:00Z",
  };
  const trip = { start: "2026-06-01", end: "2026-06-20" };

  it("count only the days the bookings still booked span", () => {
    expect([...tripDays(trip, [london, paris], "2026-07-01").keys()]).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    const report = travelReport([{ trip: { id: "t", ...trip }, segments: [london, paris] }], "2026-07-01");
    expect(report.countries).toEqual([{ country: "GB", days: 3, trips: 1 }]);
  });

  it("date the trip by what is still booked: ahead until then, and in the year it falls", () => {
    // A stay over New Year cancelled; the January one kept. The trip as
    // stored still starts on 20 December.
    const winter = { id: "w", start: "2025-12-20", end: "2026-01-12" };
    const newYear = { ...paris, start: "2025-12-20T15:00:00+01:00", end: "2026-01-02T11:00:00+01:00" };
    const january = { ...london, start: "2026-01-10T15:00:00+00:00", end: "2026-01-12T11:00:00+00:00" };
    const segments = [newYear, january];
    const fifth = travelReport([{ trip: winter, segments }], "2026-01-05");
    expect(fifth.upcoming).toBe(1);
    expect(fifth.trips).toBe(0);
    const fifteenth = travelReport([{ trip: winter, segments }], "2026-01-15", { year: "2026" });
    expect(fifteenth.trips).toBe(1);
    expect(fifteenth.days).toBe(3);
    expect(fifteenth.years).toEqual([{ year: "2026", trips: 1, days: 3, countries: 1 }]);
  });

  it("are none for a trip whose every booking was cancelled, and the trip's own dates when none was", () => {
    expect(tripDays(trip, [paris], "2026-07-01").size).toBe(0);
    expect(tripDays(trip, [], "2026-07-01").size).toBe(20);
  });
});

describe("a trip whose every booking was cancelled", () => {
  const trip = { id: "t", title: "Stockholm", start: "2026-06-10", end: "2026-06-13", updatedAt: "2026-05-01T09:00:00Z" };

  it("is told apart from one with a live booking and from one with none", () => {
    expect(allCancelled([cancelled])).toBe(true);
    expect(allCancelled([cancelled, flight])).toBe(false);
    expect(allCancelled([])).toBe(false);
  });

  it("gets no calendar event; an empty trip still does", () => {
    const options = { stamp: "2026-05-01T09:00:00Z", tripUrl: (id: string) => `https://example.test/trips/${id}` };
    expect(exportCalendar([{ trip, segments: [{ ...cancelled, id: "s1" }] }], options)).not.toContain("UID:trip-t");
    expect(exportCalendar([{ trip, segments: [] }], options)).toContain("UID:trip-t");
  });

  it("isn't counted in the reports, done or ahead; an empty trip still is", () => {
    const past = travelReport([{ trip, segments: [cancelled] }], "2026-07-01");
    expect(past.trips).toBe(0);
    expect(past.years).toEqual([]);
    expect(travelReport([{ trip, segments: [cancelled] }], "2026-05-01").upcoming).toBe(0);
    expect(travelReport([{ trip, segments: [] }], "2026-05-01").upcoming).toBe(1);
    expect(travelReport([{ trip, segments: [] }], "2026-07-01").trips).toBe(1);
  });
});

describe("a cancellation that names several bookings", () => {
  // Read 1 May: a stay that ended 10 May, and a flight by its reference only.
  const mixed = {
    cancellations: [{ type: "lodging" as const, confirmation: "ST-1", start: "2026-05-05T15:00:00+02:00", end: "2026-05-10T11:00:00+02:00" }, { type: "flight" as const, confirmation: "FL-1" }],
    at: "2026-05-01T08:00:00Z",
  };

  it("keeps waiting while any of them still can come", () => {
    expect(pendingCancellationExpired(mixed, "2026-06-15T08:00:00Z")).toBe(false);
    expect(pendingCancellationExpired(mixed, "2027-05-02T08:00:00Z")).toBe(true);
  });

  it("waits only for those that still can", () => {
    expect(stillWaiting(mixed, "2026-05-20T08:00:00Z")).toHaveLength(2);
    expect(stillWaiting(mixed, "2026-06-15T08:00:00Z")).toEqual([mixed.cancellations[1]]);
  });
});

describe("pendingCancellationExpired", () => {
  const dated = { cancellations: [{ start: "2026-06-10T15:00:00+02:00", end: "2026-06-13T11:00:00+02:00" }], at: "2026-05-20T08:00:00Z" };
  const undated = { cancellations: [{ confirmation: "XQ7P2L" }], at: "2026-05-20T08:00:00Z" };

  it("keeps a cancellation for a month after it is read, so a backfill can reach older bookings", () => {
    expect(pendingCancellationExpired(dated, "2026-06-18T08:00:00Z")).toBe(false);
    expect(pendingCancellationExpired({ ...dated, at: "2026-06-15T08:00:00Z" }, "2026-07-01T08:00:00Z")).toBe(false);
  });

  it("keeps one whose booking hasn't ended, and drops it once it has", () => {
    expect(pendingCancellationExpired({ ...dated, at: "2026-04-01T08:00:00Z" }, "2026-06-13T08:00:00Z")).toBe(false);
    expect(pendingCancellationExpired(dated, "2026-06-30T08:00:00Z")).toBe(true);
  });

  it("keeps one without dates for a year", () => {
    expect(pendingCancellationExpired(undated, "2027-05-01T08:00:00Z")).toBe(false);
    expect(pendingCancellationExpired(undated, "2027-05-21T08:00:00Z")).toBe(true);
  });
});
