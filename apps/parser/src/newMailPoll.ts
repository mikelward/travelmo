// What reached the inbox since a mailbox state, and the state to read on
// from.
export type ChangesResult = { created: string[]; state: string };

// New mail in a polled mailbox (Fastmail's, and those connected over IMAP),
// read every few minutes (Cloud Scheduler): the emails that reached the
// inbox since the stored mailbox state, imported as Gmail's pushed ones are. The state moves on only once they are, and only while
// the user's trips have not been reset meanwhile, so nothing is skipped:
// a poll that fails or is superseded is read again by the next.

export type PollIo<S, C> = {
  resetGeneration: () => Promise<number>;
  loadState: () => Promise<S | undefined>;
  stateOf: (state: S) => string | undefined;
  currentState: (state: S) => Promise<string>;
  createdSince: (state: S, since: string) => Promise<ChangesResult | "expired">;
  importIds: (state: S, ids: readonly string[], generation: number) => Promise<C>;
  // False when the connection is gone or the trips were reset since
  // `generation` was read.
  saveState: (state: S, emailState: string, generation: number) => Promise<boolean>;
};

export type PollResult<C> =
  | { kind: "disconnected" }
  // No place yet (a connection saved before its state was known): reading
  // starts from now.
  | { kind: "started" }
  | { kind: "expired"; since: string }
  | { kind: "processed"; messages: number; counts: C }
  | { kind: "superseded"; messages: number; counts: C };

export async function pollNewMail<S, C>(io: PollIo<S, C>): Promise<PollResult<C>> {
  const generation = await io.resetGeneration();
  const state = await io.loadState();
  if (!state) return { kind: "disconnected" };
  const since = io.stateOf(state);
  if (!since) {
    await io.saveState(state, await io.currentState(state), generation);
    return { kind: "started" };
  }
  const changes = await io.createdSince(state, since);
  if (changes === "expired") {
    // Too far behind for the server to say what arrived: carry on from now.
    // The backfill finds what was missed.
    await io.saveState(state, await io.currentState(state), generation);
    return { kind: "expired", since };
  }
  const counts = await io.importIds(state, changes.created, generation);
  const messages = changes.created.length;
  if (await io.saveState(state, changes.state, generation)) return { kind: "processed", messages, counts };
  if ((await io.resetGeneration()) !== generation) return { kind: "superseded", messages, counts };
  return { kind: "disconnected" };
}
