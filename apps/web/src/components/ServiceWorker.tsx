"use client";

import { useEffect } from "react";
import { serviceWorkerEnabled } from "@/lib/offline";

export function ServiceWorker() {
  useEffect(() => {
    if (!serviceWorkerEnabled || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) => console.error("Service worker registration failed", error));
  }, []);
  return null;
}
