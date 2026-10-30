"use client";

import { useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";
import { readEmergency } from "@/lib/vitals/emergency-marker";
import {
  OFFLINE_UNCONFIRMED_BODY,
  OFFLINE_UNCONFIRMED_TITLE,
  offlineGuidanceWording,
} from "@/lib/vitals/offline-emergency";

const subscribe = () => () => {};

/**
 * The bundled emergency guidance, for the error screen. If a reading that asked for emergency guidance was sent and the request then failed
 * outright (the page dropped into the error boundary, so the form's own dialog is gone), the tab still holds the guidance code
 * (lib/vitals/emergency-marker.ts) and this shows the signed wording for it. Renders nothing otherwise, and nothing on the server.
 */
export function UnconfirmedEmergencyNotice() {
  const code = useSyncExternalStore(subscribe, readEmergency, () => null);
  if (!code) return null;
  const wording = offlineGuidanceWording(code);
  return (
    <div role="alert" data-testid="unconfirmed-emergency-notice" className="mt-6 max-w-md rounded-xl border-2 border-red-600 bg-white p-4 text-left">
      <div className="flex items-center gap-2 text-red-700">
        <TriangleAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="font-heading text-lg font-semibold">{wording.title}</p>
      </div>
      <p className="mt-2 text-sm text-charcoal-ink">{wording.body}</p>
      <p className="mt-3 text-sm font-semibold text-red-800">{OFFLINE_UNCONFIRMED_TITLE}</p>
      <p className="text-sm text-red-800">{OFFLINE_UNCONFIRMED_BODY}</p>
    </div>
  );
}
