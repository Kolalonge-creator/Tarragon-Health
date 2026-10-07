"use client";

import { useActionState } from "react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { maskPhone } from "@tarragon/auth/phone";
import { t, type Locale } from "@tarragon/i18n";
import { confirmPhoneChange, requestPhoneChange } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";

/**
 * Change the sign-in phone number (S03). Two steps, and the stored number only changes after the code sent to the NEW
 * number is entered, so a mistyped number is never attached to an account.
 */
export function ChangePhoneCard({ locale = "en" }: { locale?: Locale }) {
  const [requestState, requestAction, requestPending] = useActionState(requestPhoneChange, undefined);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmPhoneChange, undefined);
  const requestErrorId = fieldErrorId("change-phone");
  const confirmErrorId = fieldErrorId("change-phone-code");

  const phone = confirmState?.phone ?? requestState?.phone;
  const verifying = (requestState?.step === "verify" || confirmState?.step === "verify") && !confirmState?.success;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.phone_change.title", locale)}</CardTitle>
        <CardDescription>{t("auth.phone_change.body", locale)}</CardDescription>
      </CardHeader>
      <CardContent>
        {confirmState?.success ? (
          <FormSuccess message={t("auth.phone_change.done", locale)} />
        ) : verifying && phone ? (
          <form action={confirmAction} className="max-w-sm space-y-4">
            <input type="hidden" name="phone" value={phone} />
            <p className="text-sm text-charcoal-ink/60">{t("auth.verify.sent", locale, { phone: maskPhone(phone) })}</p>
            <div className="space-y-1.5">
              <Label htmlFor="change-phone-token">{t("auth.field.code", locale)}</Label>
              <Input
                id="change-phone-token"
                name="token"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                required
                {...fieldErrorProps(confirmErrorId, Boolean(confirmState?.error))}
              />
            </div>
            <FormError id={confirmErrorId} message={confirmState?.error} />
            <Button type="submit" disabled={confirmPending}>
              {confirmPending ? t("auth.verify.submitting", locale) : t("auth.phone_change.confirm", locale)}
            </Button>
          </form>
        ) : (
          <form action={requestAction} className="max-w-sm space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t("auth.field.phone", locale)}</Label>
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
                <Input {...phoneInputProps} {...fieldErrorProps(requestErrorId, Boolean(requestState?.error), PHONE_HINT_ID)} />
              </div>
              <PhoneNumberHint />
            </div>
            <FormError id={requestErrorId} message={requestState?.error} />
            <Button type="submit" disabled={requestPending}>
              {t("auth.phone_change.submit", locale)}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
