"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";
import { savePhone } from "./phone-actions";

/**
 * Shown before the rest of onboarding to anyone with no phone number on file (in practice, someone who signed up with Google).
 * Same country-code and number fields as the sign-up form.
 */
export function PhoneStep({ firstName, asksDateOfBirth }: { firstName: string | null; asksDateOfBirth: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(savePhone, undefined);
  const errorId = fieldErrorId("onboarding-phone");

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  return (
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7">
      <div>
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink">
          {firstName ? `Welcome, ${firstName}. ` : "Welcome. "}One more detail first
        </h1>
        <p className="mt-2 text-sm text-charcoal-ink/70">
          {asksDateOfBirth
            ? "Your care team needs a phone number they can reach you on. Next you will confirm your date of birth: Tarragon is for adults aged 18 and over."
            : "We need a phone number we can reach you on."}
        </p>
      </div>
      <form action={formAction} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone number</Label>
          <div className="flex gap-2">
            <Select
              id="countryCode"
              name="countryCode"
              autoComplete="tel-country-code"
              defaultValue={COUNTRY_CALLING_CODES[0].dialCode}
              disabled={pending}
              className="h-11 w-auto shrink-0 rounded-xl"
              aria-label="Country code"
              required
              {...fieldErrorProps(errorId, state?.field === "countryCode")}
            >
              {COUNTRY_CALLING_CODES.map((country) => (
                <option key={country.iso} value={country.dialCode}>
                  {country.label} ({country.dialCode})
                </option>
              ))}
            </Select>
            <Input
              {...phoneInputProps}
              disabled={pending}
              className="h-11 rounded-xl"
              {...fieldErrorProps(errorId, Boolean(state?.error), PHONE_HINT_ID)}
            />
          </div>
          <PhoneNumberHint />
        </div>
        <FormError id={errorId} message={state?.error} />
        <Button type="submit" className="h-11 w-full rounded-xl" disabled={pending}>
          {pending ? "Saving…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
