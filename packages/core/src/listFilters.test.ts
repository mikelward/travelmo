import { describe, expect, it } from "vitest";
import { flagsUnknown, hiddenFromList, homeBookings, localOnly, namedTravelers, noListFilters, travelerChoices, tripFlagsToWrite, tripTravelerDiff, tripTravelers, watchedTrip, watching } from "./listFilters";
import type { ExtractedSegment } from "./schema";

// Invented bookings: a show and a class in town, a hire car returned where
// it was picked up, a car to the airport, a flight and a stay.
const show: ExtractedSegment = { type: "activity", title: "Example Theatre", start: "2026-12-12T19:30:00+00:00", destination: { name: "Example Theatre", city: "London", country: "GB" } };
const dinner: ExtractedSegment = { type: "meal", title: "Example Bistro", start: "2026-12-12T18:00:00+00:00", destination: { name: "Example Bistro", city: "London" } };
const appointment: ExtractedSegment = { type: "other", title: "Example Visit", start: "2026-12-12T15:00:00+00:00", destination: { name: "Example Office", city: "London" } };
const hire: ExtractedSegment = { type: "car_rental", title: "Example Cars", start: "2026-12-13T09:00:00+00:00", origin: { name: "Example Cars Camden" }, destination: { name: "Example Cars Camden" } };
const transfer: ExtractedSegment = { type: "car_rental", title: "Example Cars", start: "2026-12-13T09:00:00+00:00", origin: { name: "Example Cars Camden" }, destination: { name: "Heathrow", code: "LHR" } };
const flight: ExtractedSegment = { type: "flight", title: "XX 1 LHR to DUB", start: "2026-12-13T09:00:00+00:00", origin: { name: "Heathrow", code: "LHR" }, destination: { name: "Dublin", code: "DUB" } };
const stay: ExtractedSegment = { type: "lodging", title: "Example Hotel", start: "2026-12-13T15:00:00+00:00", destination: { name: "Example Hotel", city: "Bath" } };
const cancelled = (s: ExtractedSegment) => ({ ...s, cancelledAt: "2026-11-01T00:00:00Z" });

describe("localOnly", () => {
  it("is a trip of shows, meals and a car returned where it was hired", () => {
    expect(localOnly([show, dinner, appointment, hire])).toBe(true);
  });

  it("isn't a trip with any journey, stay or ride to somewhere else", () => {
    expect(localOnly([show, flight])).toBe(false);
    expect(localOnly([show, stay])).toBe(false);
    expect(localOnly([show, transfer])).toBe(false);
  });

  it("goes by what is still booked, and isn't a trip with nothing booked", () => {
    expect(localOnly([show, cancelled(flight)])).toBe(true);
    expect(localOnly([cancelled(show)])).toBe(false);
    expect(localOnly([])).toBe(false);
  });
});

describe("hiddenFromList", () => {
  const trip = {};
  const off = { ...trip, cancelledAt: "2026-11-01T00:00:00Z" };

  it("hides nothing by default", () => {
    expect(hiddenFromList(off, [show], noListFilters)).toBe(false);
    expect(hiddenFromList(trip, [cancelled(flight)], noListFilters)).toBe(false);
  });

  it("hides a trip cancelled by its owner before its bookings are read, and one whose every booking was cancelled", () => {
    const filters = { ...noListFilters, hideCancelled: true };
    expect(hiddenFromList(off, undefined, filters)).toBe(true);
    expect(hiddenFromList(trip, [cancelled(flight)], filters)).toBe(true);
    expect(hiddenFromList(trip, [cancelled(flight), stay], filters)).toBe(false);
    expect(hiddenFromList(trip, undefined, filters)).toBe(false);
    expect(hiddenFromList(trip, [], filters)).toBe(false);
  });

  it("hides local events once the bookings are read", () => {
    const filters = { ...noListFilters, hideLocal: true };
    expect(hiddenFromList(trip, [show, dinner], filters)).toBe(true);
    expect(hiddenFromList(trip, undefined, filters)).toBe(false);
    expect(hiddenFromList(trip, [show, flight], filters)).toBe(false);
    // A cancelled night out is cancelled, not local.
    expect(hiddenFromList(trip, [cancelled(show)], filters)).toBe(false);
  });

  it("goes by the trip's own flags without its bookings, as far as they say", () => {
    const both = { ...noListFilters, hideCancelled: true, hideLocal: true };
    expect(hiddenFromList({ allCancelled: true, localOnly: false }, undefined, both)).toBe(true);
    expect(hiddenFromList({ allCancelled: false, localOnly: true }, undefined, both)).toBe(true);
    expect(hiddenFromList({ allCancelled: false, localOnly: false }, undefined, both)).toBe(false);
  });
});

describe("the trip's flags", () => {
  it("are unknown until all are kept, and written only when the bookings disagree", () => {
    expect(flagsUnknown({})).toBe(true);
    expect(flagsUnknown({ allCancelled: false })).toBe(true);
    expect(flagsUnknown({ allCancelled: false, localOnly: false })).toBe(true);
    expect(flagsUnknown({ allCancelled: false, localOnly: false, travelers: [] })).toBe(true);
    // A show alone is an event: its ticket, not its town.
    expect(tripFlagsToWrite({}, [show])).toEqual({ allCancelled: false, localOnly: true, travelers: [], setting: "activity", mixed: false });
    const kept = { allCancelled: false, localOnly: true, travelers: [], setting: "activity", mixed: false } as const;
    expect(tripFlagsToWrite(kept, [show])).toBeUndefined();
    // All cancelled, it isn't local any more, and goes by its town.
    expect(tripFlagsToWrite(kept, [cancelled(show)])).toEqual({ allCancelled: true, localOnly: false, travelers: [], setting: "city", mixed: false });
    expect(tripFlagsToWrite(kept, [{ ...show, travelers: ["Sam Example"] }])).toEqual({ allCancelled: false, localOnly: true, travelers: ["Sam Example"], setting: "activity", mixed: false });
    // A trip from before its setting was kept gets it, though its filters are known.
    expect(tripFlagsToWrite({ allCancelled: false, localOnly: true, travelers: [] }, [show])).toEqual(kept);
    expect(flagsUnknown({ allCancelled: false, localOnly: true, travelers: [] })).toBe(true);
    // And one from before `mixed` was kept, whether it looks like two trips.
    expect(flagsUnknown({ ...kept, mixed: undefined })).toBe(true);
    expect(flagsUnknown(kept)).toBe(false);
    // A trip of local events that kept a town before events took their booking's icon is read again, once.
    expect(flagsUnknown({ ...kept, setting: "city" })).toBe(true);
    expect(flagsUnknown({ ...kept, localOnly: false, setting: "city" })).toBe(false);
  });
});

// Invented people: the user, who bookings sent straight to them name most,
// and their mum.
const sam = { id: "sam", name: "Sam Example", aliases: ["EXAMPLE/SAM MR"], bookings: 5, direct: 5 };
const pat = { id: "pat", name: "Pat Example", aliases: [], bookings: 2, direct: 0 };

describe("tripTravelers", () => {
  it("is everyone the trip's bookings name, each once, going by what is still booked", () => {
    expect(tripTravelers([{ ...flight, travelers: ["Sam Example", "Pat Example"] }, { ...stay, travelers: ["EXAMPLE/SAM MR"] }])).toEqual(["Sam Example", "Pat Example"]);
    // Each spelling once, but two that may be two people both kept: the user's people tell them apart.
    expect(tripTravelers([{ ...flight, travelers: ["John Smith"] }, { ...stay, travelers: ["J Smith"] }])).toEqual(["John Smith", "J Smith"]);
    const people = [{ id: "me", name: "J Smith", aliases: ["Jane Smith"], bookings: 3, direct: 3 }, { id: "john", name: "John Smith", aliases: [], bookings: 1, direct: 0 }];
    expect(watching(tripTravelers([{ ...flight, travelers: ["John Smith"] }, { ...stay, travelers: ["J Smith"] }]), people)).toBe(false);
    expect(tripTravelers([cancelled({ ...flight, travelers: ["Pat Example"] }), { ...stay, travelers: ["Sam Example"] }])).toEqual(["Sam Example"]);
    expect(tripTravelers([cancelled({ ...flight, travelers: ["Pat Example"] })])).toEqual(["Pat Example"]);
    expect(tripTravelers([flight])).toEqual([]);
  });

  it("keeps a group's hundred, and more than that as none, never dropping the user's name for want of room", () => {
    const group = (n: number) => Array.from({ length: n }, (_, i) => `Person${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} Example`);
    expect(tripTravelers([{ ...flight, travelers: group(20) }, { ...stay, travelers: ["Sam Example"] }])).toHaveLength(21);
    expect(tripTravelers([{ ...flight, travelers: group(20) }, { ...stay, travelers: ["Sam Example"] }])).toContain("Sam Example");
    expect(tripTravelers([{ ...flight, travelers: group(100) }, { ...stay, travelers: ["Sam Example"] }])).toEqual([]);
    expect(watching(tripTravelers([{ ...flight, travelers: group(100) }, { ...stay, travelers: ["Sam Example"] }]), [sam, pat])).toBe(false);
  });
});

describe("watching", () => {
  it("is a trip whose bookings name travelers, none of them the user", () => {
    expect(watching(["Pat Example"], [sam, pat])).toBe(true);
    expect(watching(["Pat Example", "SAM EXAMPLE"], [sam, pat])).toBe(false);
    expect(watching(["Alex Other"], [sam, pat])).toBe(true);
  });

  it("isn't, while who the user is is unknown or the bookings name no one", () => {
    expect(watching(["Pat Example"], [])).toBe(false);
    expect(watching([], [sam, pat])).toBe(false);
    expect(watching(undefined, [sam, pat])).toBe(false);
  });

  it("follows whom the user said is them", () => {
    expect(watching(["Pat Example"], [sam, { ...pat, me: true }])).toBe(false);
    expect(watching(["Sam Example"], [sam, { ...pat, me: true }])).toBe(true);
  });

  it("hides a trip the user is only watching, by its flag or its bookings", () => {
    const filters = { ...noListFilters, hideWatching: true };
    expect(hiddenFromList({ travelers: ["Pat Example"] }, undefined, filters, [sam, pat])).toBe(true);
    expect(hiddenFromList({ travelers: ["Pat Example"] }, undefined, noListFilters, [sam, pat])).toBe(false);
    expect(hiddenFromList({}, [{ ...flight, travelers: ["Pat Example"] }], filters, [sam, pat])).toBe(true);
    expect(hiddenFromList({}, [{ ...flight, travelers: ["Sam Example"] }], filters, [sam, pat])).toBe(false);
    expect(hiddenFromList({}, undefined, filters, [sam, pat])).toBe(false);
  });
});

describe("watchedTrip", () => {
  it("goes by the trip's bookings once read, else by what the trip keeps", () => {
    expect(watchedTrip({ travelers: ["Sam Example"] }, [{ ...flight, travelers: ["Pat Example"] }], [sam, pat])).toBe(true);
    expect(watchedTrip({ travelers: ["Pat Example"] }, undefined, [sam, pat])).toBe(true);
    expect(watchedTrip({ travelers: ["Pat Example"] }, [{ ...flight, travelers: ["Sam Example"] }], [sam, pat])).toBe(false);
    expect(watchedTrip({}, undefined, [sam, pat])).toBe(false);
  });
});

describe("removedTravelers", () => {
  const printout = [{ ...flight, travelers: ["EXAMPLE/SAM MR", "Pat Example"] }, { ...stay, travelers: ["Sam Example"] }];

  it("leaves the names the owner took off out of whom a trip is for, however a booking spells them", () => {
    expect(tripTravelers(printout, ["Sam Example"])).toEqual(["Pat Example"]);
    expect(tripTravelers(printout, ["SAM EXAMPLE"])).toEqual(["Pat Example"]);
  });

  it("makes a trip the user was taken off one they're only watching, even when it names no one else", () => {
    expect(watchedTrip({}, printout, [sam, pat])).toBe(false);
    expect(watchedTrip({ removedTravelers: ["Sam Example"] }, printout, [sam, pat])).toBe(true);
    expect(watchedTrip({ removedTravelers: ["Sam Example"] }, [{ ...stay, travelers: ["Sam Example"] }], [sam, pat])).toBe(true);
    expect(watchedTrip({ removedTravelers: ["Sam Example"], travelers: [] }, undefined, [sam, pat])).toBe(true);
    expect(watchedTrip({ removedTravelers: ["Pat Example"] }, printout, [sam, pat])).toBe(false);
  });

  it("keeps the trip's flags and the list filter in step with it", () => {
    expect(tripFlagsToWrite({ removedTravelers: ["Sam Example"] }, printout)?.travelers).toEqual(["Pat Example"]);
    expect(hiddenFromList({ removedTravelers: ["Sam Example"] }, printout, { ...noListFilters, hideWatching: true }, [sam, pat])).toBe(true);
  });

  it("leaves a trip the user was taken off out of where home is", () => {
    const mine = [{ ...flight, travelers: ["Sam Example"] }];
    expect(homeBookings([mine, { removedTravelers: ["Sam Example"], segments: printout }], [sam, pat])).toEqual(mine);
    expect(homeBookings([mine, { segments: printout }], [sam, pat])).toEqual([...mine, ...printout]);
  });

  it("lists every name for the dialog, those taken off too", () => {
    expect(namedTravelers(printout, ["Sam Example"])).toEqual(["Sam Example", "Pat Example"]);
    expect(namedTravelers([flight], ["Sam Example"])).toEqual(["Sam Example"]);
    expect(namedTravelers([cancelled({ ...flight, travelers: ["Alex Other"] }), { ...stay, travelers: ["Sam Example"] }])).toEqual(["Sam Example", "Alex Other"]);
  });
});

describe("addedTravelers", () => {
  const bookedByPat = [{ ...stay, travelers: ["Pat Example"] }];

  it("includes names the owner put on the trip, making a watched trip theirs", () => {
    expect(tripTravelers(bookedByPat, [], ["Sam Example"])).toEqual(["Pat Example", "Sam Example"]);
    expect(watchedTrip({}, bookedByPat, [sam, pat])).toBe(true);
    expect(watchedTrip({ addedTravelers: ["Sam Example"] }, bookedByPat, [sam, pat])).toBe(false);
    expect(tripFlagsToWrite({ addedTravelers: ["Sam Example"] }, bookedByPat)?.travelers).toEqual(["Pat Example", "Sam Example"]);
    expect(hiddenFromList({ addedTravelers: ["Sam Example"] }, bookedByPat, { ...noListFilters, hideWatching: true }, [sam, pat])).toBe(false);
  });

  it("includes a trip the user added themselves to when working out home", () => {
    expect(homeBookings([{ segments: bookedByPat }], [sam, pat])).toEqual([]);
    expect(homeBookings([{ addedTravelers: ["Sam Example"], segments: bookedByPat }], [sam, pat])).toEqual(bookedByPat);
  });

  it("lists added names beside booking names and known people in the dialog", () => {
    const alex = { id: "p3", name: "Alex Example", aliases: [], bookings: 2, direct: 0 };
    expect(namedTravelers(bookedByPat, [], ["Sam Example"])).toEqual(["Pat Example", "Sam Example"]);
    expect(travelerChoices(bookedByPat, [], [], [pat, alex, sam])).toEqual([
      { name: "Pat Example", selected: true },
      { name: "Sam Example", selected: false },
      { name: "Alex Example", selected: false },
    ]);
    // A booking spelling that already matches a known person does not repeat them.
    const patWithAlias = { ...pat, aliases: ["P Example"] };
    expect(travelerChoices([{ ...stay, travelers: ["P Example"] }], [], [], [sam, patWithAlias])).toEqual([
      { name: "P Example", selected: true },
      { name: "Sam Example", selected: false },
    ]);
    // Already-added names start ticked; removed names start unticked.
    expect(travelerChoices(bookedByPat, ["Pat Example"], ["Sam Example"], [sam, pat, alex])).toEqual([
      { name: "Pat Example", selected: false },
      { name: "Sam Example", selected: true },
      { name: "Alex Example", selected: false },
    ]);
  });

  it("splits ticked and unticked names into removed and added for saving", () => {
    // Adding yourself to someone else's booking keeps nothing in removed.
    expect(tripTravelerDiff(bookedByPat, [], ["Pat Example", "Sam Example"])).toEqual({
      removed: [],
      added: ["Sam Example"],
    });
    // Unticking a booking's traveler puts them in removed; unticking an added one just drops them.
    expect(tripTravelerDiff(bookedByPat, [], ["Sam Example"])).toEqual({
      removed: ["Pat Example"],
      added: ["Sam Example"],
    });
    expect(tripTravelerDiff(bookedByPat, [], ["Pat Example"])).toEqual({
      removed: [],
      added: [],
    });
    // A trip with no named bookings can still take added names.
    expect(tripTravelerDiff([stay], [], ["Sam Example", "SMITH/ALEX MR"])).toEqual({
      removed: [],
      added: ["Sam Example", "Alex Smith"],
    });
    // Someone named only on a cancelled booking alongside an active booking starts unticked and goes into added when ticked.
    const mixedCancelled = [{ ...stay, travelers: ["Pat Example"] }, cancelled({ ...flight, travelers: ["Sam Example"] })];
    expect(travelerChoices(mixedCancelled, [], [], [sam, pat])).toEqual([
      { name: "Pat Example", selected: true },
      { name: "Sam Example", selected: false },
    ]);
    expect(tripTravelerDiff(mixedCancelled, [], ["Pat Example", "Sam Example"])).toEqual({
      removed: [],
      added: ["Sam Example"],
    });
    expect(tripTravelerDiff(mixedCancelled, [], ["Pat Example"])).toEqual({
      removed: [],
      added: [],
    });
  });
});

describe("homeBookings", () => {
  it("is every trip's bookings but those of trips the user is only watching", () => {
    const mine = [{ ...flight, travelers: ["Sam Example"] }];
    const mums = [{ ...stay, travelers: ["Pat Example"] }];
    expect(homeBookings([mine, mums, [show]], [sam, pat])).toEqual([...mine, show]);
    expect(homeBookings([mine, mums], [])).toEqual([...mine, ...mums]);
  });
});
