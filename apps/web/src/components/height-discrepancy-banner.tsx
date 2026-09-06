"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveHeightDiscrepancy } from "@/app/(dashboard)/patient/actions";
import { Button } from "@/components/ui/button";

/**
 * Shown on the BMI trend when profiles.height_cm and the latest
 * risk-assessment height answer disagree (lib/health-metrics/height.ts).
 * Software never guesses which one is right — the patient picks, and that
 * becomes the recorded height going forward.
 */
export function HeightDiscrepancyBanner({
  patientId,
  profileHeightCm,
  questionnaireHeightCm,
}: {
  patientId: string;
  profileHeightCm: number;
  questionnaireHeightCm: number;
}) {
  const [state, formAction, pending] = useActionState(resolveHeightDiscrepancy, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["height-status", patientId] });
      queryClient.invalidateQueries({ queryKey: ["bmi-trend", patientId] });
    }
  }, [state?.success, patientId, queryClient]);

  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p>
        We have two different heights on file: <strong>{profileHeightCm} cm</strong> on your profile
        and <strong>{questionnaireHeightCm} cm</strong> from your risk assessment. Which one is right?
      </p>
      <div className="flex flex-wrap gap-2">
        <form action={formAction}>
          <input type="hidden" name="height_cm" value={profileHeightCm} />
          <Button type="submit" size="sm" disabled={pending}>
            Use {profileHeightCm} cm
          </Button>
        </form>
        <form action={formAction}>
          <input type="hidden" name="height_cm" value={questionnaireHeightCm} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Use {questionnaireHeightCm} cm
          </Button>
        </form>
      </div>
      {state?.error && <p className="text-red-600">{state.error}</p>}
    </div>
  );
}
