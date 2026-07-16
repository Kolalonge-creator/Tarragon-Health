"use client";

import { useActionState, useEffect } from "react";
import { saveDemographics } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Step 2 of onboarding. DOB + sex are required to finish onboarding (the
 * risk/screening engines are age/sex-dependent). Pre-filled from the profile
 * when already set, so returning to this step doesn't blank it.
 */
export function DemographicsForm({
  initial,
  onComplete,
}: {
  initial: { dateOfBirth: string | null; sex: "male" | "female" | null };
  onComplete: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveDemographics, undefined);

  useEffect(() => {
    if (state?.success) onComplete();
  }, [state?.success, onComplete]);

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
    >
      <div>
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">About you</h2>
        <p className="mt-1 text-sm text-charcoal-ink/60">
          We use these to tailor your risk checks and screening reminders.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="dateOfBirth">Date of birth</Label>
          <Input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={initial.dateOfBirth ?? ""}
            max={new Date().toISOString().slice(0, 10)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sex">Sex</Label>
          <Select id="sex" name="sex" defaultValue={initial.sex ?? ""} required>
            <option value="" disabled>
              Select…
            </option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </div>
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save & continue"}
      </Button>
    </form>
  );
}
