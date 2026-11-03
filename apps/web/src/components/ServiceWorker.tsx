"use client";

import { useEffect } from "react";
import { captureInstallOffers } from "@/lib/install";
import { serviceWorkerEnabled } from "@/lib/offline";

// Mounted once at the root: registers the service worker and starts keeping
// the browser's install offer, whichever page it arrives on.
export function ServiceWorker() {
  useEffect(() => {
    captureInstallOffers();
  }, []);
  useEffect(() => {
    if (!serviceWorkerEnabled || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) => console.error("Service worker registration failed", error));
  }, []);
  return null;
}
