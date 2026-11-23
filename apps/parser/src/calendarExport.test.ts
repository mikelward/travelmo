import type { Segment, Trip } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { calendarForToken, hashToken, newToken, validToken, type ExportIo } from "./calendarExport";

const trip = (id: string, extra: Partial<Trip> = {}): Trip => ({
  id,
  title: `Trip ${id}`,
  start: "2026-12-12",
  end: "2026-12-14",
  ownerUid: "u1",
  sharedWith: [],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...extra,
});

const segment: Segment = {
  id: "s1",
  tripId: "a",
  type: "flight",
  title: "XX 100 MAN to DXB",
  start: "2026-12-13T09:00:00+00:00",
  end: "2026-12-13T19:00:00+04:00",
  source: "manual",
  gmailMessageIds: [],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

function io(token: string, calls: string[] = [], approved = true): ExportIo {
  return {
    uidForToken: async (h) => (h === hashToken(token) ? "u1" : undefined),
    approved: async (uid) => uid === "u1" && approved,
    addresses: async () => ["me@example.com", "work@company.example"],
    trips: async (uid, addresses, since) => {
      calls.push(`${uid} ${addresses.join(",")} ${since}`);
      return [trip("a"), trip("gone", { deleting: true })];
    },
    segments: async (id) => (id === "a" ? [segment] : []),
  };
}

const options = { now: "2026-11-01T12:00:00Z", tripUrl: (id: string) => `https://travelmo.example/trips/${id}` };

describe("calendarForToken", () => {
  it("serves the trips of the link's owner and those shared with them, from a year back", async () => {
    const token = newToken();
    const calls: string[] = [];
    const text = await calendarForToken(token, io(token, calls), options);
    expect(calls).toEqual(["u1 me@example.com,work@company.example 2025-11-01"]);
    expect(text).toContain("SUMMARY:Trip a");
    expect(text).toContain("SUMMARY:XX 100 MAN to DXB");
    expect(text).not.toContain("Trip gone");
  });

  it("serves nothing for a link that is nobody's or malformed", async () => {
    const token = newToken();
    expect(await calendarForToken(newToken(), io(token), options)).toBeUndefined();
    expect(await calendarForToken("../x", io(token), options)).toBeUndefined();
  });

  it("serves nothing, as for an unknown link, once the owner's access is revoked", async () => {
    const token = newToken();
    const calls: string[] = [];
    expect(await calendarForToken(token, io(token, calls, false), options)).toBeUndefined();
    // Not a single trip is read for them.
    expect(calls).toEqual([]);
  });

  it("issues tokens that pass its own check and differ each time", () => {
    const a = newToken();
    expect(validToken(a)).toBe(true);
    expect(a).not.toBe(newToken());
  });
});
