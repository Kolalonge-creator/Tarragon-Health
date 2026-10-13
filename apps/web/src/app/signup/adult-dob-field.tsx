"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fieldErrorProps } from "@/components/ui/form-error";

/**
 * Date of birth for sign-up (S04b-1). Registration is for adults, so the field is required and the browser limit is
 * a convenience only: the server action and the database apply the same rule.
 */
export function AdultDobField({
  idPrefix,
  errorId,
  invalid,
  disabled,
  defaultValue,
}: {
  idPrefix: string;
  errorId: string;
  invalid: boolean;
  disabled?: boolean;
  defaultValue?: string;
}) {
  const id = `${idPrefix}-dateOfBirth`;
  const hintId = `${idPrefix}-dob-hint`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-charcoal-ink/70">
        Date of birth
      </Label>
      <Input
        id={id}
        name="dateOfBirth"
        type="date"
        autoComplete="bday"
        required
        min="1900-01-01"
        defaultValue={defaultValue}
        disabled={disabled}
        className="h-11 rounded-xl"
        {...fieldErrorProps(errorId, invalid, hintId)}
      />
      <p id={hintId} className="text-xs text-charcoal-ink/50">
        Tarragon accounts are for adults aged 18 and over.
      </p>
    </div>
  );
}
