"use client";

import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OFFLINE_NOT_SAVED_BODY, OFFLINE_NOT_SAVED_TITLE, offlineGuidanceWording } from "@/lib/vitals/offline-emergency";

/**
 * Emergency guidance shown from bundled code when the network is off (INV-06, S85b). Everything on it is static: the signed EMG-001 wording
 * (read through `activeWording`, see offline-emergency.ts) and a plain statement that the reading was NOT saved. It makes no request, offers no
 * action that needs the network, and never says a doctor or the care team has seen anything.
 */
export function OfflineEmergencyGuidance({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wording = offlineGuidanceWording();

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  function trapTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="offline-emergency-title"
      aria-describedby="offline-emergency-body"
      data-testid="offline-emergency-guidance"
      onKeyDown={trapTab}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal-ink/70 p-4 sm:items-center"
    >
      <div ref={panelRef} tabIndex={-1} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl outline-none dark:bg-night-card dark:shadow-none">
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
            <p className="font-semibold">{OFFLINE_NOT_SAVED_TITLE}</p>
            <p className="mt-1">{OFFLINE_NOT_SAVED_BODY}</p>
          </div>
          <Button type="button" variant="outline" onClick={onClose} className="w-full">
            I have read this
          </Button>
        </div>
      </div>
    </div>
  );
}
