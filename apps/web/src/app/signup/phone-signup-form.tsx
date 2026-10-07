"use client";

import { useActionState } from "react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { maskPhone } from "@tarragon/auth/phone";
import { t, type Locale } from "@tarragon/i18n";
import { NIGERIAN_STATES } from "@/lib/nigeria-states";
import { signUpWithPhone, verifySignupPhone } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";
import { ResendCode } from "@/components/auth/resend-code";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/password";

const FIELD_CLASS = "h-11 rounded-xl";

/**
 * Phone-first sign-up (S03, functions 1.1 and 1.2). Step 1 collects the details and creates the account on the
 * phone identity; step 2 is the six-digit code. The account cannot be used until step 2 succeeds, which the server
 * enforces (phone confirmations on); this component only shows the steps, it never decides who is verified.
 */
export function PhoneSignupForm({
  locale,
  refCode,
  intent,
  redirectTo,
  inviteOnly,
}: {
  locale: Locale;
  refCode?: string;
  /** Show the invite code box (only while sign-up is invite-only). */
  inviteOnly?: boolean;
  intent?: "health_check" | "support";
  redirectTo?: string;
}) {
  const [signupState, signupAction, signupPending] = useActionState(signUpWithPhone, undefined);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifySignupPhone, undefined);
  const errorId = fieldErrorId("phone-signup");
  const verifyErrorId = fieldErrorId("phone-signup-code");
  const invalid = (field: string) => Boolean(signupState?.error) && signupState?.field === field;

  const phone = verifyState?.phone ?? signupState?.phone;
  const verifying = signupState?.step === "verify" || verifyState?.step === "verify";
  const landing = verifyState?.redirectTo ?? signupState?.redirectTo ?? redirectTo;

  if (verifying && phone) {
    return (
      <div className="space-y-5">
        <form action={verifyAction} className="space-y-5">
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="redirectTo" value={landing ?? ""} />
          <div>
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">{t("auth.verify.title", locale)}</h2>
            <p className="mt-1 text-sm text-charcoal-ink/60">
              {t("auth.verify.sent", locale, { phone: maskPhone(phone) })}
            </p>
          </div>
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
        <ResendCode phone={phone} locale={locale} redirectTo={landing} />
        <p className="text-center text-xs text-charcoal-ink/60">
          <a href="/signup" className="underline">
            {t("auth.verify.wrong_number", locale)}
          </a>
        </p>
      </div>
    );
  }

  return (
    <form action={signupAction} className="space-y-5">
      {intent && <input type="hidden" name="intent" value={intent} />}
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
      {refCode && <input type="hidden" name="refCode" value={refCode} />}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="firstName" className="text-charcoal-ink/70">
            {t("auth.field.first_name", locale)}
          </Label>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            className={FIELD_CLASS}
            {...fieldErrorProps(errorId, invalid("firstName"))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName" className="text-charcoal-ink/70">
            {t("auth.field.last_name", locale)}
          </Label>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
            className={FIELD_CLASS}
            {...fieldErrorProps(errorId, invalid("lastName"))}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone" className="text-charcoal-ink/70">
          {t("auth.field.phone", locale)}
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
            {...fieldErrorProps(errorId, invalid("phone") || invalid("countryCode"), PHONE_HINT_ID)}
          />
        </div>
        <PhoneNumberHint />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="state" className="text-charcoal-ink/70">
          State (optional)
        </Label>
        <Select id="state" name="state" autoComplete="address-level1" defaultValue="" className={FIELD_CLASS}>
          <option value="">Prefer not to say</option>
          {NIGERIAN_STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      {inviteOnly && (
        <div className="space-y-1.5">
          <Label htmlFor="inviteCode" className="text-charcoal-ink/70">
            {t("signup.invite_code_label", locale)}
          </Label>
          <Input
            id="inviteCode"
            name="inviteCode"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={32}
            disabled={signupPending}
            className={FIELD_CLASS}
            {...fieldErrorProps(errorId, invalid("inviteCode"), "signup-invite-hint")}
          />
          <p id="signup-invite-hint" className="text-xs text-charcoal-ink/50">
            {t("signup.invite_code_hint", locale)}
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-charcoal-ink/70">
          {t("auth.field.password", locale)}
        </Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          className={FIELD_CLASS}
          {...fieldErrorProps(errorId, invalid("password"), "phone-signup-password-rule")}
        />
        <p id="phone-signup-password-rule" className="text-xs text-charcoal-ink/50">
          {t("auth.password.rule", locale, { min: PASSWORD_MIN_LENGTH })}
        </p>
      </div>
      <FormError id={errorId} message={signupState?.error} />
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={signupPending}>
        {signupPending ? t("auth.signup.submitting", locale) : t("auth.signup.submit", locale)}
      </Button>
    </form>
  );
}
