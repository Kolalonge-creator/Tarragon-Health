"use client";

import * as React from "react";
import { NAV_ICON } from "@/lib/icons";

/**
 * The service worker (public/sw.js) deliberately never caches clinical data
 * — a stale vitals/escalation/result reading is a safety hazard on this
 * platform, so a lost connection just fails every fetch instead of quietly
 * serving something out of date. That's the right call, but it left nothing
 * telling the person using the app *why* things stopped responding. This is
 * only that signal, not a workaround for the underlying gap.
 */
export function OfflineBanner() {
  // Lazy initializer, not an effect: reading navigator.onLine synchronously
  // up front is the actual initial value, not a subscription — setting
  // state from inside an effect body for this would just trigger an
  // avoidable extra render (react-hooks/set-state-in-effect).
  const [online, setOnline] = React.useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  React.useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-800"
    >
      <NAV_ICON.offline className="h-3.5 w-3.5" strokeWidth={2} />
      You&apos;re offline — some information may be out of date until you&apos;re back online.
    </div>
  );
}
