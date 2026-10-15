"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

type Status = { permission: "granted" | "denied" | "default" | "unsupported"; worker: "active" | "none" | "unsupported" };

/**
 * What this browser can say about itself: whether notifications are allowed and whether the page-handling service worker is running.
 * It reads the browser only; it changes nothing. A phone's battery manager can still stop the app, which no web page can see, so the
 * test page below is the real check.
 */
export function DeviceStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let cancelled = false;
    const permission: Status["permission"] = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
    const hasWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator;
    const lookup: Promise<Status["worker"]> = hasWorker
      ? navigator.serviceWorker
          .getRegistration()
          .then((reg): Status["worker"] => (reg?.active ? "active" : "none"))
          .catch((): Status["worker"] => "none")
      : Promise.resolve("unsupported");
    void lookup.then((worker) => {
      if (!cancelled) setStatus({ permission, worker });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return <p className="text-sm text-charcoal-ink/60">Checking this browser...</p>;
  return (
    <ul className="space-y-2 text-sm">
      <li className="flex flex-wrap items-center gap-2">
        <Badge variant={status.permission === "granted" ? "green" : "amber"}>
          {status.permission === "granted" ? "Notifications allowed" : status.permission === "denied" ? "Notifications blocked" : status.permission === "default" ? "Not asked yet" : "Not supported here"}
        </Badge>
        {status.permission === "denied" ? <span>Allow notifications for this site in the browser settings, then reload.</span> : null}
        {status.permission === "default" ? <span>Open the On call screen and allow notifications when your browser asks.</span> : null}
      </li>
      <li className="flex flex-wrap items-center gap-2">
        <Badge variant={status.worker === "active" ? "green" : "amber"}>
          {status.worker === "active" ? "Background alerts running" : status.worker === "none" ? "Background alerts not running" : "Not supported here"}
        </Badge>
        {status.worker === "none" ? <span>Reload this page once. If it stays this way, use the app on your phone instead.</span> : null}
      </li>
    </ul>
  );
}
