"use client";

import { useActionState } from "react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { signUp } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, undefined);

  if (state?.success) {
    return (
      <p className="rounded-lg bg-brand-green/10 p-4 text-sm text-brand-green">
        Check your email to confirm your account, then sign in.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">First name</Label>
          <Input id="firstName" name="firstName" autoComplete="given-name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Last name</Label>
          <Input id="lastName" name="lastName" autoComplete="family-name" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
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
        <p className="text-xs text-charcoal-ink/60">
          Living abroad and registering a family member? Choose their country code.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
