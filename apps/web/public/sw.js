/**
 * Navigation-only service worker: its sole job is a branded offline page.
 *
 * It NEVER caches pages, API responses, or any clinical data — stale
 * vitals/escalations/results are a safety hazard on a health platform, so
 * every navigation goes to the network and the cache is consulted only when
 * the network itself is unreachable.
 */
const OFFLINE_CACHE = "th-offline-v1";
const OFFLINE_URL = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_URL, "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) => cache.addAll(OFFLINE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("th-offline-") && key !== OFFLINE_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Page navigations only — asset/API requests are left entirely alone.
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached ?? Response.error();
    })
  );
});
