"use client";

import { useActionState, useState } from "react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { requestPasswordResetEmail, requestPhoneReset, verifyPhoneReset } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";
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
  const errorId = fieldErrorId("reset-email");

  if (state?.success) {
    return (
      <p role="status" className="text-sm text-charcoal-ink/70">
        If an account exists for that email, we&apos;ve sent a link to reset your password.
        Check your inbox, and your spam folder. The link works for a limited time.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          {...fieldErrorProps(errorId, Boolean(state?.error))}
        />
      </div>
      <FormError id={errorId} message={state?.error} />
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
  const verifyErrorId = fieldErrorId("reset-token");
  const requestErrorId = fieldErrorId("reset-phone");

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
            {...fieldErrorProps(verifyErrorId, Boolean(verifyState?.error))}
          />
        </div>
        <FormError id={verifyErrorId} message={verifyState?.error} />
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
            {...phoneInputProps}
            {...fieldErrorProps(requestErrorId, Boolean(requestState?.error), PHONE_HINT_ID)}
          />
        </div>
        <PhoneNumberHint />
      </div>
      <FormError id={requestErrorId} message={requestState?.error} />
      <Button type="submit" className="w-full" disabled={requestPending}>
        {requestPending ? "Sending code…" : "Send code"}
      </Button>
    </form>
  );
}
