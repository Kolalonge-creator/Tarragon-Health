"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EMERGENCY_BUTTON_LABEL,
  EMERGENCY_GUIDANCE,
  SELF_HARM_GUIDANCE,
  buildEmergencyAddendum,
  type EmergencyAddendumInput,
} from "@tarragon/shared";
import { getEmergencyContextAction } from "@/lib/ai-coach/emergency-actions";

/**
 * S52 (spec 7.8, INV-06): the emergency button, visible on every assistant screen. Pressing it shows the bundled guidance at once
 * (no network, no model, nothing to load), then adds the nearest hospitals and the patient's own emergency contact when they can be
 * read. If they cannot (no signal), the bundled guidance stands alone. Never behind a guard, never behind a plan.
 */
export function AssistantEmergencyButton() {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState<string>("");

  async function show() {
    setOpen(true);
    try {
      const ctx: EmergencyAddendumInput = await getEmergencyContextAction();
      setExtra(buildEmergencyAddendum(ctx));
    } catch {
      // offline or the server is slow: the bundled guidance above already says what to do
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="border-red-600 text-red-700 dark:border-red-400 dark:text-red-300"
        aria-expanded={open}
        aria-controls="assistant-emergency-panel"
        onClick={() => (open ? setOpen(false) : void show())}
      >
        {EMERGENCY_BUTTON_LABEL}
      </Button>
      {open && (
        <div
          id="assistant-emergency-panel"
          role="alert"
          className="space-y-2 rounded-md border border-red-600/40 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-charcoal-ink dark:text-night-ink"
        >
          <p className="font-medium">{EMERGENCY_GUIDANCE.title}</p>
          <ul className="list-disc space-y-1 pl-5">
            {EMERGENCY_GUIDANCE.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="font-medium">{SELF_HARM_GUIDANCE.title}</p>
          <ul className="list-disc space-y-1 pl-5">
            {SELF_HARM_GUIDANCE.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {extra && <p className="whitespace-pre-line">{extra}</p>}
        </div>
      )}
    </div>
  );
}
