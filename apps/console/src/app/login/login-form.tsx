"use client";

import { useActionState } from "react";
import { Button } from "@tarragon/ui/components/button";
import { Input } from "@tarragon/ui/components/input";
import { Label } from "@tarragon/ui/components/label";
import { FormError, fieldErrorId, fieldErrorProps } from "@tarragon/ui/components/form-error";
import { signInToConsole } from "./actions";

export type LoginFormLabels = {
  email: string;
  password: string;
  submit: string;
  submitting: string;
  forgot: string;
};

export function LoginForm({
  redirectTo,
  labels,
  forgotUrl,
}: {
  redirectTo?: string;
  labels: LoginFormLabels;
  forgotUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(signInToConsole, undefined);
  const errorId = fieldErrorId("console-login");

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
      <div className="space-y-1.5">
        <Label htmlFor="console-email" className="text-charcoal-ink/70">
          {labels.email}
        </Label>
        <Input
          id="console-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-11 rounded-xl"
          {...fieldErrorProps(errorId, state?.field === "email")}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="console-password" className="text-charcoal-ink/70">
          {labels.password}
        </Label>
        <Input
          id="console-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11 rounded-xl"
          {...fieldErrorProps(errorId, state?.field === "password")}
        />
      </div>
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={pending}>
        {pending ? labels.submitting : labels.submit}
      </Button>
      {forgotUrl ? (
        <p className="text-center text-sm">
          <a href={forgotUrl} className="font-medium text-brand-green hover:underline">
            {labels.forgot}
          </a>
        </p>
      ) : null}
    </form>
  );
}
