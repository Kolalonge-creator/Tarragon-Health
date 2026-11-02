"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { NAV_ICON } from "@/lib/icons";
import { VAPID_PUBLIC_KEY } from "@/lib/push/vapid-public-key";
import { sameApplicationServerKey } from "@/lib/push/same-application-server-key";
import { errorDetail, pushSetupMessage, type PushSetupResult } from "@/lib/push/setup-result";

const DISMISSED_KEY = "th_push_prompt_dismissed";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

const WORKER_READY_TIMEOUT_MS = 8000;

async function subscribeAndStore(): Promise<PushSetupResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, step: "unsupported", detail: "" };
  }
  let registration: ServiceWorkerRegistration;
  try {
    // `ready` never settles when no worker is registered, so it is raced against a timeout instead of hanging the button forever.
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), WORKER_READY_TIMEOUT_MS)),
    ]);
    if (!ready) return { ok: false, step: "service_worker", detail: "not ready after 8 seconds" };
    registration = ready;
  } catch (err) {
    return { ok: false, step: "service_worker", detail: errorDetail(err) };
  }

  let subscription: PushSubscription;
  try {
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const existing = await registration.pushManager.getSubscription();
    // A subscription made before a VAPID key rotation is bound to the old key and every send
    // to it is rejected, so drop it and subscribe again with the current key.
    if (existing && !sameApplicationServerKey(existing.options.applicationServerKey, applicationServerKey)) {
      await existing.unsubscribe();
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    } else {
      subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));
    }
  } catch (err) {
    return { ok: false, step: "subscribe", detail: errorDetail(err) };
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, step: "details", detail: "" };
  }

  try {
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (body?.ok) return { ok: true };
    return { ok: false, step: "save", detail: body?.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, step: "save", detail: errorDetail(err) };
  }
}

/**
 * Push is now the platform's default notification channel — this is the
 * one-tap opt-in that makes a recipient's device reachable by it at all
 * (reminders are delivered by push once a subscription like this exists,
 * with the in-app inbox as the fallback). Silent
 * and automatic once permission is already granted (e.g. re-subscribing
 * after a browser-rotated endpoint); only shows the pill when permission
 * has genuinely never been asked. Never re-prompts after a dismiss or a
 * denial — respects the user's choice rather than nagging every page load.
 */
export function PushSubscribePrompt() {
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
        // Permission is already given, so this re-subscribes silently. A failure used to vanish, leaving a device that looked opted in
        // and received nothing; it now shows the reason with a retry in the same chip.
        const result = await subscribeAndStore();
        if (!result.ok && !cancelled) {
          setError(pushSetupMessage(result));
          setVisible(true);
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
        const result = await subscribeAndStore();
        if (result.ok) {
          setError(null);
          setVisible(false);
        } else {
          setError(pushSetupMessage(result));
        }
      } else {
        dismiss();
      }
    } catch (err) {
      setError(pushSetupMessage({ ok: false, step: "subscribe", detail: errorDetail(err) }));
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
      <NAV_ICON.bell className="h-3.5 w-3.5 text-brand-green" strokeWidth={2} aria-hidden />
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        // The visible chip stays exactly as designed (it lives in the
        // topbar, where a 44px-tall control would grow the whole header);
        // the ::after box extends the tap target to 44px without changing a
        // pixel of what is drawn.
        className="relative text-xs font-medium text-deep-forest after:absolute after:inset-x-0 after:-inset-y-3.5 after:content-[''] hover:underline disabled:opacity-60 dark:text-brand-green-bright"
      >
        {error ? "Try again" : "Enable alerts"}
      </button>
      {error && (
        <span role="status" className="max-w-[16rem] truncate text-[11px] text-charcoal-ink/70 dark:text-night-ink/70" title={error}>
          {error}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="relative h-6 w-6 p-0 text-charcoal-ink/40 after:absolute after:-inset-2.5 after:content-[''] hover:text-charcoal-ink dark:text-night-ink/50 dark:hover:text-night-ink"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <NAV_ICON.close className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </Button>
    </div>
  );
}
