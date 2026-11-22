import type { ParsedMessage, Segment, Trip } from "@travelmo/core";
import { changeClaimable, claimable, reclaimable, retryable, type TripStore, type TripTx } from "./importer";
import { addExample, emptyExamples, type Examples } from "./similarity";

// An in-memory TripStore for the pipeline's tests: the same contract as the
// Firestore one, with per-user serialization by promise chaining.
export type Memory = TripStore & {
  trips: Map<string, Trip>;
  segments: Map<string, Segment>;
  parsed: Map<string, ParsedMessage>;
  examplesOf: Map<string, Examples>;
};

export function memoryStore(): Memory {
  const trips = new Map<string, Trip>();
  const segments = new Map<string, Segment>();
  const parsed = new Map<string, ParsedMessage>();
  const examplesOf = new Map<string, Examples>();
  const locks = new Map<string, Promise<unknown>>();
  const generations = new Map<string, number>();
  let ids = 0;
  const tx: Omit<TripTx, "listParsedIds" | "deleteParsed" | "generation" | "bumpGeneration" | "hasGmail" | "clearBackfill"> = {
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
    getSegment: async (tripId, id) => {
      const s = segments.get(id);
      return s?.tripId === tripId ? s : undefined;
    },
    deleteSegment: (_tripId, id) => void segments.delete(id),
    putParsed: (r) => void parsed.set(`${r.uid}/${r.messageId}`, r),
    touchTrip: (id, updatedAt) => {
      const trip = trips.get(id);
      if (trip) trips.set(id, { ...trip, updatedAt });
    },
    updateTrip: (id, fields) => {
      const trip = trips.get(id);
      if (!trip) throw new Error(`trip ${id} missing`);
      trips.set(id, { ...trip, ...fields });
    },
    deleteTrip: (id) => void trips.delete(id),
    addSource: (_tripId, id, source) => {
      const s = segments.get(id);
      if (!s) throw new Error(`segment ${id} missing`);
      if (!(s.sources ?? []).some((r) => r.kind === source.kind && r.id === source.id)) segments.set(id, { ...s, sources: [...(s.sources ?? []), source] });
    },
  };
  return {
    trips,
    segments,
    parsed,
    examplesOf,
    examples: async (uid) => examplesOf.get(uid) ?? emptyExamples(),
    saveExample: async (uid, label, example) => {
      examplesOf.set(uid, addExample(examplesOf.get(uid) ?? emptyExamples(), label, example));
    },
    claimMessage: async (uid, id, processedAt, generation) => {
      const key = `${uid}/${id}`;
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return false;
      if (!claimable(parsed.get(key), processedAt)) return false;
      parsed.set(key, { messageId: id, uid, outcome: "processing", segmentIds: [], processedAt });
      return true;
    },
    reclaimMessage: async (uid, id, processedAt, generation) => {
      const key = `${uid}/${id}`;
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return false;
      if (!reclaimable(parsed.get(key), processedAt)) return false;
      parsed.set(key, { messageId: id, uid, outcome: "processing", segmentIds: [], processedAt });
      return true;
    },
    retryMessage: async (uid, id, processedAt, generation) => {
      const key = `${uid}/${id}`;
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return false;
      if (!retryable(parsed.get(key), processedAt)) return false;
      parsed.set(key, { messageId: id, uid, outcome: "processing", segmentIds: [], processedAt });
      return true;
    },
    claimChange: async (uid, id, processedAt, expected, generation) => {
      const key = `${uid}/${id}`;
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return false;
      const existing = parsed.get(key);
      if (!changeClaimable(existing, expected, processedAt)) return false;
      parsed.set(key, { ...existing!, outcome: "processing", processedAt });
      return true;
    },
    replaceIfUnchanged: async (uid, expected, next, now, generation) => {
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return false;
      if (!changeClaimable(parsed.get(`${uid}/${expected.messageId}`), expected, now)) return false;
      parsed.set(`${uid}/${expected.messageId}`, next);
      return true;
    },
    setParsed: async (r) => void parsed.set(`${r.uid}/${r.messageId}`, r),
    getParsed: async (uid, id) => parsed.get(`${uid}/${id}`),
    readSegment: async (tripId, id) => tx.getSegment(tripId, id),
    listUserSegments: async (uid) => {
      const mine = new Set([...trips.values()].filter((trip) => trip.ownerUid === uid && !trip.deleting).map((trip) => trip.id));
      return [...segments.values()].filter((segment) => mine.has(segment.tripId));
    },
    resetGeneration: async (uid) => generations.get(uid) ?? 0,
    setParsedIfCurrent: async (record, generation) => {
      if ((generations.get(record.uid) ?? 0) !== generation) return false;
      parsed.set(`${record.uid}/${record.messageId}`, record);
      return true;
    },
    withUserLock: (uid, fn) => {
      const forUser: TripTx = {
        ...tx,
        generation: generations.get(uid) ?? 0,
        bumpGeneration: () => void generations.set(uid, (generations.get(uid) ?? 0) + 1),
        hasGmail: async () => false,
        clearBackfill: () => {},
        listParsedIds: async (limit) =>
          [...parsed.keys()].filter((k) => k.startsWith(`${uid}/`)).slice(0, limit).map((k) => k.slice(uid.length + 1)),
        deleteParsed: (id) => void parsed.delete(`${uid}/${id}`),
      };
      const run = (locks.get(uid) ?? Promise.resolve()).then(() => fn(forUser));
      locks.set(uid, run.catch(() => undefined));
      return run;
    },
    senderPatterns: async () => ({ allow: [], deny: [] }),
    newId: () => `trip${++ids}`,
  };
}

