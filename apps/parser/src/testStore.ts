import type { ParsedMessage, Segment, Trip } from "@travelmo/core";
import { claimable, reclaimable, type TripStore, type TripTx } from "./importer";
import { addExample, emptyExamples, type Examples } from "./similarity";

// An in-memory TripStore for tests: the same contract as the Firestore one,
// with its maps exposed for assertions.
export type Memory = TripStore & {
  trips: Map<string, Trip>;
  segments: Map<string, Segment>;
  parsed: Map<string, ParsedMessage>;
  examplesOf: Map<string, Examples>;
  // How many trip transactions ran.
  transactions: number;
};

export function memoryStore(): Memory {
  const trips = new Map<string, Trip>();
  const segments = new Map<string, Segment>();
  const parsed = new Map<string, ParsedMessage>();
  const examplesOf = new Map<string, Examples>();
  const locks = new Map<string, Promise<unknown>>();
  let ids = 0;
  const tx: TripTx = {
    listTrips: async () => [...trips.values()],
    listSegments: async (tripId) => [...segments.values()].filter((s) => s.tripId === tripId),
    createTrip: (t) => {
      if (trips.has(t.id)) throw new Error(`trip ${t.id} exists`);
      trips.set(t.id, t);
    },
    extendTrip: (id, bounds) => {
      const trip = trips.get(id);
      if (!trip) throw new Error(`trip ${id} missing`);
      trips.set(id, { ...trip, ...bounds });
    },
    putSegment: (s) => void segments.set(s.id, s),
  };
  const store: Memory = {
    trips,
    segments,
    parsed,
    examplesOf,
    transactions: 0,
    examples: async (uid) => examplesOf.get(uid) ?? emptyExamples(),
    saveExample: async (uid, label, example) => {
      examplesOf.set(uid, addExample(examplesOf.get(uid) ?? emptyExamples(), label, example));
    },
    claimMessage: async (uid, id, processedAt) => {
      const key = `${uid}/${id}`;
      if (!claimable(parsed.get(key), processedAt)) return false;
      parsed.set(key, { messageId: id, uid, outcome: "processing", segmentIds: [], processedAt });
      return true;
    },
    reclaimMessage: async (uid, id, processedAt) => {
      const key = `${uid}/${id}`;
      if (!reclaimable(parsed.get(key), processedAt)) return false;
      parsed.set(key, { messageId: id, uid, outcome: "processing", segmentIds: [], processedAt });
      return true;
    },
    setParsed: async (r) => void parsed.set(`${r.uid}/${r.messageId}`, r),
    parsedRecords: async (uid, ids) => {
      const found = new Map<string, ParsedMessage>();
      for (const id of ids) {
        const record = parsed.get(`${uid}/${id}`);
        if (record) found.set(id, record);
      }
      return found;
    },
    withUserLock: (uid, fn) => {
      store.transactions += 1;
      const run = (locks.get(uid) ?? Promise.resolve()).then(() => fn(tx));
      locks.set(uid, run.catch(() => undefined));
      return run;
    },
    userTrips: async (uid) => [...trips.values()].filter((t) => t.ownerUid === uid),
    tripSegments: async (tripId) => [...segments.values()].filter((s) => s.tripId === tripId),
    senderPatterns: async () => ({ allow: [], deny: [] }),
    newId: () => `trip${++ids}`,
  };
  return store;
}
