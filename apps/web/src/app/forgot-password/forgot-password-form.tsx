"use client";

import { useActionState, useState } from "react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { requestPasswordResetEmail, requestPhoneReset, verifyPhoneReset } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function ForgotPasswordForm() {
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

      {tab === "email" ? <EmailResetForm /> : <PhoneResetForm />}
    </div>
  );
}

function EmailResetForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetEmail, undefined);

  if (state?.success) {
    return (
      <p className="text-sm text-charcoal-ink/70">
        If an account exists for that email, we&apos;ve sent a link to reset your password.
        Check your inbox (and spam folder) — the link works for a limited time.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}

function PhoneResetForm() {
  const [requestState, requestAction, requestPending] = useActionState(
    requestPhoneReset,
    undefined
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyPhoneReset, undefined);

  const phone = verifyState?.phone ?? requestState?.phone;
  const showVerify = requestState?.step === "verify" || verifyState?.step === "verify";

  if (showVerify && phone) {
    return (
      <form action={verifyAction} className="space-y-4">
        <input type="hidden" name="phone" value={phone} />
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
          {verifyPending ? "Verifying…" : "Verify code"}
        </Button>
      </form>
    );
  }

  return (
    <form action={requestAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone number</Label>
        <div className="flex gap-2">
          <Select
            id="countryCode"
            name="countryCode"
            autoComplete="tel-country-code"
            defaultValue={COUNTRY_CALLING_CODES[0].dialCode}
            className="w-auto shrink-0"
            aria-label="Country code"
            required
          >
            {COUNTRY_CALLING_CODES.map((country) => (
              <option key={country.iso} value={country.dialCode}>
                {country.label} ({country.dialCode})
              </option>
            ))}
          </Select>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel-national"
            placeholder="XXXXXXXXXX"
            required
          />
        </div>
      </div>
      {requestState?.error && <p className="text-sm text-red-600">{requestState.error}</p>}
      <Button type="submit" className="w-full" disabled={requestPending}>
        {requestPending ? "Sending code…" : "Send code"}
      </Button>
    </form>
  );
}
