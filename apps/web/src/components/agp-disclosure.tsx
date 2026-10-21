"use client";
import { useId, useState } from "react";
import { AgpCard } from "@/components/agp-card";

/**
 * The glucose profile beside a care message thread, for the care team. Closed until a clinician opens it: the read goes through the audited
 * vitals path and writes an audit row each time, so it is made on purpose, not every time a thread is opened. Opening it on a patient with no
 * sensor says so rather than showing nothing.
 */
export function AgpDisclosure({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-brand-green underline-offset-2 hover:underline dark:text-brand-green-bright"
      >
        {open ? "Hide sensor glucose profile" : "Show sensor glucose profile"}
      </button>
      <div id={panelId} hidden={!open}>
        {open ? <AgpCard patientId={patientId} audience="clinician" showWhenEmpty /> : null}
      </div>
    </div>
  );
}
