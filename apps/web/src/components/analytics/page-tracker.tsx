"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * First-party page-view tracker. Fires a beacon to /api/track on each
 * navigation so the analytics console can report acquisition (anonymous
 * visitors, geo, referrers) and engagement (logged-in DAU/WAU/MAU, retention).
 *
 * Deliberately dependency-light and marketing-safe: it imports nothing from
 * auth/platform modules (the marketing route group must not), and it never
 * blocks rendering. profile_id and geo are resolved server-side in the route —
 * this component sends only path/referrer/utm/session/device.
 */

const SESSION_KEY = "th_session_id";

function getSessionId(): string {
  try {
    let id = window.localStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      window.localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

/** Interval between "still here" heartbeats while a tab is visible. Keeps
 * staff session duration (Team activity tab) accurate for time spent reading a
 * page, not just navigating. Well under the 30-min sessionization gap. */
const HEARTBEAT_MS = 4 * 60 * 1000;

function send(payload: Record<string, string | undefined>) {
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    if (navigator.sendBeacon && navigator.sendBeacon("/api/track", blob)) return;
  } catch {
    // fall through to fetch
  }
  void fetch("/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

export function PageTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Skip automated browsers/bots best-effort.
    if (typeof navigator !== "undefined" && navigator.webdriver) return;

    const base = () => ({
      path: pathname,
      referrer: document.referrer || undefined,
      utm_source: searchParams.get("utm_source") ?? undefined,
      utm_medium: searchParams.get("utm_medium") ?? undefined,
      utm_campaign: searchParams.get("utm_campaign") ?? undefined,
      session_id: getSessionId(),
    });

    // Pageview on navigation.
    send(base());

    // Heartbeat while the tab is visible (so "how long logged in" is real time,
    // not just click count).
    const beat = () => {
      if (document.visibilityState === "visible") send(base());
    };
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [pathname, searchParams]);

  return null;
}
