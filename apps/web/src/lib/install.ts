"use client";

import { useSyncExternalStore } from "react";

// What Settings offers for installing Travelmo: nothing once it runs
// installed; the browser's own install prompt where it offers one (Chrome,
// Edge, Android); and on iPhone and iPad, where Safari has no prompt, how to
// add it to the Home Screen.
export type InstallHint = "installed" | "prompt" | "ios" | "none";

export function installHint(userAgent: string, touchPoints: number, standalone: boolean, canPrompt: boolean): InstallHint {
  if (standalone) return "installed";
  if (canPrompt) return "prompt";
  // iPadOS Safari reports itself as a Mac; touch tells them apart.
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return "ios";
  return "none";
}

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// The browser offers to install once, on whatever page is open, and does not
// repeat it on a client-side navigation: the offer is kept here, for the whole
// session, from the moment the app starts (`captureInstallOffers`, mounted at
// the root), and Settings uses it whenever it is shown.
let offer: InstallEvent | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
let capturing = false;

export function captureInstallOffers(): void {
  if (capturing || typeof window === "undefined") return;
  capturing = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep the browser's prompt for the button rather than its mini-bar.
    e.preventDefault();
    offer = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    offer = undefined;
    notify();
  });
}

function subscribeOffer(onChange: () => void) {
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}

const standaloneQuery = "(display-mode: standalone)";

function subscribeStandalone(onChange: () => void) {
  const query = window.matchMedia(standaloneQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const isStandalone = () =>
  window.matchMedia(standaloneQuery).matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const noChange = () => () => {};

export function useInstall(): { hint: InstallHint; install: () => Promise<void> } {
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const userAgent = useSyncExternalStore(noChange, () => navigator.userAgent, () => "");
  const touchPoints = useSyncExternalStore(noChange, () => navigator.maxTouchPoints, () => 0);
  const current = useSyncExternalStore(subscribeOffer, () => offer, () => undefined);
  return {
    hint: installHint(userAgent, touchPoints, standalone, current !== undefined),
    install: async () => {
      if (!current) return;
      await current.prompt();
      // A prompt can be shown once; the browser offers another later if needed.
      await current.userChoice;
      if (offer === current) {
        offer = undefined;
        notify();
      }
    },
  };
}
