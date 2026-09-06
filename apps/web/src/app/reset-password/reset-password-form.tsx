"use client";

import { useActionState } from "react";
import { updatePassword } from "./actions";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE_HINT } from "@/lib/validation/password";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, undefined);
  const errorId = fieldErrorId("reset-new-password");
  const invalid = (field: string) => Boolean(state?.error) && state?.field === field;

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
    >
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          {...fieldErrorProps(errorId, invalid("password"), "reset-password-rule")}
        />
        {/* The rule up front, from the same constant the schema enforces. */}
        <p id="reset-password-rule" className="text-xs text-charcoal-ink/50">
          {PASSWORD_RULE_HINT}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          {...fieldErrorProps(errorId, invalid("confirmPassword"))}
        />
      </div>
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
