import { withFoundLoyalties, type FoundLoyalty, type ParsedMessage, type PendingCancellation, type PersonDoc, type Segment, type Trip } from "@travelmo/core";
import { changeClaimable, claimRecord, claimable, reclaimable, retryable, type TripStore, type TripTx } from "./importer";
import { addExample, emptyExamples, type Examples } from "./similarity";

// An in-memory TripStore for the pipeline's tests: the same contract as the
// Firestore one, with per-user serialization by promise chaining.
export type Memory = TripStore & {
  trips: Map<string, Trip>;
  segments: Map<string, Segment>;
  parsed: Map<string, ParsedMessage>;
  // What countSender added up, by sender domain.
  senderStats: Map<string, Record<string, number>>;
  examplesOf: Map<string, Examples>;
  // Keyed by "uid/messageId".
  pending: Map<string, PendingCancellation>;
  // Keyed by "uid/personId".
  people: Map<string, PersonDoc>;
  // Loyalty found in emails, and the name on each account, by uid.
  foundLoyalty: Map<string, FoundLoyalty[]>;
  ownerNames: Map<string, string>;
};

export function memoryStore(): Memory {
  const trips = new Map<string, Trip>();
  const segments = new Map<string, Segment>();
  const parsed = new Map<string, ParsedMessage>();
  const examplesOf = new Map<string, Examples>();
  const pending = new Map<string, PendingCancellation>();
  const people = new Map<string, PersonDoc>();
  const foundLoyalty = new Map<string, FoundLoyalty[]>();
  const ownerNames = new Map<string, string>();
  const locks = new Map<string, Promise<unknown>>();
  const generations = new Map<string, number>();
  const senderStats = new Map<string, Record<string, number>>();
  let ids = 0;
  const tx: Omit<TripTx, "listParsedIds" | "deleteParsed" | "generation" | "bumpGeneration" | "connectedMailboxes" | "clearBackfill"> = {
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
    touchTrip: (id, updatedAt, title) => {
      const trip = trips.get(id);
      // As Firestore's update: a trip that is gone fails the transaction.
      if (!trip) throw new Error(`trip ${id} missing`);
      trips.set(id, { ...trip, ...(title === undefined ? {} : { title }), updatedAt });
    },
    updateTrip: (id, fields) => {
      const trip = trips.get(id);
      if (!trip) throw new Error(`trip ${id} missing`);
      trips.set(id, { ...trip, ...fields });
    },
    setTripFlags: (id, flags) => {
      const trip = trips.get(id);
      if (!trip) throw new Error(`trip ${id} missing`);
      trips.set(id, { ...trip, ...flags });
    },
    setLiveBounds: (id, bounds) => {
      const trip = trips.get(id);
      if (!trip) throw new Error(`trip ${id} missing`);
      const { liveStart: _start, liveEnd: _end, ...rest } = trip;
      trips.set(id, bounds ? { ...rest, liveStart: bounds.start, liveEnd: bounds.end } : rest);
    },
    deleteTrip: (id) => void trips.delete(id),
    listPendingCancellations: async (uid) => [...pending.values()].filter((p) => p.uid === uid),
    listPeople: async (uid) => [...people.entries()].filter(([key]) => key.startsWith(`${uid}/`)).map(([, p]) => p),
    putPerson: (uid, person) => void people.set(`${uid}/${person.id}`, person),
    putPendingCancellation: (p) => void pending.set(`${p.uid}/${p.messageId}`, p),
    deletePendingCancellation: (uid, messageId) => void pending.delete(`${uid}/${messageId}`),
    addSource: (_tripId, id, source) => {
      const s = segments.get(id);
      if (!s) throw new Error(`segment ${id} missing`);
      if (!(s.sources ?? []).some((r) => r.kind === source.kind && r.id === source.id)) segments.set(id, { ...s, sources: [...(s.sources ?? []), source] });
    },
  };
  return {
    foundLoyalty,
    senderStats,
    ownerNames,
    trips,
    segments,
    parsed,
    examplesOf,
    pending,
    people,
    examples: async (uid) => examplesOf.get(uid) ?? emptyExamples(),
    countSender: async (domain, counts) => {
      const now = senderStats.get(domain) ?? {};
      for (const [field, n] of Object.entries(counts)) now[field] = (now[field] ?? 0) + n;
      senderStats.set(domain, now);
    },
    saveExample: async (uid, label, example) => {
      examplesOf.set(uid, addExample(examplesOf.get(uid) ?? emptyExamples(), label, example));
    },
    claimMessage: async (uid, id, processedAt, generation) => {
      const key = `${uid}/${id}`;
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return false;
      if (!claimable(parsed.get(key), processedAt)) return false;
      parsed.set(key, claimRecord(parsed.get(key), uid, id, processedAt));
      return true;
    },
    reclaimMessage: async (uid, id, processedAt, generation) => {
      const key = `${uid}/${id}`;
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return false;
      if (!reclaimable(parsed.get(key), processedAt)) return false;
      parsed.set(key, claimRecord(parsed.get(key), uid, id, processedAt));
      return true;
    },
    retryMessage: async (uid, id, processedAt, generation) => {
      const key = `${uid}/${id}`;
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return false;
      if (!retryable(parsed.get(key), processedAt)) return false;
      parsed.set(key, claimRecord(parsed.get(key), uid, id, processedAt));
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
    refreshRecords: async (uid, after, limit, everything = false) =>
      [...parsed.values()]
        .filter((r) => r.uid === uid && (r.outcome === "imported" || r.outcome === "not_booking" || r.outcome === "failed" || r.outcome === "processing" || (everything && r.outcome === "filtered")) && (after === undefined || r.messageId > after))
        .sort((a, b) => (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0))
        .slice(0, limit),
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
        connectedMailboxes: async () => 0,
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
    ownerName: async (uid) => ownerNames.get(uid),
    dropUnseenFoundLoyalty: async (uid, messageId, since, generation) => {
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return 0;
      const current = foundLoyalty.get(uid) ?? [];
      const kept = current.filter((f) => !(f.messageId === messageId && f.at < since));
      foundLoyalty.set(uid, kept);
      return current.length - kept.length;
    },
    addFoundLoyalty: async (uid, found, generation) => {
      if (generation !== undefined && (generations.get(uid) ?? 0) !== generation) return { refused: 0, superseded: true };
      const { found: next, refused } = withFoundLoyalties(foundLoyalty.get(uid) ?? [], found);
      foundLoyalty.set(uid, next);
      return { refused };
    },
    newId: () => `trip${++ids}`,
  };
}

