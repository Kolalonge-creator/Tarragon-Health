"use client";

import { useActionState } from "react";
import { Check, Gift } from "lucide-react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { NIGERIAN_STATES } from "@/lib/nigeria-states";
import { signUp } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const FIELD_CLASS = "h-11 rounded-xl";

export function SignupForm({
  refCode,
  intent,
}: {
  refCode?: string;
  /** Carried through auth metadata so onboarding can land the visitor on what
   *  they came for. Hidden field, same mechanism as refCode. */
  intent?: "health_check";
}) {
  const [state, formAction, pending] = useActionState(signUp, undefined);

  if (state?.success) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-green/10">
          <Check className="h-6 w-6 text-brand-green" strokeWidth={2.5} />
        </div>
        <p className="text-sm text-charcoal-ink/80">
          Check your email to confirm your account, then sign in.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
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
            className={FIELD_CLASS}
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
            className={FIELD_CLASS}
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
          autoComplete="email"
          required
          className={FIELD_CLASS}
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
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel-national"
            placeholder="XXXXXXXXXX"
            required
            className={FIELD_CLASS}
          />
        </div>
        <p className="text-xs text-charcoal-ink/50">
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
          defaultValue=""
          className={FIELD_CLASS}
        >
          <option value="">Prefer not to say</option>
          {NIGERIAN_STATES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <p className="text-xs text-charcoal-ink/50">
          Helps us show what&apos;s available near you. You can add or change this anytime.
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
          className={FIELD_CLASS}
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
