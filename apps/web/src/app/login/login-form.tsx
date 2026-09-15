"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { signInWithEmail, requestPhoneOtp, verifyPhoneOtp } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";
import { cn } from "@/lib/utils";

const FIELD_CLASS = "h-11 rounded-xl";

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [tab, setTab] = useState<"email" | "phone">("email");

  return (
    <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7">
      <div className="mb-6 grid grid-cols-2 rounded-xl bg-charcoal-ink/5 p-1 text-sm font-medium">
        {(["email", "phone"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "rounded-lg py-1.5 capitalize transition-colors",
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
  // A sign-in failure has no single guilty field (we deliberately never say
  // which of the two was wrong), so both are marked invalid and both point at
  // the one alert.
  const errorId = fieldErrorId("login-email-form");
  const failed = Boolean(state?.error);
  const emailInvalid = failed && state?.field !== "password";
  const passwordInvalid = failed && state?.field !== "email";

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-charcoal-ink/70">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className={FIELD_CLASS}
          {...fieldErrorProps(errorId, emailInvalid)}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="text-charcoal-ink/70">
            Password
          </Label>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-brand-green hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          className={FIELD_CLASS}
          {...fieldErrorProps(errorId, passwordInvalid)}
        />
      </div>
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={pending}>
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

  const verifyErrorId = fieldErrorId("login-token");
  const requestErrorId = fieldErrorId("login-phone");

  if (showVerify && phone) {
    return (
      <form action={verifyAction} className="space-y-5">
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
        <p className="text-sm text-charcoal-ink/60">
          Enter the 6-digit code sent to <span className="font-medium">{phone}</span>.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="token" className="text-charcoal-ink/70">
            Verification code
          </Label>
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            required
            className={FIELD_CLASS}
            {...fieldErrorProps(verifyErrorId, Boolean(verifyState?.error))}
          />
        </div>
        <FormError id={verifyErrorId} message={verifyState?.error} />
        <Button type="submit" size="lg" className="w-full rounded-xl" disabled={verifyPending}>
          {verifyPending ? "Verifying…" : "Verify & sign in"}
        </Button>
      </form>
    );
  }

  return (
    <form action={requestAction} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="phone" className="text-charcoal-ink/70">
          Phone number
        </Label>
        <div className="flex gap-2">
          <Select
            id="countryCode"
            name="countryCode"
            autoComplete="tel-country-code"
            defaultValue={COUNTRY_CALLING_CODES[0].dialCode}
            className={`w-auto shrink-0 ${FIELD_CLASS}`}
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
            className={FIELD_CLASS}
            {...fieldErrorProps(requestErrorId, Boolean(requestState?.error), PHONE_HINT_ID)}
          />
        </div>
        <PhoneNumberHint />
      </div>
      <FormError id={requestErrorId} message={requestState?.error} />
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={requestPending}>
        {requestPending ? "Sending code…" : "Send code"}
      </Button>
    </form>
  );
}
