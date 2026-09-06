"use client";

import { useActionState } from "react";
import { updateOwnPassword } from "./actions";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE_HINT } from "@/lib/validation/password";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(updateOwnPassword, undefined);
  const errorId = fieldErrorId("account-password");
  const invalid = (field: string) => Boolean(state?.error) && state?.field === field;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Update the password you sign in with.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="max-w-sm space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="account-password">New password</Label>
            <PasswordInput
              id="account-password"
              name="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              {...fieldErrorProps(errorId, invalid("password"), "account-password-rule")}
            />
            {/* The rule up front, from the same constant the schema enforces. */}
            <p id="account-password-rule" className="text-xs text-charcoal-ink/50">
              {PASSWORD_RULE_HINT}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-confirm-password">Confirm new password</Label>
            <PasswordInput
              id="account-confirm-password"
              name="confirmPassword"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              {...fieldErrorProps(errorId, invalid("confirmPassword"))}
            />
          </div>
          <FormError id={errorId} message={state?.error} />
          <FormSuccess message={state?.success && "Password updated."} />
          <Button type="submit" disabled={pending}>
            {pending ? "Updating…" : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
