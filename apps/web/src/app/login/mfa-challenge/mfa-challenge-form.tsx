"use client";

import { useActionState } from "react";
import { verifyLoginMfaChallenge } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MfaChallengeForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(verifyLoginMfaChallenge, undefined);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
      <div className="space-y-1.5">
        <Label htmlFor="mfa-challenge-code" className="text-charcoal-ink/70">
          6-digit code
        </Label>
        <Input
          id="mfa-challenge-code"
          name="code"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          autoFocus
          required
          className="h-11 rounded-xl"
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}
