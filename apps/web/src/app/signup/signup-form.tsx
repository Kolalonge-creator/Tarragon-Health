"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Gift } from "lucide-react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { NIGERIAN_STATES } from "@/lib/nigeria-states";
import { signUp } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE_HINT } from "@/lib/validation/password";

const FIELD_CLASS = "h-11 rounded-xl";

export function SignupForm({
  refCode,
  intent,
}: {
  refCode?: string;
  /** Carried through auth metadata so onboarding can land the visitor on what
   *  they came for. Hidden field, same mechanism as refCode. */
  intent?: "health_check" | "support";
}) {
  const [state, formAction, pending] = useActionState(signUp, undefined);
  const errorId = fieldErrorId("signup");
  // Server actions here return the failing field name alongside the message
  // (see firstIssue), so only that control is marked invalid.
  const invalid = (field: string) => Boolean(state?.error) && state?.field === field;

  // React resets every uncontrolled field in an action-bound <form> once the
  // action returns, success or failure — so a single bad phone number wiped
  // name/email/password too and made the visitor start over. Re-keying the
  // form after a failed attempt forces a remount, which is what lets fresh
  // `defaultValue`s below (from the server's echoed `values`) actually take.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (state?.error) setAttempt((n) => n + 1);
  }, [state]);
  const values = state?.values;

  if (state?.success) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/10">
          <Check className="h-6 w-6 text-brand-green" strokeWidth={2.5} />
        </div>
        <p role="status" className="text-sm text-charcoal-ink/80">
          Check your email to confirm your account, then sign in.
        </p>
      </div>
    );
  }

  return (
    <form key={attempt} action={formAction} className="space-y-5">
      {intent && <input type="hidden" name="intent" value={intent} />}
      {refCode && (
        <>
          <input type="hidden" name="refCode" value={refCode} />
          <div className="flex items-start gap-2.5 rounded-xl border border-sprout-gold/30 bg-sprout-gold/10 p-3">
            <Gift className="mt-0.5 h-4 w-4 shrink-0 text-sprout-gold" strokeWidth={2} />
            <p className="text-xs text-charcoal-ink/70">
              Referral code <span className="font-semibold text-charcoal-ink">{refCode}</span>{" "}
              will be applied once your account is confirmed.
            </p>
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="firstName" className="text-charcoal-ink/70">
            First name
          </Label>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            defaultValue={values?.firstName}
            className={FIELD_CLASS}
            {...fieldErrorProps(errorId, invalid("firstName"))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName" className="text-charcoal-ink/70">
            Last name
          </Label>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
            defaultValue={values?.lastName}
            className={FIELD_CLASS}
            {...fieldErrorProps(errorId, invalid("lastName"))}
          />
        </div>
      </div>
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
          defaultValue={values?.email}
          className={FIELD_CLASS}
          {...fieldErrorProps(errorId, invalid("email"))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone" className="text-charcoal-ink/70">
          Phone number
        </Label>
        <div className="flex gap-2">
          <Select
            id="countryCode"
            name="countryCode"
            autoComplete="tel-country-code"
            defaultValue={values?.countryCode || COUNTRY_CALLING_CODES[0].dialCode}
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
            defaultValue={values?.phone}
            className={FIELD_CLASS}
            {...fieldErrorProps(
              errorId,
              invalid("phone") || invalid("countryCode"),
              PHONE_HINT_ID,
              "signup-phone-diaspora-hint"
            )}
          />
        </div>
        <PhoneNumberHint />
        <p id="signup-phone-diaspora-hint" className="text-xs text-charcoal-ink/50">
          Living abroad and registering a family member? Choose their country code.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="state" className="text-charcoal-ink/70">
          State (optional)
        </Label>
        <Select
          id="state"
          name="state"
          autoComplete="address-level1"
          defaultValue={values?.state ?? ""}
          className={FIELD_CLASS}
          aria-describedby="signup-state-hint"
        >
          <option value="">Prefer not to say</option>
          {NIGERIAN_STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <p id="signup-state-hint" className="text-xs text-charcoal-ink/50">
          Helps us show what&apos;s available near you. You can add or change this at any time.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-charcoal-ink/70">
          Password
        </Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          className={FIELD_CLASS}
          {...fieldErrorProps(errorId, invalid("password"), "signup-password-rule")}
        />
        {/* The rule, before submit rather than after a rejection. Comes from
            lib/validation/password.ts, the same constant the schema enforces,
            so the two cannot drift. */}
        <p id="signup-password-rule" className="text-xs text-charcoal-ink/50">
          {PASSWORD_RULE_HINT}
        </p>
      </div>
      <FormError id={errorId} message={state?.error} />
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
