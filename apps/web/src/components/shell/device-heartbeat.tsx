"use client";

import { useEffect } from "react";

/** How often to ping while the dashboard tab is visible. Same order of
 * magnitude as page-tracker.tsx's analytics heartbeat — this one exists so
 * the escalation engine can eventually tell "device hasn't been seen in
 * days" apart from "notification just wasn't opened yet" (the v3 pivot
 * banner's "device heartbeat" item). Not yet read by the escalation engine
 * itself — this lands the signal; consuming it in the ladder is a follow-up. */
const HEARTBEAT_MS = 4 * 60 * 1000;

function beat() {
  if (document.visibilityState !== "visible") return;
  void fetch("/api/heartbeat", { method: "POST", keepalive: true }).catch(() => {
    // Best-effort background signal — never surfaced to the user.
  });
}

/** Renders nothing. Mounted once inside AppShell so every authenticated
 * dashboard route (not marketing) reports app_last_active_at. */
export function DeviceHeartbeat() {
  useEffect(() => {
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return null;
}
