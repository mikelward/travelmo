import type { Trip } from "@travelmo/core";

// What a trips query's snapshots need to give: its documents' changes since the
// last snapshot, and whether the server or only the local cache answered.
export type TripsSnapshot = { docChanges(): readonly unknown[]; metadata: { fromCache: boolean } };

// A trips query's answer, tagged with which query it answers.
export type Answer = { query: string; trips: Trip[]; confirmed: boolean };

// A query's answer from a snapshot, keeping the trips already parsed when only
// whether the server confirmed them changed: never another query's, whose
// first snapshot of nothing would otherwise keep the old query's trips.
export function answerOf<S extends TripsSnapshot>(was: Answer | undefined, query: string, s: S, parse: (s: S) => Trip[]): Answer {
  return {
    query,
    trips: was?.query === query && s.docChanges().length === 0 ? was.trips : parse(s),
    confirmed: !s.metadata.fromCache,
  };
}

// An answer to this query, or none while its own hasn't come.
export const answerTo = (answer: Answer | undefined, query: string) => (answer?.query === query ? answer : undefined);
