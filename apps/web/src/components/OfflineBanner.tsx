"use client";

import { useOffline } from "next/offline";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Next's hook learns of a dropped connection from a failed navigation or
// the offline event; a page loaded while already offline sees neither, so
// the browser's own flag is read too.
export function OfflineBanner() {
  const failedRequests = useOffline();
  const browserOffline = useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
  if (!failedRequests && !browserOffline) return null;
  return (
    <div
      role="status"
      className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      You&apos;re offline. Showing the trips saved on this device.
    </div>
  );
}
