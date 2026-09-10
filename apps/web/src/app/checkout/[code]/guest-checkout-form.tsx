"use client";

import { useActionState } from "react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { startGuestCheckout } from "@/lib/billing/guest-checkout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";

const FIELD_CLASS = "h-11 rounded-xl";

/**
 * Buy-without-an-account form. Submitting sends a real sign-in link to the
 * email given (see startGuestCheckout) — nothing is charged and no session
 * exists yet at this point; clicking that link is what continues the
 * purchase (/checkout/continue).
 */
export function GuestCheckoutForm({ code }: { code: string }) {
  const [state, formAction, pending] = useActionState(
    startGuestCheckout.bind(null, code),
    undefined
  );

  const errorId = fieldErrorId("guest-checkout-form");

  if (state?.sent) {
    return (
      <div className="rounded-2xl border border-brand-green/30 bg-soft-sage p-6 text-center">
        <p className="font-heading text-lg font-semibold text-charcoal-ink">Check your email</p>
        <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">
          We sent a link to finish this purchase. Open it on this device to continue straight to
          payment — nothing is charged until then.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-5 rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7"
    >
      <div className="space-y-1.5">
        <Label htmlFor="fullName" className="text-charcoal-ink/70">
          Full name
        </Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          className={FIELD_CLASS}
          {...fieldErrorProps(errorId, state?.field === "fullName")}
        />
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
          className={FIELD_CLASS}
          {...fieldErrorProps(errorId, state?.field === "email")}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone" className="text-charcoal-ink/70">
          Phone <span className="font-normal text-charcoal-ink/50">(optional)</span>
        </Label>
        <div className="flex gap-2">
          <Select
            name="countryCode"
            defaultValue="+234"
            className="h-11 w-28 shrink-0 rounded-xl"
            aria-label="Country code"
          >
            {COUNTRY_CALLING_CODES.map((c) => (
              <option key={c.iso} value={c.dialCode}>
                {c.dialCode} {c.label}
              </option>
            ))}
          </Select>
          <Input
            {...phoneInputProps}
            required={false}
            aria-describedby={PHONE_HINT_ID}
            className={FIELD_CLASS}
          />
        </div>
        <PhoneNumberHint />
      </div>

      <FormError id={errorId} message={state?.error} />

      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={pending}>
        {pending ? "Sending your link…" : "Continue by email"}
      </Button>

      <p className="text-center text-xs leading-relaxed text-charcoal-ink/50">
        This creates a Tarragon Health account for you, free, with no password to set — you sign
        in from your email from now on. Nothing is charged until you finish on the payment page.
      </p>
    </form>
  );
}
