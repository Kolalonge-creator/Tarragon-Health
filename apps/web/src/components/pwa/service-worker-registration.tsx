"use client";

import { useEffect } from "react";

/**
 * Registers the navigation-only offline service worker (public/sw.js).
 * Production only — a service worker in dev interferes with HMR and is
 * pointless against localhost.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline fallback is progressive enhancement — never surface a failure.
    });
  }, []);

  return null;
}
