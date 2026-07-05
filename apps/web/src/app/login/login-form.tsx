"use client";

import { useActionState, useState } from "react";
import { signInWithEmail, requestPhoneOtp, verifyPhoneOtp } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [tab, setTab] = useState<"email" | "phone">("email");

  return (
    <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
      <div className="mb-6 grid grid-cols-2 rounded-lg bg-charcoal-ink/5 p-1 text-sm font-medium">
        {(["email", "phone"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "rounded-md py-1.5 capitalize transition-colors",
              tab === value ? "bg-white text-brand-green shadow-sm" : "text-charcoal-ink/60"
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {tab === "email" ? (
        <EmailLoginForm redirectTo={redirectTo} />
      ) : (
        <PhoneLoginForm redirectTo={redirectTo} />
      )}
    </div>
  );
}

function EmailLoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(signInWithEmail, undefined);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function PhoneLoginForm({ redirectTo }: { redirectTo?: string }) {
  const [requestState, requestAction, requestPending] = useActionState(
    requestPhoneOtp,
    undefined
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyPhoneOtp,
    undefined
  );

  const phone = verifyState?.phone ?? requestState?.phone;
  const showVerify = requestState?.step === "verify" || verifyState?.step === "verify";

  if (showVerify && phone) {
    return (
      <form action={verifyAction} className="space-y-4">
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
        <p className="text-sm text-charcoal-ink/60">
          Enter the 6-digit code sent to <span className="font-medium">{phone}</span>.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="token">Verification code</Label>
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            required
          />
        </div>
        {verifyState?.error && <p className="text-sm text-red-600">{verifyState.error}</p>}
        <Button type="submit" className="w-full" disabled={verifyPending}>
          {verifyPending ? "Verifying…" : "Verify & sign in"}
        </Button>
      </form>
    );
  }

  return (
    <form action={requestAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone number</Label>
        <Input id="phone" name="phone" type="tel" placeholder="+234XXXXXXXXXX" required />
      </div>
      {requestState?.error && <p className="text-sm text-red-600">{requestState.error}</p>}
      <Button type="submit" className="w-full" disabled={requestPending}>
        {requestPending ? "Sending code…" : "Send code"}
      </Button>
    </form>
  );
}
