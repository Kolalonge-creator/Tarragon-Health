"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { signInWithEmail, signInWithPhonePassword, requestPhoneOtp, verifyPhoneOtp } from "./actions";
import { maskPhone } from "@tarragon/auth/phone";
import { t, type Locale } from "@tarragon/i18n";
import { ResendCode } from "@/components/auth/resend-code";
import { LanguageSwitch } from "@/components/auth/language-switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";
import { cn } from "@/lib/utils";

const FIELD_CLASS = "h-11 rounded-xl";

export function LoginForm({
  redirectTo,
  locale = "en",
  pidginEnabled = true,
}: {
  redirectTo?: string;
  locale?: Locale;
  pidginEnabled?: boolean;
}) {
  const [tab, setTab] = useState<"email" | "phone">("email");

  return (
    <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7">
      <div className="mb-4">
        <LanguageSwitch locale={locale} pidginEnabled={pidginEnabled} />
      </div>
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
        <PhoneLoginForm redirectTo={redirectTo} locale={locale} />
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

/** The six-digit code step, shared by code sign-in and by "this number was never confirmed". */
function VerifyCodeForm({
  phone,
  redirectTo,
  locale,
  notice,
  allowResend,
}: {
  phone: string;
  redirectTo?: string;
  locale: Locale;
  notice?: string;
  allowResend: boolean;
}) {
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyPhoneOtp, undefined);
  const verifyErrorId = fieldErrorId("login-token");
  const shownPhone = verifyState?.phone ?? phone;

  return (
    <div className="space-y-5">
      <form action={verifyAction} className="space-y-5">
        <input type="hidden" name="phone" value={shownPhone} />
        <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
        {notice && (
          <p role="status" className="rounded-xl bg-sprout-gold/10 p-3 text-sm text-charcoal-ink/80">
            {notice}
          </p>
        )}
        <p className="text-sm text-charcoal-ink/60">{t("auth.verify.sent", locale, { phone: maskPhone(shownPhone) })}</p>
        <div className="space-y-1.5">
          <Label htmlFor="token" className="text-charcoal-ink/70">
            {t("auth.field.code", locale)}
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
          {verifyPending ? t("auth.verify.submitting", locale) : t("auth.verify.submit", locale)}
        </Button>
      </form>
      {allowResend && <ResendCode phone={shownPhone} locale={locale} redirectTo={redirectTo} />}
    </div>
  );
}

function PhoneCountryField({ errorId, invalid }: { errorId: string; invalid: boolean }) {
  return (
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
          {...fieldErrorProps(errorId, invalid, PHONE_HINT_ID)}
        />
      </div>
      <PhoneNumberHint />
    </div>
  );
}

/** Phone tab: password by default (S03, function 1.3), with the existing code-by-SMS path one click away. */
function PhoneLoginForm({ redirectTo, locale }: { redirectTo?: string; locale: Locale }) {
  const [method, setMethod] = useState<"password" | "code">("password");

  return (
    <div className="space-y-5">
      <div role="tablist" className="grid grid-cols-2 gap-2 text-sm">
        {(["password", "code"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={method === value}
            onClick={() => setMethod(value)}
            className={cn(
              "rounded-lg border py-1.5 transition-colors",
              method === value
                ? "border-brand-green text-brand-green"
                : "border-charcoal-ink/10 text-charcoal-ink/60"
            )}
          >
            {t(value === "password" ? "auth.signin.method_password" : "auth.signin.method_code", locale)}
          </button>
        ))}
      </div>
      {method === "password" ? (
        <PhonePasswordLoginForm redirectTo={redirectTo} locale={locale} />
      ) : (
        <PhoneCodeLoginForm redirectTo={redirectTo} locale={locale} />
      )}
    </div>
  );
}

function PhonePasswordLoginForm({ redirectTo, locale }: { redirectTo?: string; locale: Locale }) {
  const [state, formAction, pending] = useActionState(signInWithPhonePassword, undefined);
  const errorId = fieldErrorId("login-phone-password");

  if (state?.step === "verify" && state.phone) {
    return (
      <VerifyCodeForm phone={state.phone} redirectTo={redirectTo} locale={locale} notice={state.notice} allowResend />
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
      <PhoneCountryField errorId={errorId} invalid={Boolean(state?.error) && state?.field === "phone"} />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="text-charcoal-ink/70">
            {t("auth.field.password", locale)}
          </Label>
          <Link href="/forgot-password" className="text-sm font-medium text-brand-green hover:underline">
            {t("auth.signin.forgot", locale)}
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          className={FIELD_CLASS}
          {...fieldErrorProps(errorId, Boolean(state?.error) && state?.field !== "phone")}
        />
      </div>
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={pending}>
        {pending ? t("auth.signin.submitting", locale) : t("auth.signin.submit", locale)}
      </Button>
    </form>
  );
}

function PhoneCodeLoginForm({ redirectTo, locale }: { redirectTo?: string; locale: Locale }) {
  const [requestState, requestAction, requestPending] = useActionState(requestPhoneOtp, undefined);
  const requestErrorId = fieldErrorId("login-phone");

  if (requestState?.step === "verify" && requestState.phone) {
    return <VerifyCodeForm phone={requestState.phone} redirectTo={redirectTo} locale={locale} allowResend={false} />;
  }

  return (
    <form action={requestAction} className="space-y-5">
      <PhoneCountryField errorId={requestErrorId} invalid={Boolean(requestState?.error)} />
      <FormError id={requestErrorId} message={requestState?.error} />
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={requestPending}>
        {requestPending ? "Sending code…" : t("auth.signin.send_code", locale)}
      </Button>
    </form>
  );
}
