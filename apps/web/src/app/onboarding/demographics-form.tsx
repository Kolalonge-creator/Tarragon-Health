"use client";

import { useActionState, useEffect, useRef } from "react";
import { saveDemographics } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

/**
 * Step 2 of onboarding. DOB + sex are required to finish onboarding (the
 * risk/screening engines are age/sex-dependent). Pre-filled from the profile
 * when already set, so returning to this step doesn't blank it.
 */
type Demographics = { dateOfBirth: string | null; sex: "male" | "female" | null };

export function DemographicsForm({
  initial,
  onComplete,
}: {
  initial: Demographics;
  /**
   * Hands back what was saved so the parent can re-open this step with the
   * values still in it. The parent's own `initial` is the server value from
   * page load, which is blank on a first pass, so without this a reopened
   * step would come back empty and invite a second mistyped date of birth.
   */
  onComplete: (saved: Demographics) => void;
}) {
  const [state, formAction, pending] = useActionState(saveDemographics, undefined);
  const errorId = fieldErrorId("onboarding-demographics");
  const invalid = (field: string) => Boolean(state?.error) && state?.field === field;

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.success) return;
    // Runs while the form is still mounted (the parent only collapses this
    // step as a result of this call), so the submitted values are readable.
    const data = formRef.current ? new FormData(formRef.current) : null;
    const dateOfBirth = data?.get("dateOfBirth");
    const sex = data?.get("sex");
    onComplete({
      dateOfBirth: typeof dateOfBirth === "string" && dateOfBirth ? dateOfBirth : null,
      sex: sex === "male" || sex === "female" ? sex : null,
    });
  }, [state?.success, onComplete]);

  return (
    <form
      ref={formRef}
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
            {...fieldErrorProps(errorId, invalid("dateOfBirth"), "onboarding-dob-hint")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sex">Sex</Label>
          <Select
            id="sex"
            name="sex"
            defaultValue={initial.sex ?? ""}
            required
            {...fieldErrorProps(errorId, invalid("sex"))}
          >
            <option value="" disabled>
              Select…
            </option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </div>
      </div>

      {/* Date of birth drives every risk score and screening date on the
          platform, so it is worth saying that it can be corrected. */}
      <p id="onboarding-dob-hint" className="text-xs text-charcoal-ink/50">
        Your date of birth sets your screening dates and risk checks. You can reopen this step
        and correct it before you finish.
      </p>
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save & continue"}
      </Button>
    </form>
  );
}
