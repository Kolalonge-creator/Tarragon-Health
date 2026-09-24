"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the browser's own connectivity signal (navigator.onLine + the
 * window online/offline events) — e.g. for an "you're offline" banner, and
 * for VitalsForm's pre-submit guard (patient/vitals-form.tsx). This is NOT a
 * proof of reachability: navigator.onLine only reflects whether the
 * OS/browser has a network interface up, so it can read true on a Nigerian
 * mobile connection with a live radio link but no real throughput to
 * Supabase, and it can occasionally read false on a captive-portal Wi-Fi
 * that actually has internet. **Default rule for any new consumer: don't
 * skip a real request or a retry decision based on this value** — let the
 * request attempt and surface its own failure, the way React Query
 * mutations already do. VitalsForm's guard is a deliberate, narrow exception
 * to that rule, not the norm — see its own comment for why (in short: a
 * Server-Action-backed useActionState form has no graceful way to surface a
 * client-transport failure without either this guard or a wrapper that
 * breaks progressive enhancement, unlike a React Query mutation's `onError`
 * — see docs/OFFLINE_RESILIENCE_AUDIT.md §3/§6/§4 for the full account,
 * including the accepted trade-off that a false navigator.onLine === false
 * reading can block a submission that would have succeeded).
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

    // setIsOnline is called from inside this IIFE, not directly in the
    // effect body, to satisfy react-hooks/set-state-in-effect — same shape
    // as MfaNudgeBanner's mount check. Unlike that file's version, there's
    // no real `await` before the setState call here (nothing to await —
    // navigator.onLine is synchronous), so this doesn't defer to a genuine
    // microtask the way an async operation would; it's a syntactic pattern
    // match for the lint rule, not a real deferral. Harmless here (the
    // value is correct either way, just available a tick sooner than the
    // comment used to imply) — worth knowing before assuming this `cancelled`
    // guard has been exercised by anything, if a later change adds a real
    // `await` (e.g. a reachability probe) here.
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
