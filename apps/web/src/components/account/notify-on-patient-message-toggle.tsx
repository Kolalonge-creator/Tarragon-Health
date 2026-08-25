"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setNotifyOnPatientMessage } from "./notify-on-patient-message-actions";

/**
 * Self-service mute for new_patient_message_clinician_alert — every
 * clinician/care coordinator gets pushed on every patient message with no
 * way to tune it otherwise (real alert-fatigue risk as volume grows). Never
 * touches the critical escalation ladder (vitals red flag, abnormal
 * result, emergency events) — those stay forced, on purpose, for patient
 * safety; this only ever gates the routine-priority message alert.
 */
export function NotifyOnPatientMessageToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = React.useState(initialEnabled);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const toggle = () => {
    const next = !enabled;
    setError(null);
    startTransition(async () => {
      const result = await setNotifyOnPatientMessage(next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEnabled(next);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={enabled ? "green" : "grey"}>{enabled ? "On" : "Off"}</Badge>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={toggle}>
        {pending ? "Saving…" : enabled ? "Turn off" : "Turn on"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
