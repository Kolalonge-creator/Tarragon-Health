"use client";

import {
  CONTROLLED_MEDICINE_MESSAGE,
  describeFinding,
  needsAllergyConfirmation,
  needsOverrideReason,
  type SafetyError,
} from "@/lib/prescriptions/parse-safety-error";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * S24: shown when the signing checks stop a prescription or a care plan change. A controlled medicine has no override, so there is no
 * control to offer. Otherwise every finding is listed in plain words, with the allergy-list confirmation where the list is empty (never
 * pre-ticked) and a required reason for going ahead. The database repeats every check, so this is the explanation, not the gate.
 */
export function SafetyFindingsPrompt({
  error,
  idPrefix,
  allergiesConfirmed,
  onAllergiesConfirmedChange,
  overrideReason,
  onOverrideReasonChange,
}: {
  error: SafetyError;
  idPrefix: string;
  allergiesConfirmed: boolean;
  onAllergiesConfirmedChange: (value: boolean) => void;
  overrideReason: string;
  onOverrideReasonChange: (value: string) => void;
}) {
  if (error.kind === "blocked") {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50/60 p-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        {CONTROLLED_MEDICINE_MESSAGE} It cannot be signed here.
      </div>
    );
  }

  const askAllergy = needsAllergyConfirmation(error);
  const askReason = needsOverrideReason(error);

  return (
    <div role="alert" className="space-y-3 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">A safety check needs your attention before this can be signed.</p>
      <ul className="list-inside list-disc space-y-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        {error.findings.map((finding, index) => (
          <li key={`${finding.code}-${index}`}>{describeFinding(finding)}</li>
        ))}
      </ul>
      {askAllergy && (
        <label className="flex items-start gap-2 text-sm text-charcoal-ink dark:text-night-ink">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={allergiesConfirmed}
            onChange={(event) => onAllergiesConfirmedChange(event.target.checked)}
          />
          I checked the allergy list with the patient.
        </label>
      )}
      {askReason && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-override-reason`} className="text-xs">
            Reason for going ahead (required)
          </Label>
          <Textarea
            id={`${idPrefix}-override-reason`}
            value={overrideReason}
            onChange={(event) => onOverrideReasonChange(event.target.value)}
            placeholder="Say why it is safe to continue. This is kept on the prescription."
            maxLength={500}
          />
        </div>
      )}
    </div>
  );
}
