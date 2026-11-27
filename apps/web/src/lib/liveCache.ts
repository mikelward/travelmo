"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Entry<T> = {
  value: T | undefined;
  listeners: Set<() => void>;
  unsubscribe?: () => void;
  releaseTimer?: ReturnType<typeof setTimeout>;
  failed?: boolean;
  joinedSinceStart?: boolean;
  retried?: boolean;
};

const DEFAULT_GRACE_MS = 15_000;
const serverSnapshot = () => undefined;

let cacheGeneration = 0;
const entries = new Map<string, Entry<unknown>>();
const clearListeners = new Set<() => void>();

export function onClearCache(listener: () => void): void {
  clearListeners.add(listener);
}

// Tears down every shared live listener and drops every cached snapshot.
// Called on sign-out, account switch, and account deletion so another
// account never sees a previous user's documents.
export function clearLiveCache(): void {
  cacheGeneration += 1;
  const toNotify: Array<() => void> = [];
  for (const entry of entries.values()) {
    if (entry.releaseTimer !== undefined) clearTimeout(entry.releaseTimer);
    entry.unsubscribe?.();
    entry.value = undefined;
    for (const listener of entry.listeners) toNotify.push(listener);
  }
  entries.clear();
  for (const listener of toNotify) listener();
  for (const listener of clearListeners) listener();
}

// Reads the latest value held for a live key without subscribing, e.g. to
// seed a trip detail screen immediately from the cached trip list.
export function peekLive<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}

// Reads all cached live values whose keys begin with `prefix`.
export function peekLivePrefix<T>(prefix: string): T[] {
  const out: T[] = [];
  for (const [key, entry] of entries) {
    if (key.startsWith(prefix) && entry.value !== undefined) out.push(entry.value as T);
  }
  return out;
}

// Attaches one consumer to the shared live entry for `key`, starting the
// underlying listener on the first consumer and keeping it warm for `graceMs`
// after the last consumer detaches. `fail()` reports a terminal listener error
// (e.g. a Firestore `PERMISSION_DENIED` on a newly-created trip's subcollection
// before the parent write commits): if another consumer joined since the
// listener started, it restarts once; otherwise the failed entry is evicted so
// the next subscriber attaches a fresh listener. Returns true if restarted.
export function subscribeLive<T>(
  key: string,
  start: (emit: (value: T) => void, fail: (fallback?: { value: T }) => boolean) => () => void,
  onStoreChange: () => void,
  graceMs = DEFAULT_GRACE_MS,
): () => void {
  let entry = entries.get(key) as Entry<T> | undefined;
  if (!entry) {
    entry = { value: undefined, listeners: new Set() };
    entries.set(key, entry as Entry<unknown>);
  }
  if (entry.releaseTimer !== undefined) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = undefined;
  }
  const alreadyRunning = Boolean(entry.unsubscribe);
  entry.listeners.add(onStoreChange);

  const attach = (target: Entry<T>) => {
    const generation = cacheGeneration;
    target.failed = false;
    let active = true;
    const emit = (value: T) => {
      if (!active || generation !== cacheGeneration || entries.get(key) !== target) return;
      target.retried = false;
      if (Object.is(target.value, value)) return;
      target.value = value;
      for (const listener of target.listeners) listener();
    };
    const fail = (fallback?: { value: T }): boolean => {
      if (!active || generation !== cacheGeneration || entries.get(key) !== target) return false;
      active = false;
      if (target.releaseTimer !== undefined) {
        clearTimeout(target.releaseTimer);
        target.releaseTimer = undefined;
      }
      const unsub = target.unsubscribe;
      target.unsubscribe = undefined;
      unsub?.();
      if (target.listeners.size === 0) {
        entries.delete(key);
        return false;
      }
      if (target.joinedSinceStart && !target.retried) {
        target.retried = true;
        target.joinedSinceStart = false;
        attach(target);
        return true;
      }
      target.failed = true;
      if (fallback && !Object.is(target.value, fallback.value)) {
        target.value = fallback.value;
        for (const listener of target.listeners) listener();
      }
      return false;
    };
    const unsub = start(emit, fail);
    if (active && generation === cacheGeneration && entries.get(key) === target) {
      target.unsubscribe = unsub;
    } else {
      unsub();
    }
  };

  if (!alreadyRunning) {
    entry.retried = false;
    entry.joinedSinceStart = false;
    attach(entry);
  } else {
    entry.joinedSinceStart = true;
  }

  return () => {
    const current = entries.get(key) as Entry<T> | undefined;
    if (!current) return;
    current.listeners.delete(onStoreChange);
    if (current.listeners.size === 0) {
      const teardown = () => {
        current.releaseTimer = undefined;
        if (current.listeners.size === 0 && entries.get(key) === current) {
          current.unsubscribe?.();
          current.unsubscribe = undefined;
          entries.delete(key);
        }
      };
      if (current.failed || graceMs <= 0) teardown();
      else current.releaseTimer = setTimeout(teardown, graceMs);
    }
  };
}

// Shared, ref-counted live subscription backed by useSyncExternalStore.
// Multiple components using the same `key` share one Firestore listener and
// one parse per snapshot; unmounting keeps the listener warm for `graceMs`
// so switching routes renders immediately without a loading flash.
export function useLiveSubscription<T>(
  key: string | undefined,
  start: (emit: (value: T) => void, fail: (fallback?: { value: T }) => boolean) => () => void,
  graceMs = DEFAULT_GRACE_MS,
): T | undefined {
  const startRef = useRef(start);
  useIsomorphicLayoutEffect(() => {
    startRef.current = start;
  });

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!key) return () => {};
      return subscribeLive<T>(key, (emit, fail) => startRef.current(emit, fail), onStoreChange, graceMs);
    },
    [key, graceMs],
  );

  const getSnapshot = useCallback(
    () => (key ? (entries.get(key)?.value as T | undefined) : undefined),
    [key],
  );

  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}
