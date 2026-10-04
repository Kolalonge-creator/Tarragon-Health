"use client";

import { useActionState } from "react";
import { Button } from "@tarragon/ui/components/button";
import { Input } from "@tarragon/ui/components/input";
import { Label } from "@tarragon/ui/components/label";
import { FormError, fieldErrorId, fieldErrorProps } from "@tarragon/ui/components/form-error";
import { verifyConsoleMfaChallenge } from "./actions";

export function MfaChallengeForm({
  redirectTo,
  labels,
}: {
  redirectTo?: string;
  labels: { code: string; verify: string; verifying: string };
}) {
  const [state, formAction, pending] = useActionState(verifyConsoleMfaChallenge, undefined);
  const errorId = fieldErrorId("console-mfa-code");

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
      <div className="space-y-1.5">
        <Label htmlFor="console-mfa-code" className="text-charcoal-ink/70">
          {labels.code}
        </Label>
        <Input
          id="console-mfa-code"
          name="code"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          autoFocus
          required
          className="h-11 rounded-xl"
          {...fieldErrorProps(errorId, Boolean(state?.error))}
        />
      </div>
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={pending}>
        {pending ? labels.verifying : labels.verify}
      </Button>
    </form>
  );
}
