/// <reference lib="webworker" />
import { CacheFirst, CacheableResponsePlugin, ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from "serwist";
import { resumeRequest } from "./sw/resume";

// Bundled by sw.build.mjs into public/sw.js. The worker keeps the pages the
// user has opened, their runtime data and the hashed build assets, so a trip
// page reloads with no network; the trip data itself comes from Firestore's
// persistent cache.
declare const self: ServiceWorkerGlobalScope & typeof globalThis;
declare const BUILD_ID: string;

const offlinePage = "/offline";

// Documents: fresh when the network answers quickly, the saved copy otherwise.
// Next varies its responses on router headers; the saved copy is the plain
// document, which is what a reload wants, so matching ignores Vary.
const pages = new NetworkFirst({
  cacheName: "pages",
  networkTimeoutSeconds: 4,
  matchOptions: { ignoreVary: true },
  plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 60 })],
});

// Router payloads: a page's runtime data (see sw/resume.ts) and the
// prefetches behind soft navigations. The query carries the variant.
const router = new NetworkFirst({
  cacheName: "router",
  networkTimeoutSeconds: 4,
  matchOptions: { ignoreVary: true },
  plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 120 })],
});

// Hashed build output: immutable, so the cache is authoritative.
const assets = new CacheFirst({
  cacheName: "static",
  plugins: [
    new CacheableResponsePlugin({ statuses: [200] }),
    new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }),
  ],
});

const serwist = new Serwist({
  precacheEntries: [{ url: offlinePage, revision: BUILD_ID }],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  runtimeCaching: [
    { matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate", handler: pages },
    { matcher: ({ request, sameOrigin }) => sameOrigin && request.headers.get("rsc") === "1", handler: router },
    { matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"), handler: assets },
    {
      matcher: ({ url, request, sameOrigin }) =>
        sameOrigin && (request.destination === "image" || url.pathname === "/manifest.webmanifest"),
      handler: new StaleWhileRevalidate({
        cacheName: "assets",
        plugins: [new CacheableResponsePlugin({ statuses: [200] })],
      }),
    },
  ],
  // A page never opened before has no saved copy; say so instead of failing.
  fallbacks: { entries: [{ url: offlinePage, matcher: ({ request }) => request.destination === "document" }] },
});

// Saves through a strategy, so its plugins (status check, expiry) apply, and
// hands back the response for inspection.
async function save(strategy: NetworkFirst | CacheFirst, request: Request, event: ExtendableEvent): Promise<Response | undefined> {
  const [response, done] = strategy.handleAll({ request, event });
  const [saved] = await Promise.all([response.catch(() => undefined), done]);
  return saved;
}

// Saves a page the way a reload will request it, with the runtime data its
// shell fetches.
async function savePage(url: string, event: ExtendableEvent): Promise<void> {
  const page = new URL(url, self.location.origin);
  const document = await save(pages, new Request(page, { headers: { accept: "text/html" } }), event);
  if (!document) return;
  const resume = resumeRequest(await document.text(), page);
  if (resume) await save(router, resume, event);
}

// The app asks for what a reload will need (see lib/offline.ts): the page it
// just showed, and the assets a page loaded before the worker took over.
self.addEventListener("message", (event) => {
  const data = event.data as { type?: string; url?: string; urls?: string[] } | undefined;
  if (data?.type === "cache-page" && typeof data.url === "string") {
    event.waitUntil(savePage(data.url, event));
  } else if (data?.type === "cache-assets" && Array.isArray(data.urls)) {
    const sameOrigin = data.urls.filter((url) => typeof url === "string" && new URL(url).origin === self.location.origin);
    event.waitUntil(Promise.all(sameOrigin.map((url) => save(assets, new Request(url), event))));
  }
});

// A reminder from the parser (see apps/parser/src/push.ts): shown as it
// came, replacing an earlier one about the same trip.
self.addEventListener("push", (event) => {
  const data = event.data?.json() as { title?: string; body?: string; url?: string; tag?: string } | undefined;
  if (!data?.title) return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body ?? "",
      tag: data.tag ?? "reminder",
      icon: "/icons/icon-192.png",
      data: { url: data.url ?? "/" },
    }),
  );
});

// Tapping one opens the trip, in a window the app already has if any.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | undefined)?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const open = clients.find((c) => c.url === url) ?? clients[0];
      if (open) {
        if (open.url !== url && "navigate" in open) await open.navigate(url);
        await open.focus();
      } else await self.clients.openWindow(url);
    }),
  );
});

serwist.addEventListeners();
