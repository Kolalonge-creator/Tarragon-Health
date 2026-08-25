"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { NAV_ICON } from "@/lib/icons";

const DISMISSED_KEY = "th_install_prompt_dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  // iPadOS 13+ identifies as "MacIntel" in the UA string but, unlike a real
  // Mac, reports multiple touch points — the standard way to tell them apart.
  const iPadOs13Plus = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  return /iphone|ipad|ipod/i.test(ua) || iPadOs13Plus;
}

function isDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

type PromptState = { visible: boolean; platform: "ios" | "installable" | null };

/**
 * iOS has no `beforeinstallprompt` event at all, so whether to show the iOS
 * manual-instructions path is knowable synchronously up front — computed
 * here as useState's lazy initializer (runs once, pre-render) rather than
 * in an effect, since setting state synchronously inside an effect body
 * triggers an extra cascading render (react-hooks/set-state-in-effect).
 * The Chromium `beforeinstallprompt` path, by contrast, can only ever
 * resolve later via that event firing — genuinely effect-driven, so it stays
 * in the effect below, same as PushSubscribePrompt's async-resolved state.
 */
function initialPromptState(): PromptState {
  if (typeof window === "undefined") return { visible: false, platform: null };
  if (isStandalone() || isDismissed()) return { visible: false, platform: null };
  if (isIos()) return { visible: true, platform: "ios" };
  return { visible: false, platform: null };
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Install-to-home-screen nudge — the precondition the platform's push
 * notifications silently depended on and never surfaced: iOS Safari only
 * ever delivers Web Push to an installed PWA, never to an ordinary browser
 * tab, and unlike Android/desktop Chrome, iOS has no native install prompt
 * at all — a doctor on an iPhone who never happens to know about Share ->
 * Add to Home Screen gets none of the clinician alerts wired up via push,
 * with nothing telling them why.
 *
 * Two paths: capture Chromium's native `beforeinstallprompt` where it
 * exists (Android/desktop Chrome/Edge) and offer a real one-tap install; on
 * iOS, where no such event exists, show the manual steps instead. Never
 * shown once already installed (standalone display mode), and — like
 * PushSubscribePrompt — dismissible and never re-shown after that.
 */
export function InstallAppPrompt() {
  const [{ visible, platform }, setState] = React.useState<PromptState>(initialPromptState);
  const deferredPromptRef = React.useRef<BeforeInstallPromptEvent | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    // The iOS branch is already resolved by the lazy initializer above; this
    // effect only ever needs to listen for the Chromium install signal.
    if (isStandalone() || isIos() || isDismissed()) return;

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setState({ visible: true, platform: "installable" });
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setState((s) => ({ ...s, visible: false }));
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // fine to skip persisting the dismissal — worst case it re-shows once
    }
  };

  const install = async () => {
    const prompt = deferredPromptRef.current;
    if (!prompt) {
      dismiss();
      return;
    }
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // Best-effort — the browser's own install UI already told the user
      // what happened either way.
    } finally {
      deferredPromptRef.current = null;
      dismiss();
    }
  };

  if (!visible || !platform) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-brand-green/10 py-1 pl-3 pr-1">
      <NAV_ICON.install className="h-3.5 w-3.5 text-brand-green" strokeWidth={2} />
      {platform === "ios" ? (
        <span className="text-xs font-medium text-deep-forest">
          Tap Share, then &quot;Add to Home Screen&quot; for alerts
        </span>
      ) : (
        <button
          type="button"
          onClick={install}
          className="text-xs font-medium text-deep-forest hover:underline"
        >
          Install app
        </button>
      )}
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
