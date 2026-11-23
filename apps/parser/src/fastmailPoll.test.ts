import { pollFastmail, type PollIo } from "./fastmailPoll";
import type { ChangesResult } from "./jmap";

type State = { emailState?: string };

function io(options: { state?: State; changes?: ChangesResult | "expired"; resetDuring?: boolean; current?: string } = {}) {
  let generation = 1;
  const log: string[] = [];
  const poll: PollIo<State, number> = {
    resetGeneration: async () => generation,
    loadState: async () => options.state,
    stateOf: (s) => s.emailState,
    currentState: async () => options.current ?? "now",
    createdSince: async (_s, since) => {
      log.push(`since ${since}`);
      return options.changes ?? { created: [], state: since };
    },
    importIds: async (_s, ids, g) => {
      log.push(`import ${ids.join(",")} @${g}`);
      if (options.resetDuring) generation += 1;
      return ids.length;
    },
    saveState: async (_s, emailState, g) => {
      if (g !== generation) return false;
      log.push(`save ${emailState}`);
      return true;
    },
  };
  return { poll, log };
}

describe("pollFastmail", () => {
  it("imports what reached the inbox since the stored state, then moves the state on", async () => {
    const { poll, log } = io({ state: { emailState: "5" }, changes: { created: ["fm-M1", "fm-M2"], state: "7" } });
    expect(await pollFastmail(poll)).toEqual({ kind: "processed", messages: 2, counts: 2 });
    expect(log).toEqual(["since 5", "import fm-M1,fm-M2 @1", "save 7"]);
  });

  it("starts from now when it has no place yet", async () => {
    const { poll, log } = io({ state: {}, current: "9" });
    expect(await pollFastmail(poll)).toEqual({ kind: "started" });
    expect(log).toEqual(["save 9"]);
  });

  it("skips ahead when the server can no longer say what changed", async () => {
    const { poll, log } = io({ state: { emailState: "1" }, changes: "expired", current: "40" });
    expect(await pollFastmail(poll)).toEqual({ kind: "expired", since: "1" });
    expect(log).toEqual(["since 1", "save 40"]);
  });

  it("keeps its place when the trips were reset meanwhile, so the next poll reads the mail again", async () => {
    const { poll, log } = io({ state: { emailState: "5" }, changes: { created: ["fm-M1"], state: "6" }, resetDuring: true });
    expect(await pollFastmail(poll)).toEqual({ kind: "superseded", messages: 1, counts: 1 });
    expect(log).not.toContain("save 6");
  });

  it("does nothing for a user who disconnected", async () => {
    const { poll, log } = io();
    expect(await pollFastmail(poll)).toEqual({ kind: "disconnected" });
    expect(log).toEqual([]);
  });
});
