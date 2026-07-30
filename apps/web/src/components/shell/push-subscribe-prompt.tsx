"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { NAV_ICON } from "@/lib/icons";
import { VAPID_PUBLIC_KEY } from "@/lib/push/vapid-public-key";

const DISMISSED_KEY = "th_push_prompt_dismissed";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function subscribeAndStore(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
  return Boolean(body?.ok);
}

/**
 * Push is now the platform's default notification channel — this is the
 * one-tap opt-in that makes a recipient's device reachable by it at all
 * (private.remap_notification_channel only upgrades whatsapp -> push once a
 * subscription like this exists; WhatsApp/SMS stay the fallback). Silent
 * and automatic once permission is already granted (e.g. re-subscribing
 * after a browser-rotated endpoint); only shows the pill when permission
 * has genuinely never been asked. Never re-prompts after a dismiss or a
 * denial — respects the user's choice rather than nagging every page load.
 */
export function PushSubscribePrompt() {
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    // setVisible is called from inside this async callback, not
    // synchronously in the effect body — the sanctioned pattern for
    // "subscribe to an external system, call setState when it resolves"
    // (react-hooks/set-state-in-effect).
    void (async () => {
      if (Notification.permission === "granted") {
        try {
          await subscribeAndStore();
        } catch {
          // Best-effort — a re-subscribe failure is invisible; the user is
          // already opted in, the next successful attempt just retries later.
        }
        return;
      }

      if (Notification.permission === "denied") return;
      let dismissed = false;
      try {
        dismissed = window.localStorage.getItem(DISMISSED_KEY) === "1";
      } catch {
        // localStorage unavailable — fall through and show the prompt anyway.
      }
      if (!cancelled && !dismissed) setVisible(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        await subscribeAndStore();
        setVisible(false);
      } else {
        dismiss();
      }
    } catch {
      dismiss();
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // fine to skip persisting the dismissal — worst case it re-shows once
    }
  };

  if (!visible) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-brand-green/10 py-1 pl-3 pr-1">
      <NAV_ICON.bell className="h-3.5 w-3.5 text-brand-green" strokeWidth={2} />
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        className="text-xs font-medium text-deep-forest hover:underline disabled:opacity-60"
      >
        Enable alerts
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 text-charcoal-ink/40 hover:text-charcoal-ink"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <NAV_ICON.close className="h-3.5 w-3.5" strokeWidth={2} />
      </Button>
    </div>
  );
}
