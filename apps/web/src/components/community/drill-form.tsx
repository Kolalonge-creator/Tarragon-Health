"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DRILL_NOTES_MAX, DRILL_REQUIRED_STEPS, DRILL_STEPS } from "./drill-steps";
import { useStaffAction, StaffMessage } from "./use-staff-action";
import type { StaffActionResult } from "./staff-types";

export interface DrillInput {
  passed: boolean;
  notes: string;
  steps: Array<{ step: string; ok: boolean }>;
}

/** Records one run of the safety drill. Only the Chief Medical Officer is let through by the database; this form is not shown to anyone else. */
export function DrillForm({ onRecord }: { onRecord: (input: DrillInput) => Promise<StaffActionResult> }) {
  const uid = useId();
  const [ticks, setTicks] = useState<boolean[]>(() => DRILL_STEPS.map(() => false));
  const [passed, setPassed] = useState<"yes" | "no" | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { message, pending, run } = useStaffAction();

  function submit() {
    if (passed === "") return setError("Please say whether the drill passed.");
    if (passed === "yes" && ticks.slice(0, DRILL_REQUIRED_STEPS).some((t) => !t)) {
      return setError("A pass needs the first five steps ticked. If one did not work, choose Did not pass and say why in the notes.");
    }
    setError(null);
    run(() => onRecord({ passed: passed === "yes", notes, steps: DRILL_STEPS.map((step, i) => ({ step, ok: ticks[i] })) }));
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-charcoal-ink">Tick each step that worked</legend>
        {DRILL_STEPS.map((step, i) => (
          <div key={step} className="flex items-start gap-2 text-sm">
            <input
              id={`${uid}-s${i}`}
              type="checkbox"
              className="mt-1"
              checked={ticks[i]}
              onChange={(e) => setTicks((t) => t.map((v, idx) => (idx === i ? e.target.checked : v)))}
            />
            <label htmlFor={`${uid}-s${i}`}>
              <span className="font-medium">Step {i + 1}.</span> {step}
            </label>
          </div>
        ))}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold text-charcoal-ink">Result</legend>
        <div className="flex items-center gap-2 text-sm">
          <input id={`${uid}-y`} type="radio" name={`${uid}-r`} checked={passed === "yes"} onChange={() => setPassed("yes")} />
          <label htmlFor={`${uid}-y`}>Passed</label>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input id={`${uid}-n`} type="radio" name={`${uid}-r`} checked={passed === "no"} onChange={() => setPassed("no")} />
          <label htmlFor={`${uid}-n`}>Did not pass</label>
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${uid}-notes`} className="block text-sm font-medium text-charcoal-ink">Notes (optional)</label>
        <textarea
          id={`${uid}-notes`}
          rows={4}
          maxLength={DRILL_NOTES_MAX}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-describedby={`${uid}-nh`}
          className="mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink"
        />
        <p id={`${uid}-nh`} className="mt-1 text-xs text-charcoal-ink/70">Up to {DRILL_NOTES_MAX} characters. Do not write a real member&apos;s name or details.</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Record this drill"}
      </Button>
      <StaffMessage message={message} />
    </form>
  );
}
