"use client";

import { useEffect } from "react";

// Production only: in development the build output is not hashed, so a
// cache-first worker would serve stale code.
export const serviceWorkerEnabled = process.env.NODE_ENV === "production";

function supported(): boolean {
  return serviceWorkerEnabled && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

// Build assets this page has loaded. The first visit loads them before the
// worker controls the page, so the worker never saw them.
function loadedAssets(): string[] {
  const urls = new Set<string>();
  for (const entry of performance.getEntriesByType("resource")) {
    const url = new URL(entry.name, location.href);
    if (url.origin === location.origin && url.pathname.startsWith("/_next/static/")) urls.add(url.href);
  }
  return [...urls];
}

// Asks the service worker to keep the page that just mounted, so it reloads
// with no network (see src/sw.ts). A soft navigation fetches no document, so
// the worker would otherwise never see the page; a hard load's own document
// and its assets are saved again, which is cheap. Reads the location in the
// effect, so the page's prerendered shell stays static.
export function useSaveForOffline(): void {
  useEffect(() => {
    if (!supported()) return;
    const url = location.pathname;
    let current = true;
    navigator.serviceWorker.ready
      .then((registration) => {
        if (!current || !registration.active) return;
        registration.active.postMessage({ type: "cache-page", url });
        registration.active.postMessage({ type: "cache-assets", urls: loadedAssets() });
      })
      .catch((error) => console.error("Service worker not ready", error));
    return () => {
      current = false;
    };
  }, []);
}
