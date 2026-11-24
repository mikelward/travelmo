import { describe, expect, it } from "vitest";
import { CheckedIn, flightCheckInState, maxCheckedIn, withCheckedIn } from "./checkedIn";

// An invented flight leaving Manchester at 09:00 Dubai time (04:00Z); its
// online check-in usually opens a day before.
const flight = { id: "f1", type: "flight" as const, title: "XX 100 MAN to DXB", start: "2026-12-13T09:00:00+05:00" };

describe("withCheckedIn", () => {
  it("marks a booking once and unmarks it", () => {
    expect(withCheckedIn([], "f1", true)).toEqual(["f1"]);
    expect(withCheckedIn(["f1", "f2"], "f1", true)).toEqual(["f2", "f1"]);
    expect(withCheckedIn(["f1", "f2"], "f1", false)).toEqual(["f2"]);
    expect(withCheckedIn(["f2"], "f1", false)).toEqual(["f2"]);
  });

  it("keeps the newest within the limit", () => {
    const full = Array.from({ length: maxCheckedIn }, (_, i) => `f${i}`);
    const marked = withCheckedIn(full, "new", true);
    expect(marked).toHaveLength(maxCheckedIn);
    expect(marked.at(-1)).toBe("new");
    expect(marked).not.toContain("f0");
  });
});

describe("CheckedIn", () => {
  it("leaves out an id that is not one", () => {
    expect(CheckedIn.parse({ segmentIds: ["f1", 3, ""], updatedAt: "2026-12-12T00:00:00Z" })).toEqual({ segmentIds: ["f1"], updatedAt: "2026-12-12T00:00:00Z" });
    expect(CheckedIn.parse({})).toEqual({ segmentIds: [] });
  });
});

describe("flightCheckInState", () => {
  it("offers the mark from when check-in opens until departure, then says it is done until departure", () => {
    expect(flightCheckInState(flight, new Set(), "2026-12-12T03:59:00Z")).toBeUndefined();
    expect(flightCheckInState(flight, new Set(), "2026-12-12T04:00:00Z")).toBe("offer");
    expect(flightCheckInState(flight, new Set(["f1"]), "2026-12-12T04:00:00Z")).toBe("done");
    expect(flightCheckInState(flight, new Set(["f1"]), "2026-12-13T04:00:00Z")).toBeUndefined();
    expect(flightCheckInState(flight, new Set(), "2026-12-13T04:00:00Z")).toBeUndefined();
  });

  it("offers nothing for anything but a flight, or a cancelled one", () => {
    expect(flightCheckInState({ ...flight, type: "train" }, new Set(), "2026-12-12T12:00:00Z")).toBeUndefined();
    expect(flightCheckInState({ ...flight, cancelledAt: "2026-12-01T00:00:00Z" }, new Set(), "2026-12-12T12:00:00Z")).toBeUndefined();
  });
});
