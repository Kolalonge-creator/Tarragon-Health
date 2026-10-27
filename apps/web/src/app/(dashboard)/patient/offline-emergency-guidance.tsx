"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  OFFLINE_NOT_SAVED_BODY,
  OFFLINE_NOT_SAVED_TITLE,
  OFFLINE_UNCONFIRMED_BODY,
  OFFLINE_UNCONFIRMED_TITLE,
  offlineGuidanceWording,
  type OfflineGuidanceCode,
} from "@/lib/vitals/offline-emergency";

/**
 * Emergency guidance shown from bundled code when the network is off, or a sent reading was never confirmed (INV-06, S85b). Everything on it is
 * static: the signed wording for the engine's own code (read through `activeWording`, see offline-emergency.ts) and a plain statement about the
 * save. It makes no request, offers no action that needs the network, and never says a doctor or the care team has seen anything.
 *
 * It is a modal dialog, so it behaves like one: it is rendered at the end of <body>, everything else on the page is made inert and hidden from
 * assistive technology while it is open (and put back exactly as it was), focus moves to its button and stays inside it for Tab and Shift+Tab,
 * Escape closes it, and focus returns to what had it before.
 */
export function OfflineEmergencyGuidance({
  onClose,
  code = "EMG-001",
  variant = "offline",
}: {
  onClose: () => void;
  code?: OfflineGuidanceCode;
  /** "offline": nothing was sent. "unconfirmed": a request went out and no answer came back. */
  variant?: "offline" | "unconfirmed";
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wording = offlineGuidanceWording(code);
  const notSaved = variant === "offline" ? { title: OFFLINE_NOT_SAVED_TITLE, body: OFFLINE_NOT_SAVED_BODY } : { title: OFFLINE_UNCONFIRMED_TITLE, body: OFFLINE_UNCONFIRMED_BODY };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Everything else on the page: inert (no focus, no clicks) and aria-hidden, restored to what each element had before.
    const restore: Array<() => void> = [];
    for (const el of Array.from(document.body.children)) {
      if (!(el instanceof HTMLElement) || el === root) continue;
      const hadInert = el.hasAttribute("inert");
      const hadAriaHidden = el.getAttribute("aria-hidden");
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
      restore.push(() => {
        if (!hadInert) el.removeAttribute("inert");
        if (hadAriaHidden === null) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", hadAriaHidden);
      });
    }

    panelRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();

    return () => {
      restore.forEach((r) => r());
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const inside = active !== null && focusable.includes(active);
    // Focus on the panel itself (or anywhere not on a control) goes to the first or last control; the ends wrap.
    if (!inside) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={rootRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="offline-emergency-title"
      aria-describedby="offline-emergency-body"
      data-testid="offline-emergency-guidance"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal-ink/70 p-4 sm:items-center"
    >
      <div ref={panelRef} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl outline-none dark:bg-night-card dark:shadow-none">
        <div className="rounded-t-2xl bg-red-600 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <TriangleAlert className="h-7 w-7 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <h2 id="offline-emergency-title" className="font-heading text-xl font-semibold">
              {wording.title}
            </h2>
          </div>
        </div>
        <div className="space-y-5 px-6 py-6">
          <p id="offline-emergency-body" className="text-base leading-relaxed text-charcoal-ink dark:text-night-ink">
            {wording.body}
          </p>
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800 dark:bg-red-500/15 dark:text-red-300" data-testid="offline-not-saved">
            <p className="font-semibold">{notSaved.title}</p>
            <p className="mt-1">{notSaved.body}</p>
          </div>
          <Button type="button" variant="outline" onClick={onClose} className="w-full">
            I have read this
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
