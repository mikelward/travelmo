import { z } from "zod";
import type { TravelReport } from "./reports";

// Reports' counts and map for every year as last worked out, kept in the
// browser (localStorage; Android keeps its own) so the next visit
// draws them at once, before the bookings have answered (SPEC "Reports").
// `uid` says whose they are: another account signed in on the same device
// never sees them.

const Report = z.object({
  trips: z.number(),
  days: z.number(),
  countries: z.array(z.object({ country: z.string(), days: z.number(), trips: z.number(), tripIds: z.array(z.string()) })),
  years: z.array(z.object({ year: z.string(), trips: z.number(), days: z.number(), countries: z.number() })),
  airports: z.array(z.object({ code: z.string(), country: z.string(), lat: z.number(), lon: z.number() })),
  places: z.array(z.object({ name: z.string(), city: z.string().optional(), country: z.string().optional(), lat: z.number(), lon: z.number() })),
  unknownDays: z.number(),
  unplaced: z.number(),
  upcoming: z.number(),
});

const Snapshot = z.object({ uid: z.string(), report: Report });

// `report` as `uid`'s snapshot, to keep.
export function encodeReportSnapshot(uid: string, report: TravelReport): string {
  return JSON.stringify({ uid, report });
}

// The counts and map a snapshot holds when it is `uid`'s; undefined for
// another account's, or for none. Throws on text it can't read.
export function decodeReportSnapshot(text: string | null | undefined, uid: string): TravelReport | undefined {
  if (!text) return undefined;
  const snapshot = Snapshot.parse(JSON.parse(text));
  if (snapshot.uid !== uid) return undefined;
  const { places, ...rest } = snapshot.report;
  // A place with no city or country leaves the key out, as the report does.
  return { ...rest, places: places.map(({ city, country, ...p }) => ({ ...p, ...(city ? { city } : {}), ...(country ? { country } : {}) })) };
}
