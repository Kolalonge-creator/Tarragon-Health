/**
 * Navigation-only offline cache + Web Push receiver.
 *
 * The offline-cache half NEVER caches pages, API responses, or any clinical
 * data — stale vitals/escalations/results are a safety hazard on a health
 * platform, so every navigation goes to the network and the cache is
 * consulted only when the network itself is unreachable.
 *
 * The push half (2026-07-30) shows whatever send-pending-notifications sent
 * and reports back when the user actually opens it — that open is the real
 * delivery-confirmation signal the forced-channel escalation engine
 * (critical_notification_engine.sql) waits on before it force-escalates to
 * WhatsApp/SMS. It never touches the notification's content beyond
 * display — no clinical data is cached or stored by this file either way.
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

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A malformed/empty push payload still shows a generic notification
    // rather than silently dropping — the recipient should never wonder
    // whether "something happened" with no visible sign of it.
  }
  const title = data.title || "Tarragon Health";
  const options = {
    body: data.body || "You have an update.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.notificationId || undefined,
    data: { url: data.url || "/", notificationId: data.notificationId || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  const notificationId = event.notification.data && event.notification.data.notificationId;

  event.waitUntil(
    (async () => {
      if (notificationId) {
        // Best-effort — a failed beacon must never block opening the app.
        // This is the real confirmation signal the escalation engine waits
        // on (notifications.opened_at), not delivery to the device, which
        // Web Push has no receipt for at all.
        try {
          await fetch("/api/notifications/opened", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notificationId }),
            keepalive: true,
          });
        } catch {
          // ignore — opening the app still proceeds
        }
      }

      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              // origin already focused is good enough if navigate fails
            }
          }
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })()
  );
});
