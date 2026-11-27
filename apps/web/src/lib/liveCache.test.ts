import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLiveCache, peekLive, peekLivePrefix, subscribeLive } from "./liveCache";

// Exercise the subscribe/teardown/dedup/grace lifecycle directly using a minimal
// useSyncExternalStore mock so tests run in node without a full DOM.
let notifications = 0;

vi.mock("react", () => ({
  useRef: <T,>(initial: T) => ({ current: initial }),
  useEffect: (fn: () => void) => {
    fn();
  },
  useLayoutEffect: (fn: () => void) => {
    fn();
  },
  useCallback: <T,>(fn: T) => fn,
  useSyncExternalStore: (
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => unknown,
  ) => {
    const unsub = subscribe(() => {
      notifications += 1;
    });
    const val = getSnapshot();
    return { val, unsub };
  },
}));

import { useLiveSubscription } from "./liveCache";

type HookHandle<T> = { val: T | undefined; unsub: () => void };

function useMount<T>(
  key: string | undefined,
  start: (emit: (v: T) => void, fail: (fallback?: { value: T }) => boolean) => () => void,
  graceMs = 100,
): HookHandle<T> {
  return useLiveSubscription(key, start, graceMs) as unknown as HookHandle<T>;
}

describe("liveCache", () => {
  beforeEach(() => {
    notifications = 0;
    vi.useFakeTimers();
    clearLiveCache();
  });

  afterEach(() => {
    clearLiveCache();
    vi.useRealTimers();
  });

  it("shares one subscription across multiple consumers and keeps value across route switches during grace window", () => {
    let starts = 0;
    let stops = 0;
    let push!: (v: string) => void;
    const start = (emit: (v: string) => void) => {
      starts += 1;
      push = emit;
      return () => {
        stops += 1;
      };
    };

    const a = useMount("profile:u1", start, 5000);
    const b = useMount("profile:u1", start, 5000);
    expect(starts).toBe(1);
    expect(a.val).toBeUndefined();
    expect(b.val).toBeUndefined();

    push("alice");
    expect(peekLive<string>("profile:u1")).toBe("alice");

    // Unmount both consumers: stays warm during grace window.
    a.unsub();
    b.unsub();
    expect(stops).toBe(0);
    expect(peekLive<string>("profile:u1")).toBe("alice");

    // Remounting within grace reuses the live subscription and gets immediate value.
    const c = useMount("profile:u1", start, 5000);
    expect(starts).toBe(1);
    expect(c.val).toBe("alice");

    // Unmounting and letting grace expire tears down and clears stale data.
    c.unsub();
    vi.advanceTimersByTime(5000);
    expect(stops).toBe(1);
    expect(peekLive<string>("profile:u1")).toBeUndefined();
  });

  it("clears all subscriptions, notifies mounted consumers, and ignores stale emissions after clearLiveCache", () => {
    let stops = 0;
    let push!: (v: string) => void;
    const h = useMount<string>(
      "trips:u1",
      (emit) => {
        push = emit;
        return () => {
          stops += 1;
        };
      },
      5000,
    );

    push("v1");
    expect(peekLive("trips:u1")).toBe("v1");
    const beforeClear = notifications;

    clearLiveCache();
    expect(stops).toBe(1);
    expect(notifications).toBe(beforeClear + 1);
    expect(peekLive("trips:u1")).toBeUndefined();

    // A late callback from the cleared listener must not repopulate the cache.
    push("stale");
    expect(peekLive("trips:u1")).toBeUndefined();
    h.unsub();
  });

  it("shares subscribeLive with useLiveSubscription and exposes entries via peekLivePrefix", () => {
    let starts = 0;
    let push!: (v: string[]) => void;
    const start = (emit: (v: string[]) => void) => {
      starts += 1;
      push = emit;
      return () => {};
    };
    let directNotified = 0;
    const unsubDirect = subscribeLive<string[]>("trips:shared:u1:a@example.com", start, () => {
      directNotified += 1;
    }, 5000);
    const hooked = useMount<string[]>("trips:shared:u1:a@example.com", start, 5000);
    expect(starts).toBe(1);

    push(["t1"]);
    expect(directNotified).toBe(1);
    expect(peekLivePrefix<string[]>("trips:shared:u1:")).toEqual([["t1"]]);
    expect(peekLivePrefix<string[]>("trips:shared:u2:")).toEqual([]);

    unsubDirect();
    hooked.unsub();
  });

  it("evicts failed entries on unmount and restarts immediately when a new consumer joins", () => {
    let starts = 0;
    let push!: (v: string[]) => void;
    let failFn!: (fallback?: { value: string[] }) => boolean;
    const start = (emit: (v: string[]) => void, fail: (fallback?: { value: string[] }) => boolean) => {
      starts += 1;
      push = emit;
      failFn = fail;
      return () => {};
    };

    // Case 1: first consumer fails, unmounts, and next consumer attaches a fresh listener without waiting for grace.
    const a = useMount<string[]>("segments:t1", start, 5000);
    expect(starts).toBe(1);
    expect(failFn()).toBe(false);
    a.unsub();
    const b = useMount<string[]>("segments:t1", start, 5000);
    expect(starts).toBe(2);
    push(["s1"]);
    expect(peekLive<string[]>("segments:t1")).toEqual(["s1"]);
    b.unsub();
    vi.advanceTimersByTime(5000);

    // Case 2: second consumer joins while first listener is in-flight, then first listener fails -> restarts once.
    const c = useMount<string[]>("segments:t2", start, 5000);
    expect(starts).toBe(3);
    const d = useMount<string[]>("segments:t2", start, 5000);
    expect(starts).toBe(3);
    expect(failFn()).toBe(true);
    expect(starts).toBe(4);
    push(["s2"]);
    expect(peekLive<string[]>("segments:t2")).toEqual(["s2"]);
    c.unsub();
    d.unsub();
  });

  it("emits terminal fallback on unretried failure and does not retain it after unmount", () => {
    let failFn!: (fallback?: { value: string | null }) => boolean;
    const h = useMount<string | null>(
      "trip:missing",
      (_emit, fail) => {
        failFn = fail;
        return () => {};
      },
      5000,
    );
    const before = notifications;
    expect(failFn({ value: null })).toBe(false);
    expect(notifications).toBe(before + 1);
    expect(peekLive<string | null>("trip:missing")).toBeNull();
    h.unsub();
    // Failed entries do not linger for the grace period.
    expect(peekLive<string | null>("trip:missing")).toBeUndefined();
  });
});
