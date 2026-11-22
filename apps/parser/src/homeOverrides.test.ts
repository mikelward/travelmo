import { paths, type ExtractedSegment } from "@travelmo/core";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import { loadHomeOverrides } from "./homeOverrides";
import { fileBooking, type ImportDeps } from "./importer";
import { memoryStore, type Memory } from "./testStore";

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
const app = getApps()[0] ?? initializeApp({ projectId: "demo-travelmo" });
const db = getFirestore(app);

describe("loadHomeOverrides", () => {
  it("reads the user's corrections as periods", async () => {
    await db.doc(paths.user("home-u1")).set({
      homes: [
        { city: "London", country: "GB", from: "2021-03-12" },
        { city: "Boston", country: "US", from: "2018-09-01" },
      ],
    });
    expect(await loadHomeOverrides(db, "home-u1", () => {})).toEqual([
      { city: "Boston", country: "US", from: "2018-09-01", until: "2021-03-11" },
      { city: "London", country: "GB", from: "2021-03-12" },
    ]);
  });

  it("has none for a user who made none", async () => {
    await db.doc(paths.user("home-u2")).set({ email: "someone@example.com" });
    expect(await loadHomeOverrides(db, "home-u2", () => {})).toEqual([]);
    expect(await loadHomeOverrides(db, "home-nobody", () => {})).toEqual([]);
  });

  it("logs and ignores a list that does not parse", async () => {
    await db.doc(paths.user("home-u3")).set({ homes: [{ city: "", from: "soon" }] });
    const log = vi.fn();
    expect(await loadHomeOverrides(db, "home-u3", log)).toEqual([]);
    expect(log).toHaveBeenCalledWith("home_overrides_malformed", expect.objectContaining({ uid: "home-u3" }));
  });
});

describe("an import with home corrected", () => {
  const academy = { name: "Fixation Academy of Performing Arts", city: "London", country: "GB" };
  const club: ExtractedSegment = { type: "activity", title: "Holiday Club", start: "2026-05-22T09:00:00+01:00", destination: academy };
  const out: ExtractedSegment = {
    type: "train",
    title: "Out",
    start: "2026-05-23T12:07:00+01:00",
    origin: { name: "London Euston", city: "London", country: "GB" },
    destination: { name: "Liverpool Lime Street", city: "Liverpool", country: "GB" },
  };
  const deps = (store: Memory, homeOverrides?: ImportDeps["homeOverrides"]): ImportDeps => ({
    store,
    extract: async () => ({ isBooking: false, segments: [] }),
    ...(homeOverrides ? { homeOverrides } : {}),
    now: () => "2026-11-01T12:00:00Z",
    log: () => {},
  });

  it("keeps a day out at home apart from a one-way trip, which only the correction says is away", async () => {
    const corrected = memoryStore();
    const london = async () => [{ city: "London", country: "GB", from: "2020-01-01" }];
    await fileBooking("u1", { sourceId: "club", source: "gmail", segments: [club] }, deps(corrected, london));
    await fileBooking("u1", { sourceId: "out", source: "gmail", segments: [out] }, deps(corrected, london));
    expect([...corrected.trips.values()].map((t) => t.title).sort()).toEqual(["Holiday Club", "Liverpool"]);

    // Without it, a single outbound says nothing about home, and the two
    // stay apart all the same: an outing joins travel only in a town the
    // travel goes to.
    const plain = memoryStore();
    await fileBooking("u1", { sourceId: "club", source: "gmail", segments: [club] }, deps(plain));
    await fileBooking("u1", { sourceId: "out", source: "gmail", segments: [out] }, deps(plain));
    expect([...plain.trips.values()].map((t) => t.title).sort()).toEqual(["Holiday Club", "Liverpool"]);
  });
});
