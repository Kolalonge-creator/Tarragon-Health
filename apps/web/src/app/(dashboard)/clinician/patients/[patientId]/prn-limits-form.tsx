"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { setPrnLimitsAction, type SetPrnLimitsState } from "./prn-limits-actions";

export function PrnLimitsForm({
  patientId,
  medicationId,
  minGapMinutes,
  dailyMax,
  canSet,
}: {
  patientId: string;
  medicationId: string;
  minGapMinutes: number | null;
  dailyMax: number | null;
  canSet: boolean;
}) {
  const [state, action, pending] = useActionState<SetPrnLimitsState, FormData>(setPrnLimitsAction, undefined);
  if (!canSet) return null;
  return (
    <form action={action} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="medicationId" value={medicationId} />
      <label className="text-xs text-charcoal-ink/70">
        Shortest gap (minutes)
        <input
          name="minGapMinutes"
          type="number"
          inputMode="numeric"
          defaultValue={minGapMinutes ?? ""}
          className="mt-1 w-full rounded-md border border-mist-grey/60 p-1.5 text-sm"
        />
      </label>
      <label className="text-xs text-charcoal-ink/70">
        Most doses in a day
        <input
          name="dailyMax"
          type="number"
          inputMode="numeric"
          defaultValue={dailyMax ?? ""}
          className="mt-1 w-full rounded-md border border-mist-grey/60 p-1.5 text-sm"
        />
      </label>
      <label className="text-xs text-charcoal-ink/70 sm:col-span-2">
        Reason (kept in the audit record)
        <input name="reason" type="text" required minLength={10} className="mt-1 w-full rounded-md border border-mist-grey/60 p-1.5 text-sm" />
      </label>
      <div className="sm:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save limits (leave both blank to clear)"}
        </Button>
        {state?.error && <p className="mt-1 text-sm text-red-600">{state.error}</p>}
        {state?.success && <p className="mt-1 text-sm text-brand-green">Saved.</p>}
      </div>
    </form>
  );
}
