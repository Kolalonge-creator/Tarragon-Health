"use client";

import { t } from "@tarragon/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Optional programme code at sign-up (S03b, spec 1.8). The code is checked when the form is sent, and held with the new account.
 * Nothing is claimed or joined until the phone or email is verified. Kept in its own file so the sign-up forms change by one line.
 */
export function CohortCodeField({ idPrefix, className }: { idPrefix: string; className?: string }) {
  const id = `${idPrefix}-cohort-code`;
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-charcoal-ink/70">
        {t("auth.signup.programme_code")}
      </Label>
      <Input
        id={id}
        name="cohortCode"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={12}
        aria-describedby={hintId}
        className={className}
      />
      <p id={hintId} className="text-xs text-charcoal-ink/50">
        {t("auth.signup.programme_code_hint")}
      </p>
    </div>
  );
}
