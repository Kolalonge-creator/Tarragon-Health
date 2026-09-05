"use client";

import { useState, type FormEvent } from "react";
import { useJoinWithEmployerCode } from "@/lib/queries/employer-accounts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

/**
 * public.employer_join_with_code raises four distinct, already-human messages
 * (see migration 20260829093043). Those are safe to show; anything else
 * reaching here is a PostgREST/transport failure whose message is a provider
 * internal ("permission denied for function", a JWT complaint, a fetch
 * error), which used to be rendered verbatim under this field.
 */
const KNOWN_JOIN_ERRORS: Record<string, string> = {
  "sign in first": "Your session has expired. Sign in again, then try the code.",
  "that organisation code is not valid":
    "That code is not valid. Check it with whoever gave it to you and try again.",
  "only a patient account can join an employer programme":
    "Only a patient account can join an employer programme.",
  "this account is already attached to an organisation":
    "This account is already attached to an organisation.",
};

function joinErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim().toLowerCase() : "";
  return (
    KNOWN_JOIN_ERRORS[raw] ?? "We could not check that code just then. Please try again."
  );
}

/** Module 26 §26.4 — the organisation-code self-serve join route. Only shown
 * to a patient not already attached to a real employer/HMO/clinic (the
 * caller checks that before rendering this — see public.employer_join_with_code,
 * which enforces the same rule server-side regardless). */
export function JoinEmployerCodeForm() {
  const joinWithCode = useJoinWithEmployerCode();
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState(false);
  const errorId = fieldErrorId("employer_code");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    joinWithCode.mutate(code.trim(), { onSuccess: () => setJoined(true) });
  }

  if (joined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Employer programme joined</CardTitle>
        </CardHeader>
        <CardContent>
          <FormSuccess
            className="text-green-700"
            message="You're now enrolled. Reload to see any benefits it includes."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join an employer programme</CardTitle>
        <CardDescription>Have an organisation code from your employer? Enter it here to join.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="employer_code">Organisation code</Label>
            <Input
              id="employer_code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD1234"
              className="font-mono uppercase tracking-widest"
              maxLength={8}
              autoComplete="off"
              {...fieldErrorProps(errorId, Boolean(joinWithCode.error), "employer-code-hint")}
            />
            <p id="employer-code-hint" className="text-xs text-charcoal-ink/60">
              Eight characters, letters and numbers.
            </p>
          </div>
          <Button type="submit" size="sm" disabled={joinWithCode.isPending}>
            {joinWithCode.isPending ? "Joining…" : "Join"}
          </Button>
        </form>
        <FormError
          id={errorId}
          message={joinWithCode.error ? joinErrorMessage(joinWithCode.error) : null}
          className="mt-2"
        />
      </CardContent>
    </Card>
  );
}
