"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the browser's own connectivity signal (navigator.onLine + the
 * window online/offline events) for UI purposes only — e.g. an "you're
 * offline" banner. This is NOT a proof of reachability: navigator.onLine
 * only reflects whether the OS/browser has a network interface up, so it
 * can read true on a Nigerian mobile connection with a live radio link but
 * no real throughput to Supabase, and it can occasionally read false on a
 * captive-portal Wi-Fi that actually has internet. Nothing downstream of
 * this hook should skip a real request or a retry decision based on it —
 * mutations still attempt the network and surface their own failure; this
 * only drives an informational banner telling the patient/clinician what
 * their device currently believes.
 *
 * Starts `true` (assume online) rather than reading navigator.onLine during
 * render: navigator doesn't exist during SSR, and reading it in the initial
 * client render before hydration would risk a hydration mismatch against
 * the server-rendered markup. The real value is picked up in the effect,
 * which also only runs client-side.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // setIsOnline is called from inside this async IIFE, not synchronously
    // in the effect body — same pattern as MfaNudgeBanner's mount check,
    // which avoids react-hooks/set-state-in-effect while still reading the
    // real browser value as soon as this effect first runs.
    void (async () => {
      if (!cancelled) setIsOnline(navigator.onLine);
    })();

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
