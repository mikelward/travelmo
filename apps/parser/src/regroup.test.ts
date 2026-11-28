import { homeCorrections, type ExtractedSegment, type Segment, type Trip } from "@travelmo/core";
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

describe("regroupTrips with cancelled bookings", () => {
  const cancelled = { cancelledAt: "2026-11-05T09:00:00Z", cancelledBy: "mc" };

  it("regroups a trip whose only booking is cancelled without error, leaving it where it is", async () => {
    const store = memoryStore();
    store.trips.set("stockholm", trip("stockholm", "Stockholm", "2026-06-10", "2026-06-13"));
    const stay = { type: "lodging" as const, title: "Example Hotel Gamla Stan", start: "2026-06-10T15:00:00+02:00", end: "2026-06-13T11:00:00+02:00", destination: { name: "Example Hotel Gamla Stan", city: "Stockholm", country: "SE" } };
    store.segments.set("ms-0", segment("stockholm", "ms-0", "ms", stay, cancelled));
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
    expect(summary(store)).toEqual([{ title: "Stockholm", start: "2026-06-10", end: "2026-06-13", sharedWith: [], segments: ["ms-0"] }]);
  });

  it("files a booking by what is still booked in it, not by a cancelled part", async () => {
    const store = memoryStore();
    const stay = (title: string, city: string, country: string, start: string, end: string) => ({
      type: "lodging" as const,
      title,
      start,
      end,
      destination: { name: title, city, country },
    });
    store.trips.set("stockholm", trip("stockholm", "Stockholm", "2026-06-10", "2026-06-13"));
    store.segments.set("ms-0", segment("stockholm", "ms-0", "ms", stay("Example Hotel Gamla Stan", "Stockholm", "SE", "2026-06-10T15:00:00+02:00", "2026-06-13T11:00:00+02:00")));
    // One email: a cancelled Paris stay in June and a live Rome stay in July.
    store.trips.set("rome", trip("rome", "Rome", "2026-07-10", "2026-07-12"));
    store.segments.set("mx-0", segment("rome", "mx-0", "mx", stay("Example Hotel Paris", "Paris", "FR", "2026-06-12T15:00:00+02:00", "2026-06-14T11:00:00+02:00"), cancelled));
    store.segments.set("mx-1", segment("rome", "mx-1", "mx", stay("Example Hotel Roma", "Rome", "IT", "2026-07-10T15:00:00+02:00", "2026-07-12T11:00:00+02:00")));
    await regroupTrips("u1", deps(store));
    const trips = summary(store);
    expect(trips.find((t) => t.segments.includes("ms-0"))).toMatchObject({ start: "2026-06-10", end: "2026-06-13", segments: ["ms-0"] });
    expect(trips.find((t) => t.segments.includes("mx-1"))).toMatchObject({ start: "2026-07-10", end: "2026-07-12" });
  });

  it("leaves each trip showing when its own bookings now travel", async () => {
    const store = memoryStore();
    const stay = (title: string, start: string, end: string) => ({ type: "lodging" as const, title, start, end, destination: { name: title, city: "Lyon", country: "FR" } });
    // A live June stay and a cancelled one weeks later, on one trip showing June only.
    store.trips.set("lyon", { ...trip("lyon", "Lyon", "2026-06-01", "2026-06-25"), liveStart: "2026-06-01", liveEnd: "2026-06-03" });
    store.segments.set("ma-0", segment("lyon", "ma-0", "ma", stay("Example Hotel One", "2026-06-01T15:00:00+02:00", "2026-06-03T11:00:00+02:00")));
    store.segments.set("mb-0", segment("lyon", "mb-0", "mb", stay("Example Hotel Two", "2026-06-20T15:00:00+02:00", "2026-06-25T11:00:00+02:00"), cancelled));
    await regroupTrips("u1", deps(store));
    const live = [...store.trips.values()].find((t) => store.segments.get("ma-0")!.tripId === t.id)!;
    expect(store.segments.get("mb-0")!.tripId).not.toBe(live.id);
    expect(live).toMatchObject({ start: "2026-06-01", end: "2026-06-03" });
    expect(live.liveStart).toBeUndefined();
  });

  it("keeps back-to-back cancelled stays together, by their booked dates", async () => {
    const store = memoryStore();
    const stay = (title: string, start: string, end: string) => ({ type: "lodging" as const, title, start, end, destination: { name: title, city: "Lyon", country: "FR" } });
    store.trips.set("lyon", trip("lyon", "Lyon", "2026-06-01", "2026-06-09"));
    store.segments.set("ma-0", segment("lyon", "ma-0", "ma", stay("Example Hotel One", "2026-06-01T15:00:00+02:00", "2026-06-03T11:00:00+02:00"), cancelled));
    store.segments.set("mb-0", segment("lyon", "mb-0", "mb", stay("Example Hotel Two", "2026-06-04T15:00:00+02:00", "2026-06-06T11:00:00+02:00"), cancelled));
    store.segments.set("mc-0", segment("lyon", "mc-0", "mc", stay("Example Hotel Three", "2026-06-07T15:00:00+02:00", "2026-06-09T11:00:00+02:00"), cancelled));
    await regroupTrips("u1", deps(store));
    expect(summary(store)).toMatchObject([{ start: "2026-06-01", end: "2026-06-09", segments: ["ma-0", "mb-0", "mc-0"] }]);
  });

  it("doesn't let a cancelled stay that seeds a group bridge two trips", async () => {
    const store = memoryStore();
    const stay = (title: string, city: string, country: string, start: string, end: string) => ({
      type: "lodging" as const,
      title,
      start,
      end,
      destination: { name: title, city, country },
    });
    store.trips.set("june", trip("june", "June", "2026-06-01", "2026-06-30"));
    // A month's stay, cancelled, filed first by its booked dates...
    store.segments.set("ma-0", segment("june", "ma-0", "ma", stay("Example Residence", "Lyon", "FR", "2026-06-01T15:00:00+02:00", "2026-06-30T11:00:00+02:00"), cancelled));
    // ...then two live stays weeks apart.
    store.segments.set("mb-0", segment("june", "mb-0", "mb", stay("Example Hotel Paris", "Paris", "FR", "2026-06-05T15:00:00+02:00", "2026-06-07T11:00:00+02:00")));
    store.segments.set("mc-0", segment("june", "mc-0", "mc", stay("Example Hotel Roma", "Rome", "IT", "2026-06-20T15:00:00+02:00", "2026-06-22T11:00:00+02:00")));
    await regroupTrips("u1", deps(store));
    const trips = summary(store);
    const paris = trips.find((t) => t.segments.includes("mb-0"))!;
    const rome = trips.find((t) => t.segments.includes("mc-0"))!;
    expect(paris).not.toBe(rome);
    // The cancelled month stays inside one trip's own dates, which show
    // only what is still booked.
    const shown = (id: string) => {
      const t = [...store.trips.values()].find((x) => x.id === store.segments.get(id)!.tripId)!;
      return { start: t.liveStart ?? t.start, end: t.liveEnd ?? t.end };
    };
    expect(shown("mb-0")).toEqual({ start: "2026-06-05", end: "2026-06-07" });
    expect(shown("mc-0")).toEqual({ start: "2026-06-20", end: "2026-06-22" });
    const holding = [...store.trips.values()].find((x) => x.id === store.segments.get("ma-0")!.tripId)!;
    expect(holding).toMatchObject({ start: "2026-06-01", end: "2026-06-30" });
  });

  it("files a cancelled day out beside live bookings without letting it count", async () => {
    const store = memoryStore();
    mayAsOneTrip(store);
    store.segments.set("m26-0", { ...store.segments.get("m26-0")!, ...cancelled });
    await regroupTrips("u1", deps(store));
    const liverpool = summary(store).find((t) => t.title === "Liverpool");
    expect(liverpool).toMatchObject({ start: "2026-05-23", end: "2026-05-25", segments: ["mtr-0", "mtr-1"] });
    // The cancelled booking is kept, in some trip, still cancelled.
    expect(store.segments.get("m26-0")).toMatchObject(cancelled);
    expect(store.segments.size).toBe(4);
  });
});

describe("regroupTrips", () => {
  it("splits days out at home from the trip away, each part shared as the trip was", async () => {
    const store = memoryStore();
    mayAsOneTrip(store);
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 3, deleted: 0, placed: 0 });
    expect(summary(store)).toEqual([
      { title: "Eva Ward's Stage Stars! Holiday Club", start: "2026-05-22", end: "2026-05-22", sharedWith: ["partner@example.com"], segments: ["m22-0"] },
      { title: "Liverpool", start: "2026-05-23", end: "2026-05-25", sharedWith: ["partner@example.com"], segments: ["mtr-0", "mtr-1"] },
      { title: "Stage Stars! Holiday Club - Day 1", start: "2026-05-26", end: "2026-05-26", sharedWith: ["partner@example.com"], segments: ["m26-0"] },
    ]);
    expect(store.trips.get("london")?.title).toBe("Liverpool");
    expect(store.segments.get("mtr-0")).toMatchObject({ tripId: "london", rating: 5, favorite: true, createdAt: at, updatedAt: at });
    expect(store.segments.size).toBe(4);
  });

  it("leaves a trip its owner marked cancelled as it is", async () => {
    const store = memoryStore();
    mayAsOneTrip(store);
    store.trips.set("london", { ...store.trips.get("london")!, cancelledAt: "2026-05-20T09:00:00Z" });
    for (const s of [...store.segments.values()]) store.segments.set(s.id, { ...s, cancelledAt: "2026-05-20T09:00:00Z", userCancelled: "trip" });
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
    expect(summary(store)).toEqual([
      { title: "London", start: "2026-05-22", end: "2026-05-29", sharedWith: ["partner@example.com"], segments: ["m22-0", "m26-0", "mtr-0", "mtr-1"] },
    ]);
  });

  it("changes nothing the second time", async () => {
    const store = memoryStore();
    mayAsOneTrip(store);
    await regroupTrips("u1", deps(store));
    const before = summary(store);
    const trips = new Map(store.trips);
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
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

  it("renames a day camp still named for its venue after the camp", async () => {
    const store = memoryStore();
    store.trips.set("camp", trip("camp", "Weston Park School", "2025-08-11", "2025-08-15"));
    for (const d of [11, 12, 13, 14, 15]) {
      store.segments.set(
        `c-${d}`,
        segment("camp", `c-${d}`, "c", {
          type: "activity",
          title: `Debutots Camp - ${d}th Aug 2025`,
          start: `2025-08-${d}T10:00:00+01:00`,
          end: `2025-08-${d}T15:00:00+01:00`,
          destination: { name: "Weston Park School", address: "Denton Road, Hornsey, London, N8 9WP", country: "GB" },
        }),
      );
    }
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 1, deleted: 0, placed: 0 });
    expect(store.trips.get("camp")?.title).toBe("Debutots Camp");
    store.trips.set("camp", { ...store.trips.get("camp")!, title: "Summer camp" });
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
    expect(store.trips.get("camp")?.title).toBe("Summer camp");
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
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 1, deleted: 1, placed: 0 });
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
    expect(await regroupTrips("u1", deps(store), 4)).toEqual({ changed: 2, deleted: 2, placed: 0 });
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
      // Regrouping's own passes, not placing the bookings before them.
      if (result && typeof result === "object" && "changedTrips" in result) firstPass ??= store.trips.get("london");
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
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
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
      expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
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
    expect(await regroupTrips("u1", deps(store), 6)).toEqual({ changed: 2, deleted: 0, placed: 0 });
    const where = (prefix: string) => [...store.segments.values()].filter((s) => s.id.startsWith(prefix)).map((s) => s.tripId);
    expect(new Set(where("a1-"))).toEqual(new Set(["a"]));
    expect(new Set([...where("a10-"), ...where("b10-")])).toEqual(new Set(["b"]));
    expect(store.trips.get("a")).toMatchObject({ start: "2026-05-01", end: "2026-05-01" });
    expect(await regroupTrips("u1", deps(store), 6)).toEqual({ changed: 0, deleted: 0, placed: 0 });
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
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
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

  it("splits a dinner, a show and a train home two days later into a trip each", async () => {
    const store = memoryStore();
    store.trips.set("fulham", trip("fulham", "Fulham Kitchen", "2025-06-27", "2025-06-29"));
    const put = (id: string, extracted: ExtractedSegment) => store.segments.set(id, segment("fulham", id, id.replace(/-\d+$/, ""), extracted));
    put("dinner-0", {
      type: "other",
      title: "Fulham Kitchen",
      provider: "TheFork",
      confirmation: "TF000001",
      start: "2025-06-27T18:00:00+01:00",
      destination: { ...gb("Fulham Kitchen", "London"), address: "Munster Road, London SW6" },
    });
    put("show-0", {
      type: "activity",
      title: "TREVOR NOAH: LONDON 2025 ALL NEW MATERIAL",
      provider: "Ticketmaster",
      confirmation: "TM-0000-0001",
      start: "2025-06-27T20:00:00+01:00",
      destination: gb("London", "London"),
    });
    put("train-0", {
      type: "train",
      title: "Southampton Central to London Waterloo",
      provider: "South Western Railway",
      confirmation: "SWR00001",
      start: "2025-06-29T11:25:00+01:00",
      end: "2025-06-29T12:49:00+01:00",
      origin: gb("Southampton Central", "Southampton"),
      destination: gb("London Waterloo", "London"),
    });
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 3, deleted: 0, placed: 0 });
    expect(summary(store).map((t) => [t.start, t.end, t.segments])).toEqual([
      ["2025-06-27", "2025-06-27", ["dinner-0"]],
      ["2025-06-27", "2025-06-27", ["show-0"]],
      ["2025-06-29", "2025-06-29", ["train-0"]],
    ]);
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
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
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
  });
});

describe("regroupTrips with a trip named for a stay with no town", () => {
  const melbourne = { name: "Melbourne", code: "MEL", city: "Melbourne", country: "AU" };
  const adelaide = { name: "Adelaide", code: "ADL", city: "Adelaide", country: "AU" };
  const put = (store: Memory, s: Segment) => store.segments.set(s.id, s);
  const fill = (store: Memory, title: string) => {
    store.trips.set("mel", trip("mel", title, "2025-12-26", "2025-12-30"));
    put(
      store,
      segment("mel", "t-0", "t", {
        type: "lodging",
        title: "Designer Collingwood Terrace",
        provider: "Airbnb",
        confirmation: "HMEXAMPLE02",
        start: "2025-12-27T15:00:00+11:00",
        end: "2025-12-30T10:00:00+11:00",
        destination: { name: "Designer Collingwood Terrace" },
      }),
    );
    put(
      store,
      segment("mel", "f-0", "f", {
        type: "flight",
        title: "VA 234",
        start: "2025-12-26T16:50:00+10:30",
        end: "2025-12-26T18:40:00+11:00",
        origin: adelaide,
        destination: melbourne,
      }),
    );
  };

  it("names it after the town the trip goes to", async () => {
    const store = memoryStore();
    fill(store, "Designer Collingwood Terrace");
    // The flight's airports gain their spots from the table first.
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 1, deleted: 0, placed: 1 });
    expect(store.trips.get("mel")?.title).toBe("Melbourne");
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
  });

  it("names it after the town once the stay's place has since gained one", async () => {
    const store = memoryStore();
    fill(store, "Designer Collingwood Terrace");
    const stay = store.segments.get("t-0")!;
    store.segments.set("t-0", { ...stay, destination: { name: "Designer Collingwood Terrace", city: "Collingwood", country: "AU" } });
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 1, deleted: 0, placed: 1 });
    expect(store.trips.get("mel")?.title).toBe("Melbourne");
  });

  it("names it after the city an airport given only by its code serves", async () => {
    const store = memoryStore();
    store.trips.set("arn", trip("arn", "ARN", "2026-08-15", "2026-08-18"));
    const stn = { name: "London Stansted", code: "STN", city: "London", country: "GB" };
    const put = (s: Segment) => store.segments.set(s.id, s);
    put(segment("arn", "fr-0", "fr", { type: "flight", title: "FR 1401", start: "2026-08-15T13:55:00+01:00", end: "2026-08-15T17:15:00+02:00", origin: stn, destination: { name: "ARN", code: "ARN" } }));
    put(segment("arn", "fr-1", "fr", { type: "flight", title: "FR 1402", start: "2026-08-18T18:00:00+02:00", end: "2026-08-18T19:20:00+01:00", origin: { name: "ARN", code: "ARN" }, destination: stn }));
    await regroupTrips("u1", deps(store));
    expect(store.trips.get("arn")?.title).toBe("Stockholm");
    expect(store.segments.get("fr-0")?.destination).toMatchObject({ name: "ARN", code: "ARN", city: "Stockholm", country: "SE" });
  });

  it("keeps a name the user gave it", async () => {
    const store = memoryStore();
    fill(store, "Christmas away");
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 1 });
    expect(store.trips.get("mel")?.title).toBe("Christmas away");
  });
});

describe("regroupTrips after a journey home", () => {
  it("splits a trip home and the next one away, and a weekly class into its days", async () => {
    const store = memoryStore();
    store.trips.set("summer", trip("summer", "Stockholm", "2026-08-15", "2026-09-05"));
    const stn = { name: "London Stansted", code: "STN", city: "London", country: "GB" };
    const lhr = { name: "London Heathrow", code: "LHR", city: "London", country: "GB" };
    const arn = { name: "Stockholm Arlanda", code: "ARN", city: "Stockholm", country: "SE" };
    const bos = { name: "Boston Logan", code: "BOS", city: "Boston", country: "US" };
    const put = (s: Segment) => store.segments.set(s.id, s);
    put(segment("summer", "fr-0", "fr", { type: "flight", title: "FR1401", start: "2026-08-15T13:55:00+01:00", end: "2026-08-15T17:15:00+02:00", origin: stn, destination: arn }));
    put(segment("summer", "fr-1", "fr", { type: "flight", title: "FR1402", start: "2026-08-23T14:05:00+02:00", end: "2026-08-23T15:00:00+01:00", origin: arn, destination: stn }));
    put(segment("summer", "vs-0", "vs", { type: "flight", title: "VS157", start: "2026-08-25T16:05:00+01:00", end: "2026-08-25T18:50:00-04:00", origin: lhr, destination: bos }));
    put(segment("summer", "vs-1", "vs", { type: "flight", title: "VS158", start: "2026-09-04T21:30:00-04:00", end: "2026-09-05T09:15:00+01:00", origin: bos, destination: lhr }));
    store.trips.set("club", trip("club", "Example School", "2025-09-11", "2025-09-25"));
    for (const [i, d] of ["2025-09-11", "2025-09-18", "2025-09-25"].entries()) {
      put(segment("club", `dc-${i}`, "dc", { type: "activity", title: "Saturday Drama Club", start: `${d}T12:30:00+01:00`, end: `${d}T13:30:00+01:00`, destination: academy }));
    }
    // A calendar event's stay in one trip, as its record names one.
    store.trips.set("cal", trip("cal", "Example School", "2025-10-04", "2025-10-11"));
    for (const [i, d] of ["2025-10-04", "2025-10-11"].entries()) {
      put(segment("cal", `ev-${i}`, "ev", { type: "activity", title: "Saturday Drama Club", start: `${d}T12:30:00+01:00`, end: `${d}T13:30:00+01:00`, destination: academy }, { source: "ics", gmailMessageIds: [], sources: [{ kind: "ics", id: "ev", uid: "u1", at }] }));
    }
    await regroupTrips("u1", deps(store));
    expect(summary(store).map((t) => [t.start, t.end, t.segments])).toEqual([
      ["2025-09-11", "2025-09-11", ["dc-0"]],
      ["2025-09-18", "2025-09-18", ["dc-1"]],
      ["2025-09-25", "2025-09-25", ["dc-2"]],
      ["2025-10-04", "2025-10-11", ["ev-0", "ev-1"]],
      ["2026-08-15", "2026-08-23", ["fr-0", "fr-1"]],
      ["2026-08-25", "2026-09-05", ["vs-0", "vs-1"]],
    ]);
  });
});

describe("regroupTrips placing bookings", () => {
  it("first gives bookings the country their unambiguous city has, leaving their revision", async () => {
    const store = memoryStore();
    store.trips.set("liverpool", trip("liverpool", "Liverpool", "2026-05-23", "2026-05-25"));
    const train = segment("liverpool", "t-0", "t", {
      type: "train",
      title: "London Euston to Liverpool Lime Street",
      start: "2026-05-23T12:07:00+01:00",
      end: "2026-05-23T14:23:00+01:00",
      origin: { name: "London Euston", city: "London" },
      destination: { name: "Liverpool Lime Street", city: "Liverpool" },
    });
    const typed = segment("liverpool", "h-0", "h", { type: "lodging", title: "Cove", start: "2026-05-23T15:00:00+01:00", end: "2026-05-25T11:00:00+01:00", destination: { name: "Cove", city: "Liverpool" } }, { source: "manual" });
    store.segments.set(train.id, train);
    store.segments.set(typed.id, typed);
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 1 });
    expect(store.segments.get("t-0")).toMatchObject({ origin: { country: "GB" }, destination: { country: "GB" }, updatedAt: at });
    // A hand-entered booking stays as its author wrote it.
    expect(store.segments.get("h-0")?.destination?.country).toBeUndefined();
    expect(await regroupTrips("u1", deps(store))).toEqual({ changed: 0, deleted: 0, placed: 0 });
  });
});

describe("a flight that lands where the next trip leaves from", () => {
  const lhr = { name: "Heathrow", code: "LHR", city: "London", country: "GB" };
  const zag = { name: "Zagreb", code: "ZAG", city: "Zagreb", country: "HR" };
  const cdg = { name: "Paris Charles de Gaulle", code: "CDG", city: "Paris", country: "FR" };
  const jfk = { name: "JFK", code: "JFK", city: "New York", country: "US" };
  const ewr = { name: "Newark", code: "EWR", city: "New York/Newark", country: "US" };

  it("opens the trip there, named for where it goes, not its connection", async () => {
    const store = memoryStore();
    store.trips.set("zagreb", trip("zagreb", "Zagreb", "2026-03-30", "2026-04-04"));
    store.trips.set("newark", trip("newark", "New York/Newark", "2026-04-11", "2026-04-11"));
    const put = (s: Segment) => store.segments.set(s.id, s);
    put(segment("zagreb", "out", "m1", { type: "flight", title: "LHR to ZAG", start: "2026-03-30T08:00:00+01:00", end: "2026-03-30T11:00:00+02:00", origin: lhr, destination: zag }));
    put(segment("zagreb", "stay", "m2", { type: "lodging", title: "Apartments Angel", start: "2026-03-30T15:00:00+02:00", end: "2026-04-04T11:00:00+02:00", destination: { name: "Apartments Angel", city: "Zagreb", country: "HR" } }));
    put(segment("zagreb", "leg1", "m3", { type: "flight", title: "A5 8362 ZAG to PAR", start: "2026-04-04T16:00:00+02:00", end: "2026-04-04T18:15:00+02:00", origin: zag, destination: cdg }));
    put(segment("zagreb", "leg2", "m3", { type: "flight", title: "AF 8702 PAR to JFK", start: "2026-04-04T20:30:00+02:00", end: "2026-04-04T22:40:00-04:00", origin: cdg, destination: jfk }));
    put(segment("newark", "home", "m4", { type: "flight", title: "UA122 EWR to LHR", start: "2026-04-11T09:10:00-04:00", end: "2026-04-11T21:25:00+01:00", origin: ewr, destination: lhr }));
    await regroupTrips("u1", deps(store));
    expect(summary(store).map(({ title, start, end, segments }) => ({ title, start, end, segments }))).toEqual([
      { title: "Zagreb", start: "2026-03-30", end: "2026-04-04", segments: ["out", "stay"] },
      { title: "New York", start: "2026-04-04", end: "2026-04-11", segments: ["home", "leg1", "leg2"] },
    ]);
  });

  it("stays put when its leg to there was cancelled", async () => {
    const store = memoryStore();
    store.trips.set("zagreb", trip("zagreb", "Zagreb", "2026-03-30", "2026-04-04"));
    store.trips.set("newark", trip("newark", "New York/Newark", "2026-04-11", "2026-04-11"));
    const put = (s: Segment) => store.segments.set(s.id, s);
    put(segment("zagreb", "out", "m1", { type: "flight", title: "LHR to ZAG", start: "2026-03-30T08:00:00+01:00", end: "2026-03-30T11:00:00+02:00", origin: lhr, destination: zag }));
    put(segment("zagreb", "stay", "m2", { type: "lodging", title: "Apartments Angel", start: "2026-03-30T15:00:00+02:00", end: "2026-04-04T11:00:00+02:00", destination: { name: "Apartments Angel", city: "Zagreb", country: "HR" } }));
    put(segment("zagreb", "leg1", "m3", { type: "flight", title: "A5 8362 ZAG to PAR", start: "2026-04-04T16:00:00+02:00", end: "2026-04-04T18:15:00+02:00", origin: zag, destination: cdg }));
    put(segment("zagreb", "leg2", "m3", { type: "flight", title: "AF 8702 PAR to JFK", start: "2026-04-04T20:30:00+02:00", end: "2026-04-04T22:40:00-04:00", origin: cdg, destination: jfk }, { cancelledAt: at, cancelledBy: "m5" }));
    put(segment("newark", "home", "m4", { type: "flight", title: "UA122 EWR to LHR", start: "2026-04-11T09:10:00-04:00", end: "2026-04-11T21:25:00+01:00", origin: ewr, destination: lhr }));
    await regroupTrips("u1", deps(store));
    expect(summary(store).map((t) => t.segments)).toEqual([["leg1", "leg2", "out", "stay"], ["home"]]);
  });
});

// Home corrected to Mountain View while every trip flew from SFO: a homecoming
// there never ended a trip, so trips two days apart ran together for months.
describe("regroupTrips with home's airports", () => {
  const sfo = { name: "San Francisco International", code: "SFO", city: "San Francisco", country: "US" };
  const bos = { name: "Boston Logan", code: "BOS", city: "Boston", country: "US" };
  const sea = { name: "Seattle-Tacoma", code: "SEA", city: "Seattle", country: "US" };
  const flight = (id: string, source: string, start: string, origin: typeof sfo, destination: typeof sfo) =>
    segment("chain", id, source, { type: "flight", title: `${origin.code} to ${destination.code}`, start, origin, destination });
  const corrections = [{ city: "Mountain View", country: "US", from: "2011-01-01" }];

  it("ends a trip at a flight home into the airport its round trips leave from", async () => {
    const store = memoryStore();
    store.trips.set("chain", trip("chain", "Boston", "2021-11-22", "2021-12-06"));
    for (const s of [
      flight("b-out", "mb", "2021-11-22T08:00:00-08:00", sfo, bos),
      flight("b-back", "mb", "2021-12-01T13:00:00-05:00", bos, sfo),
      flight("s-out", "ms", "2021-12-03T08:00:00-08:00", sfo, sea),
      flight("s-back", "ms", "2021-12-06T18:00:00-08:00", sea, sfo),
    ])
      store.segments.set(s.id, s);
    await regroupTrips("u1", { ...deps(store), homeOverrides: async () => homeCorrections(corrections) });
    expect(summary(store).map((t) => t.segments)).toEqual([["b-back", "b-out"], ["s-back", "s-out"]]);
  });

  it("ends a trip at an airport the person chose for home, though no two round trips leave from it", async () => {
    const sjc = { name: "San Jose", code: "SJC", city: "San Jose", country: "US" };
    const store = memoryStore();
    store.trips.set("chain", trip("chain", "Boston", "2021-11-22", "2021-12-06"));
    for (const s of [
      flight("b-out", "mb", "2021-11-22T08:00:00-08:00", sjc, bos),
      flight("b-back", "mb", "2021-12-01T13:00:00-05:00", bos, sjc),
      flight("s-out", "ms", "2021-12-03T08:00:00-08:00", sjc, sea),
      flight("s-back", "ms", "2021-12-06T18:00:00-08:00", sea, sjc),
    ])
      store.segments.set(s.id, s);
    const chosen = [{ city: "Mountain View", country: "US", airports: ["SJC"] }];
    // Two round trips from SJC would find it; with one each way, only the choice does.
    store.segments.delete("s-back");
    await regroupTrips("u1", { ...deps(store), homeOverrides: async () => homeCorrections(corrections), chosenHomeAirports: async () => chosen });
    expect(summary(store).map((t) => t.segments)).toEqual([["b-back", "b-out"], ["s-out"]]);
  });
});

// Invented flats and a week away, shaped like a winter in London.
describe("regrouping with a long stay", () => {
  const flat = (id: string, source: string, start: string, end: string, city = "London", country = "GB"): Segment =>
    segment("all", id, source, { type: "lodging", title: `${city} flat`, start: `${start}T15:00:00+00:00`, end: `${end}T11:00:00+00:00`, destination: { name: `${city} flat`, city, country } });

  const winter = (store: Memory) => {
    store.trips.set("all", trip("all", "London", "2022-02-13", "2022-03-20"));
    for (const s of [flat("f1", "m1", "2022-02-13", "2022-02-27"), flat("f2", "m2", "2022-02-27", "2022-03-20"), flat("villa", "m3", "2022-03-08", "2022-03-15", "Albufeira", "PT")])
      store.segments.set(s.id, s);
  };

  it("keeps a week away out of a month lived in", async () => {
    const store = memoryStore();
    winter(store);
    await regroupTrips("u1", deps(store));
    expect(summary(store).map((t) => t.segments)).toEqual([["f1", "f2"], ["villa"]]);
  });

  it("treats a stay said not to be home as an ordinary trip", async () => {
    const store = memoryStore();
    winter(store);
    await regroupTrips("u1", { ...deps(store), notHome: async () => [{ city: "London", country: "GB", from: "2022-02-13" }] });
    expect(summary(store).map((t) => t.segments)).toEqual([["f1", "f2", "villa"]]);
  });

  it("splits a month away from the stays at home it overlaps, and names a trip by where it went before flying home", async () => {
    const store = memoryStore();
    store.trips.set("all", trip("all", "Boston", "2021-11-30", "2022-03-20"));
    const city = (name: string) => ({ name, city: name, country: "US" });
    for (const s of [
      segment("all", "hotel", "m4", { type: "lodging", title: "Boston Hotel", start: "2021-11-30T16:00:00-05:00", end: "2021-12-01T11:00:00-05:00", destination: city("Boston") }),
      segment("all", "out", "m5", { type: "flight", title: "Delta", start: "2021-12-01T13:00:00-05:00", end: "2021-12-01T18:56:00-08:00", origin: city("Boston"), destination: city("San Francisco") }),
      flat("sunnyvale", "m6", "2021-12-05", "2022-01-29", "Sunnyvale", "US"),
      flat("l1", "m7", "2022-01-15", "2022-02-13"),
      flat("l2", "m8", "2022-02-13", "2022-03-20"),
    ])
      store.segments.set(s.id, s);
    await regroupTrips("u1", {
      ...deps(store),
      homeOverrides: async () => homeCorrections([{ city: "Mountain View", country: "US", from: "2011-01-01" }]),
      chosenHomeAirports: async () => [{ city: "Mountain View", country: "US", airports: ["SFO"] }],
    });
    expect(summary(store).map((t) => [t.title, t.segments])).toEqual([
      ["Boston", ["hotel", "out"]],
      ["Sunnyvale", ["sunnyvale"]],
      ["London", ["l1", "l2"]],
    ]);
  });
});
