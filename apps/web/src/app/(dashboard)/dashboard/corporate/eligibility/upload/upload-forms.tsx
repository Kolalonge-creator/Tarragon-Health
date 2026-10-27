"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { approveUploadAction, cancelUploadAction, commitUploadAction, stageUploadAction, type StageState, type StepState } from "./actions";

export function StageForm() {
  const [state, action, pending] = useActionState<StageState, FormData>(stageUploadAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-1">
        <legend className="font-medium">What should this file do?</legend>
        {[
          ["add", "Add or update people (nobody is removed)"],
          ["remove", "Remove the people listed (they stop being covered)"],
          ["replace", "This is the full list: anyone not in it stops being covered"],
        ].map(([v, l], i) => (
          <label key={v} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="mode" value={v} defaultChecked={i === 0} /> {l}
          </label>
        ))}
      </fieldset>
      <label className="block text-sm">
        <span className="font-medium">Choose a CSV file</span>
        <input type="file" name="file" accept=".csv,text/csv,text/plain" className="mt-1 block min-h-11" />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Or paste your list (phone, email, name, department, location, status)</span>
        <textarea name="pasted" rows={6} className="mt-1 block w-full rounded border px-3 py-2 font-mono text-xs" />
      </label>
      <p className="text-xs text-charcoal-ink/60">Nothing changes yet. We check every row and show you what would happen first. Local numbers such as 0803... are accepted.</p>
      <Button type="submit" disabled={pending}>{pending ? "Checking" : "Check this file"}</Button>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function StepButton({ label, run, batch, variant }: { label: string; run: (b: string, p: StepState) => Promise<StepState>; batch: string; variant?: "outline" }) {
  const [state, action, pending] = useActionState<StepState, FormData>(() => run(batch, undefined), undefined);
  return (
    <form action={action} className="space-y-1">
      <Button type="submit" variant={variant} disabled={pending}>{pending ? "Working" : label}</Button>
      {state?.error && <p role="alert" className="max-w-md text-sm text-red-600">{state.error}</p>}
      {state?.message && <p role="status" className="text-sm text-brand-green">{state.message}</p>}
    </form>
  );
}

export function BatchSteps({ batch, status }: { batch: string; status: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      {status === "staged" && <StepButton label="Approve" run={approveUploadAction} batch={batch} />}
      {status === "approved" && <StepButton label="Apply to my list" run={commitUploadAction} batch={batch} />}
      {(status === "staged" || status === "approved") && <StepButton label="Cancel" run={cancelUploadAction} batch={batch} variant="outline" />}
    </div>
  );
}
