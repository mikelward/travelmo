import type { ExtractedSegment, Segment, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { regroupTrips } from "./regroup";
import { memoryStore, type Memory } from "./testStore";

const at = "2026-11-01T12:00:00Z";
const deps = (store: Memory) => ({ store, now: () => "2026-11-22T12:00:00Z", log: () => {} });

const academy = { name: "Fixation Academy of Performing Arts", city: "London", country: "GB" };
const euston = { name: "London Euston", code: "EUS", city: "London", country: "GB" };
const limeStreet = { name: "Liverpool Lime Street", code: "LIV", city: "Liverpool", country: "GB" };

function trip(id: string, title: string, start: string, end: string, sharedWith: string[] = []): Trip {
  return { id, title, start, end, ownerUid: "u1", sharedWith, createdAt: at, updatedAt: at };
}

function segment(tripId: string, id: string, source: string, extracted: ExtractedSegment, extra: Partial<Segment> = {}): Segment {
  return {
    ...extracted,
    id,
    tripId,
    source: "gmail",
    gmailMessageIds: [source],
    sources: [{ kind: "gmail", id: source, uid: "u1", at }],
    createdAt: at,
    updatedAt: at,
    ...extra,
  };
}

// The trip production imports made: a holiday club at home either side of a
// weekend in Liverpool, as one "London" trip shared with a partner.
function mayAsOneTrip(store: Memory) {
  store.trips.set("london", trip("london", "London", "2026-05-22", "2026-05-29", ["partner@example.com"]));
  const put = (s: Segment) => store.segments.set(s.id, s);
  put(segment("london", "m22-0", "m22", { type: "activity", title: "Eva Ward's Stage Stars! Holiday Club", start: "2026-05-22T00:00:00+01:00", destination: academy }));
  put(
    segment(
      "london",
      "mtr-0",
      "mtr",
      { type: "train", title: "Avanti West Coast London Euston to Liverpool Lime Street", start: "2026-05-23T12:07:00+01:00", end: "2026-05-23T14:23:00+01:00", origin: euston, destination: limeStreet },
      { rating: 5, favorite: true },
    ),
  );
  put(segment("london", "mtr-1", "mtr", { type: "train", title: "Avanti West Coast Liverpool Lime Street to London Euston", start: "2026-05-25T11:43:00+01:00", end: "2026-05-25T14:03:00+01:00", origin: limeStreet, destination: euston }));
  put(segment("london", "m26-0", "m26", { type: "activity", title: "Stage Stars! Holiday Club - Day 1", start: "2026-05-26T09:00:00+01:00", end: "2026-05-26T16:00:00+01:00", destination: academy }));
}

const summary = (store: Memory) =>
  [...store.trips.values()]
    .map((t) => ({
      title: t.title,
      start: t.start,
      end: t.end,
      sharedWith: t.sharedWith,
      segments: [...store.segments.values()].filter((s) => s.tripId === t.id).map((s) => s.id).sort(),
    }))
    .sort((a, b) => a.start.localeCompare(b.start));

describe("regroupTrips", () => {
  it("splits days out at home from the trip away, each part shared as the trip was", async () => {
    const store = memoryStore();
    mayAsOneTrip(store);
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 3, deleted: 0 });
    expect(summary(store)).toEqual([
      { title: "Eva Ward's Stage Stars! Holiday Club", start: "2026-05-22", end: "2026-05-22", sharedWith: ["partner@example.com"], segments: ["m22-0"] },
      { title: "Liverpool", start: "2026-05-23", end: "2026-05-25", sharedWith: ["partner@example.com"], segments: ["mtr-0", "mtr-1"] },
      { title: "Stage Stars! Holiday Club - Day 1", start: "2026-05-26", end: "2026-05-26", sharedWith: ["partner@example.com"], segments: ["m26-0"] },
    ]);
    expect(store.trips.get("london")?.title).toBe("Liverpool");
    expect(store.segments.get("mtr-0")).toMatchObject({ tripId: "london", rating: 5, favorite: true, createdAt: at, updatedAt: at });
    expect(store.segments.size).toBe(4);
  });

  it("changes nothing the second time", async () => {
    const store = memoryStore();
    mayAsOneTrip(store);
    await regroupTrips("u1", deps(store));
    const before = summary(store);
    const trips = new Map(store.trips);
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0 });
    expect(summary(store)).toEqual(before);
    expect(new Map(store.trips)).toEqual(trips);
  });

  it("leaves a trip the user renamed alone while its bookings stay together", async () => {
    const store = memoryStore();
    mayAsOneTrip(store);
    store.trips.set("palace", trip("palace", "Palace with Nan", "2026-12-20", "2026-12-20"));
    store.segments.set(
      "mhc-0",
      segment("palace", "mhc-0", "mhc", {
        type: "activity",
        title: "Hampton Court Palace Admission",
        start: "2026-12-20T12:00:00+00:00",
        destination: { name: "Hampton Court Palace", city: "East Molesey", country: "GB" },
      }),
    );
    await regroupTrips("u1", deps(store));
    expect(store.trips.get("palace")).toEqual(trip("palace", "Palace with Nan", "2026-12-20", "2026-12-20"));
  });

  it("moves a ride from the airport into the trip of the flight it meets", async () => {
    const store = memoryStore();
    const lhr = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
    const jfk = { name: "John F. Kennedy International", code: "JFK", city: "New York", country: "US" };
    store.trips.set("usa", trip("usa", "New York", "2026-07-10", "2026-07-23"));
    store.trips.set("ride", trip("ride", "London", "2026-07-23", "2026-07-23"));
    const put = (s: Segment) => store.segments.set(s.id, s);
    put(segment("usa", "f-0", "f", { type: "flight", title: "BA 117", start: "2026-07-10T08:25:00+01:00", end: "2026-07-10T11:10:00-04:00", origin: lhr, destination: jfk }));
    put(segment("usa", "f-1", "f", { type: "flight", title: "BA 112", start: "2026-07-22T18:30:00-04:00", end: "2026-07-23T06:35:00+01:00", origin: jfk, destination: lhr }));
    put(
      segment("ride", "r-0", "r", {
        type: "car_rental",
        title: "Abetta Car from Heathrow Terminal 3 to London",
        start: "2026-07-23T15:27:00+01:00",
        origin: { name: "Heathrow Terminal 3 - LHR, TW6 1SX", city: "London", country: "GB" },
        destination: { name: "1 Example Road, London N1 1AA", city: "London", country: "GB" },
      }),
    );
    await regroupTrips("u1", deps(store));
    expect(summary(store).map((t) => [t.title, t.segments])).toEqual([["New York", ["f-0", "f-1", "r-0"]]]);
  });

  it("merges trips one import split, deleting the one left empty", async () => {
    const store = memoryStore();
    store.trips.set("a", trip("a", "Liverpool", "2026-05-23", "2026-05-23"));
    store.trips.set("b", trip("b", "Liverpool again", "2026-05-24", "2026-05-24"));
    store.trips.set("empty", trip("empty", "Japan, some day", "2027-04-01", "2027-04-10"));
    store.segments.set("o-0", segment("a", "o-0", "o", { type: "train", title: "Out", start: "2026-05-23T12:07:00+01:00", origin: euston, destination: limeStreet }));
    store.segments.set(
      "h-0",
      segment("b", "h-0", "h", { type: "lodging", title: "Hotel", start: "2026-05-24T15:00:00+01:00", destination: { name: "Hotel", city: "Liverpool", country: "GB" } }),
    );
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 1, deleted: 1 });
    expect(summary(store).map((t) => [t.title, t.segments])).toEqual([
      ["Liverpool", ["h-0", "o-0"]],
      ["Japan, some day", []],
    ]);
  });

  it("leaves a TripIt trip's own grouping alone", async () => {
    const store = memoryStore();
    mayAsOneTrip(store);
    store.trips.set("tripit-u1-9", trip("tripit-u1-9", "Holiday", "2026-05-26", "2026-05-26"));
    store.segments.set(
      "t-0",
      segment("tripit-u1-9", "t-0", "t", { type: "activity", title: "Club extra", start: "2026-05-26T17:00:00+01:00", destination: academy }, { source: "tripit" }),
    );
    await regroupTrips("u1", deps(store));
    expect(store.segments.get("t-0")?.tripId).toBe("tripit-u1-9");
    expect(store.trips.get("tripit-u1-9")?.title).toBe("Holiday");
  });

  it("deletes a trip emptied in an earlier pass and counts it", async () => {
    const store = memoryStore();
    const hotel = (city: string) => ({ name: "Hotel", city, country: "GB" });
    store.trips.set("a", trip("a", "Liverpool", "2026-05-23", "2026-05-23"));
    store.trips.set("b", trip("b", "Liverpool again", "2026-05-24", "2026-05-24"));
    store.trips.set("c", trip("c", "Leeds", "2026-08-01", "2026-08-01"));
    store.trips.set("d", trip("d", "Leeds again", "2026-08-02", "2026-08-02"));
    store.segments.set("o-0", segment("a", "o-0", "o", { type: "train", title: "Out", start: "2026-05-23T12:07:00+01:00", origin: euston, destination: limeStreet }));
    store.segments.set("h-0", segment("b", "h-0", "h", { type: "lodging", title: "Hotel", start: "2026-05-24T15:00:00+01:00", destination: hotel("Liverpool") }));
    store.segments.set(
      "o2-0",
      segment("c", "o2-0", "o2", { type: "train", title: "Out", start: "2026-08-01T09:00:00+01:00", origin: euston, destination: { name: "Leeds", city: "Leeds", country: "GB" } }),
    );
    store.segments.set("h2-0", segment("d", "h2-0", "h2", { type: "lodging", title: "Hotel", start: "2026-08-02T15:00:00+01:00", destination: hotel("Leeds") }));
    // Room for one trip's moves a pass, so the second waits for a second pass.
    expect(await regroupTrips("u1", deps(store), 4)).toEqual({ changed: 2, deleted: 2 });
    expect([...store.trips.keys()].sort()).toEqual(["a", "c"]);
    expect(summary(store).map((t) => t.segments)).toEqual([["h-0", "o-0"], ["h2-0", "o2-0"]]);
  });

  it("moves the revision of every trip a pass took bookings from", async () => {
    const store = memoryStore();
    mayAsOneTrip(store);
    const lock = store.withUserLock.bind(store);
    let firstPass: Trip | undefined;
    store.withUserLock = async (uid, fn) => {
      const result = await lock(uid, fn);
      firstPass ??= store.trips.get("london");
      return result;
    };
    // The first pass has room for the 22 May club day only.
    await regroupTrips("u1", deps(store), 4);
    expect(firstPass).toMatchObject({ title: "Liverpool", start: "2026-05-23", updatedAt: "2026-11-22T12:00:00Z" });
    expect(summary(store).map((t) => t.title)).toEqual(["Eva Ward's Stage Stars! Holiday Club", "Liverpool", "Stage Stars! Holiday Club - Day 1"]);
  });

  it("keeps the legs of one older email together when they are days apart", async () => {
    const store = memoryStore();
    // Imported before bookings recorded their sources: only the email id.
    const legacy = (id: string, extracted: ExtractedSegment): Segment => {
      const { sources: _sources, ...rest } = segment("liv", id, "m1", extracted);
      return rest;
    };
    store.trips.set("liv", trip("liv", "Liverpool", "2026-05-01", "2026-05-08"));
    store.segments.set("m1-0", legacy("m1-0", { type: "train", title: "Out", start: "2026-05-01T12:07:00+01:00", origin: euston, destination: limeStreet }));
    store.segments.set("m1-1", legacy("m1-1", { type: "train", title: "Back", start: "2026-05-08T11:43:00+01:00", origin: limeStreet, destination: euston }));
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0 });
    expect(summary(store).map((t) => [t.title, t.segments])).toEqual([["Liverpool", ["m1-0", "m1-1"]]]);
  });

  it("names and dates a kept trip when a pass moves the rest of its bookings out", async () => {
    const store = memoryStore();
    store.trips.set("london", trip("london", "London", "2026-05-20", "2026-05-25"));
    const put = (s: Segment) => store.segments.set(s.id, s);
    put(segment("london", "c20-0", "c20", { type: "activity", title: "Club day one", start: "2026-05-20T09:00:00+01:00", destination: academy }));
    put(segment("london", "c21-0", "c21", { type: "activity", title: "Club day two", start: "2026-05-21T09:00:00+01:00", destination: academy }));
    put(segment("london", "tr-0", "tr", { type: "train", title: "Out", start: "2026-05-23T12:07:00+01:00", origin: euston, destination: limeStreet }));
    put(segment("london", "tr-1", "tr", { type: "train", title: "Back", start: "2026-05-25T11:43:00+01:00", origin: limeStreet, destination: euston }));
    // Room for both club days in the first pass, not for the trip they leave.
    await regroupTrips("u1", deps(store), 7);
    expect(store.trips.get("london")).toMatchObject({ title: "Liverpool", start: "2026-05-23", end: "2026-05-25" });
    expect(summary(store).map((t) => t.title)).toEqual(["Club day one", "Club day two", "Liverpool"]);
  });

  describe("never mixes trips shared with different people", () => {
    const hotel = { name: "Hotel", city: "Liverpool", country: "GB" };
    const train = (tripId: string, id: string, start: string) =>
      segment(tripId, id, id, { type: "train", title: "Out", start, origin: euston, destination: limeStreet });
    const stay = (tripId: string, id: string, start: string) => segment(tripId, id, id, { type: "lodging", title: "Hotel", start, destination: hotel });
    const placement = (store: Memory) => [...store.segments.values()].map((s) => `${s.id}@${s.tripId}`).sort();
    const sharing = (store: Memory) => [...store.trips.values()].map((t) => `${t.id}:${t.sharedWith.join(",")}`).sort();

    it.each([
      ["the private trip smaller", 1, 2],
      ["the private trip larger", 3, 1],
    ])("keeps a private trip and a shared one apart, %s", async (_, privateCount, sharedCount) => {
      const store = memoryStore();
      store.trips.set("private", trip("private", "Liverpool", "2026-05-23", "2026-05-24"));
      store.trips.set("shared", trip("shared", "Liverpool with Sam", "2026-05-23", "2026-05-24", ["sam@example.com"]));
      for (let i = 0; i < privateCount; i++) store.segments.set(`p${i}-0`, stay("private", `p${i}-0`, `2026-05-2${3 + (i % 2)}T15:00:00+01:00`));
      for (let i = 0; i < sharedCount; i++) store.segments.set(`s${i}-0`, train("shared", `s${i}-0`, `2026-05-2${3 + (i % 2)}T12:00:00+01:00`));
      const before = placement(store);
      expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0 });
      expect(placement(store)).toEqual(before);
      expect(sharing(store)).toEqual(["private:", "shared:sam@example.com"]);
    });

    it("moves none of the owner's private bookings into a trip a sharee filled", async () => {
      const store = memoryStore();
      store.trips.set("shared", trip("shared", "Shared", "2026-05-01", "2026-05-31", ["sharee@example.com"]));
      for (let day = 10; day <= 30; day++) {
        store.segments.set(
          `x${day}-0`,
          segment("shared", `x${day}-0`, `x${day}`, { type: "activity", title: `Thing ${day}`, start: `2026-05-${day}T10:00:00+01:00`, destination: hotel }),
        );
      }
      store.trips.set("mine", trip("mine", "Liverpool", "2026-05-23", "2026-05-24"));
      store.segments.set("o-0", train("mine", "o-0", "2026-05-23T12:07:00+01:00"));
      store.segments.set("h-0", stay("mine", "h-0", "2026-05-24T15:00:00+01:00"));
      await regroupTrips("u1", deps(store));
      expect(store.segments.get("o-0")?.tripId).not.toBe("shared");
      expect(store.segments.get("h-0")?.tripId).not.toBe("shared");
      // The outings on different days each become a day out of their own,
      // still shared as they were; the private bookings stay private.
      for (const id of ["o-0", "h-0"]) expect(store.trips.get(store.segments.get(id)!.tripId)?.sharedWith).toEqual([]);
      for (let day = 10; day <= 30; day++) {
        expect(store.trips.get(store.segments.get(`x${day}-0`)!.tripId)?.sharedWith).toEqual(["sharee@example.com"]);
      }
    });

    it("still regroups trips shared with the same people, in any order", async () => {
      const store = memoryStore();
      mayAsOneTrip(store);
      store.trips.set("extra", trip("extra", "Liverpool hotel", "2026-05-24", "2026-05-24", ["Partner@Example.com"]));
      store.segments.set("h-0", stay("extra", "h-0", "2026-05-24T15:00:00+01:00"));
      await regroupTrips("u1", deps(store));
      expect(summary(store).map((t) => [t.title, t.segments])).toEqual([
        ["Eva Ward's Stage Stars! Holiday Club", ["m22-0"]],
        ["Liverpool", ["h-0", "mtr-0", "mtr-1"]],
        ["Stage Stars! Holiday Club - Day 1", ["m26-0"]],
      ]);
      expect(store.trips.has("extra")).toBe(false);
    });
  });

  it("finishes a move too large for one pass, a part at a time", async () => {
    const store = memoryStore();
    const ticket = (tripId: string, id: string, day: string) =>
      segment(tripId, id, id, { type: "activity", title: `Ticket ${id}`, start: `2026-05-${day}T10:00:00+01:00`, destination: { name: "Hall", city: "Leeds", country: "GB" } });
    store.trips.set("a", trip("a", "A", "2026-05-01", "2026-05-10"));
    store.trips.set("b", trip("b", "B", "2026-05-10", "2026-05-10"));
    for (let i = 0; i < 5; i++) store.segments.set(`a1-${i}`, ticket("a", `a1-${i}`, "01"));
    for (let i = 0; i < 4; i++) store.segments.set(`a10-${i}`, ticket("a", `a10-${i}`, "10"));
    for (let i = 0; i < 6; i++) store.segments.set(`b10-${i}`, ticket("b", `b10-${i}`, "10"));
    // Moving A's four 10 May tickets to B takes ten writes; a pass has six.
    expect(await regroupTrips("u1", deps(store), 6)).toEqual({ changed: 2, deleted: 0 });
    const where = (prefix: string) => [...store.segments.values()].filter((s) => s.id.startsWith(prefix)).map((s) => s.tripId);
    expect(new Set(where("a1-"))).toEqual(new Set(["a"]));
    expect(new Set([...where("a10-"), ...where("b10-")])).toEqual(new Set(["b"]));
    expect(store.trips.get("a")).toMatchObject({ start: "2026-05-01", end: "2026-05-01" });
    expect(await regroupTrips("u1", deps(store), 6)).toEqual({ changed: 0, deleted: 0 });
  });

  it("keeps legs together that a later email links", async () => {
    const store = memoryStore();
    const ref = (id: string, when: string) => ({ kind: "gmail" as const, id, uid: "u1", at: when });
    store.trips.set("liv", trip("liv", "Liverpool", "2026-05-01", "2026-05-10"));
    // The outbound came in from email A; email B, with both legs, matched it
    // and filed its return beside it.
    store.segments.set(
      "a-0",
      segment("liv", "a-0", "a", { type: "train", title: "Out", start: "2026-05-01T12:07:00+01:00", origin: euston, destination: limeStreet }, {
        gmailMessageIds: ["a"],
        sources: [ref("a", "2026-04-01T09:00:00Z"), ref("b", "2026-04-20T09:00:00Z")],
      }),
    );
    store.segments.set(
      "b-1",
      segment("liv", "b-1", "b", { type: "train", title: "Back", start: "2026-05-10T11:43:00+01:00", origin: limeStreet, destination: euston }, {
        gmailMessageIds: ["b"],
        sources: [ref("b", "2026-04-20T09:00:00Z")],
      }),
    );
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0 });
    expect(summary(store).map((t) => [t.title, t.segments])).toEqual([["Liverpool", ["a-0", "b-1"]]]);
  });
});

describe("regroupTrips with outings at home", () => {
  const gb = (name: string, city: string) => ({ name, city, country: "GB" });

  it("splits three outings filed as one trip into a day out each", async () => {
    const store = memoryStore();
    store.trips.set("club", trip("club", "Junior Adventures Group Club", "2026-11-08", "2026-11-09"));
    const put = (s: Segment) => store.segments.set(s.id, s);
    put(
      segment("club", "e1-0", "e1", {
        type: "activity",
        title: "Wild Horse Nine at Muswell Hill",
        provider: "Everyman Cinemas",
        confirmation: "615858",
        start: "2026-11-08T12:00:00+00:00",
        destination: gb("Everyman Muswell Hill", "London"),
        notes: "Screen 3, seats C8 and C7",
      }),
    );
    put(
      segment("club", "e2-0", "e2", {
        type: "activity",
        title: "Wild Horse Nine at Everyman Muswell Hill",
        provider: "Everyman",
        confirmation: "WQFXR5T",
        start: "2026-11-08T12:00:00+00:00",
        destination: gb("Everyman", "London"),
      }),
    );
    put(
      segment("club", "j-0", "j", {
        type: "activity",
        title: "Junior Adventures Group Club",
        provider: "Junior Adventures Group",
        confirmation: "PSAD8686493/38",
        start: "2026-11-09T12:02:00+00:00",
        destination: gb("BR1 2SQ", "Bromley"),
      }),
    );
    await regroupTrips("u1", deps(store));
    expect(summary(store).map((t) => [t.title, t.start, t.end, t.segments])).toEqual([
      ["Wild Horse Nine at Muswell Hill", "2026-11-08", "2026-11-08", ["e1-0", "e2-0"]],
      ["Junior Adventures Group Club", "2026-11-09", "2026-11-09", ["j-0"]],
    ]);
  });

  it("splits a summer filed as one trip into the outings and the two trips away", async () => {
    const store = memoryStore();
    store.trips.set("tower", trip("tower", "Tower of London", "2026-08-10", "2026-11-13"));
    const put = (id: string, extracted: ExtractedSegment) => store.segments.set(id, segment("tower", id, id.replace(/-\d+$/, ""), extracted));
    for (const n of [1, 2, 3, 4, 5]) {
      put(`camp-${n - 1}`, {
        type: "activity",
        title: `Holiday Camp East Finchley - Junior Group (Day ${n})`,
        start: `2026-08-${9 + n}T09:00:00+01:00`,
        end: `2026-08-${9 + n}T17:00:00+01:00`,
        destination: gb("N2 9JP", "London"),
      });
    }
    put("car-0", {
      type: "other",
      title: "Abetta car to Stansted Airport",
      start: "2026-08-15T10:30:00+01:00",
      origin: gb("N10 3AR", "London"),
      destination: { ...gb("Stansted Airport", "Stansted"), code: "STN" },
    });
    put("express-0", {
      type: "train",
      title: "Arlanda Express Stockholm → Stockholm",
      start: "2026-08-15T13:28:00+02:00",
      end: "2026-11-13T23:59:00+01:00",
      origin: { name: "Stockholm Arlanda Airport", city: "Stockholm", country: "SE" },
      destination: { name: "Stockholm Central", city: "Stockholm", country: "SE" },
    });
    put("course-0", {
      type: "activity",
      title: "5 Day Summer Holiday Course: Peter Pan",
      start: "2026-08-24T09:30:00+01:00",
      end: "2026-08-28T15:30:00+01:00",
      destination: gb("N10 3BG", "Muswell Hill"),
    });
    put("vs-0", {
      type: "flight",
      title: "VS157 LHR to BOS",
      start: "2026-08-25T11:20:00+01:00",
      end: "2026-08-25T13:50:00-04:00",
      origin: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
      destination: { name: "Logan", code: "BOS", city: "Boston", country: "US" },
    });
    put("vs-1", {
      type: "flight",
      title: "VS158 BOS to LHR",
      start: "2026-09-04T19:00:00-04:00",
      end: "2026-09-05T06:30:00+01:00",
      origin: { name: "Logan", code: "BOS", city: "Boston", country: "US" },
      destination: { name: "Heathrow", code: "LHR", city: "London", country: "GB" },
    });
    put("tower-0", { type: "activity", title: "Tower of London Admission", start: "2026-11-01T10:00:00+00:00", destination: gb("Tower of London", "London") });
    await regroupTrips("u1", deps(store));
    expect(summary(store).map((t) => [t.title, t.start, t.end, t.segments])).toEqual([
      ["Holiday Camp East Finchley - Junior Group", "2026-08-10", "2026-08-14", ["camp-0", "camp-1", "camp-2", "camp-3", "camp-4"]],
      ["Stockholm", "2026-08-15", "2026-08-15", ["car-0", "express-0"]],
      ["5 Day Summer Holiday Course: Peter Pan", "2026-08-24", "2026-08-28", ["course-0"]],
      ["Boston", "2026-08-25", "2026-09-05", ["vs-0", "vs-1"]],
      ["Tower of London", "2026-11-01", "2026-11-01", ["tower-0"]],
    ]);
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0 });
  });
});
