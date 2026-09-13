"use client";

import { useActionState } from "react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { startGuestCheckout, verifyGuestCheckoutOtp } from "@/lib/billing/guest-checkout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";

const FIELD_CLASS = "h-11 rounded-xl";

/**
 * Buy-without-an-account form, two steps like PhoneLoginForm: request a
 * code, then type it in. Nothing is charged and no session exists until
 * the code is verified — see lib/billing/guest-checkout.ts for why this is
 * a typed code rather than a clickable link.
 */
export function GuestCheckoutForm({ code }: { code: string }) {
  const [requestState, requestAction, requestPending] = useActionState(
    startGuestCheckout.bind(null, code),
    undefined
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyGuestCheckoutOtp.bind(null, code),
    undefined
  );

  const email = verifyState?.email ?? requestState?.email;
  const showVerify = requestState?.step === "verify" || verifyState?.step === "verify";

  const verifyErrorId = fieldErrorId("guest-checkout-verify");
  const requestErrorId = fieldErrorId("guest-checkout-request");

  if (showVerify && email) {
    return (
      <form
        action={verifyAction}
        className="space-y-5 rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm sm:p-7"
      >
        <input type="hidden" name="email" value={email} />
        <p className="text-sm leading-relaxed text-charcoal-ink/70">
          We emailed a code to <span className="font-medium">{email}</span>. Enter it
          below — nothing is charged until you finish on the payment page after this.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="token" className="text-charcoal-ink/70">
            Verification code
          </Label>
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            maxLength={8}
            autoComplete="one-time-code"
            required
            className={FIELD_CLASS}
            {...fieldErrorProps(verifyErrorId, Boolean(verifyState?.error))}
          />
        </div>
        <FormError id={verifyErrorId} message={verifyState?.error} />
        <Button type="submit" size="lg" className="w-full rounded-xl" disabled={verifyPending}>
          {verifyPending ? "Checking…" : "Verify & continue"}
        </Button>
      </form>
    );
  }

  return (
    <form
      action={requestAction}
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
          {...fieldErrorProps(requestErrorId, requestState?.field === "fullName")}
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
          {...fieldErrorProps(requestErrorId, requestState?.field === "email")}
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

      <FormError id={requestErrorId} message={requestState?.error} />

      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={requestPending}>
        {requestPending ? "Sending your code…" : "Continue by email"}
      </Button>

      <p className="text-center text-xs leading-relaxed text-charcoal-ink/50">
        This creates a Tarragon Health account for you, free, with no password to set — you sign
        in with an emailed code from now on. Nothing is charged until you finish on the payment
        page.
      </p>
    </form>
  );
}
