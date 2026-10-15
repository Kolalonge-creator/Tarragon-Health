"use client";

import { useActionState } from "react";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { maskPhone } from "@tarragon/auth/phone";
import { t, type Locale } from "@tarragon/i18n";
import { confirmPhoneChange, requestPhoneChange } from "./actions";
import { confirmPhoneChangeIdentity, sendPhoneChangeConfirmationCode } from "./phone-change-confirm-actions";
import type { PhoneChangeOptions } from "@/lib/account/phone-change-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { PHONE_HINT_ID, PhoneNumberHint, phoneInputProps } from "@/components/ui/phone-field";

/**
 * Change the sign-in phone number (S03, S03b). Three steps, and nothing about the account changes until the last one:
 *  1. "Confirm it is you": a 6-digit code to the CURRENT number or the VERIFIED email (skipped when the account has neither,
 *     because then there is nothing to confirm with). The database refuses a number change without this, even if someone calls
 *     Auth directly, so this card is the friendly way through the gate, not the gate.
 *  2. The new number, which gets its own 6-digit code.
 *  3. The code entered; only then is the stored number updated. Afterwards the owner is told by email and in the app, and
 *     recovery by a text code is paused for a few days (OQ-43).
 */
export function ChangePhoneCardClient({ locale = "en", options }: { locale?: Locale; options: PhoneChangeOptions }) {
  const [sendState, sendAction, sendPending] = useActionState(sendPhoneChangeConfirmationCode, undefined);
  const [identityState, identityAction, identityPending] = useActionState(confirmPhoneChangeIdentity, undefined);
  const [requestState, requestAction, requestPending] = useActionState(requestPhoneChange, undefined);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmPhoneChange, undefined);

  const confirmErrorId = fieldErrorId("change-phone-confirm");
  const identityErrorId = fieldErrorId("change-phone-identity");
  const requestErrorId = fieldErrorId("change-phone");
  const codeErrorId = fieldErrorId("change-phone-code");

  // The "confirm it is you" gate is passed when the server recorded the authorisation, or when the account has nothing to confirm with.
  // A "confirm" field error from the new-number step, newer than the last confirmation, means the 15-minute authorisation ran out: back to step 1.
  const expiredAfterConfirming =
    requestState?.field === "confirm" && (requestState.at ?? 0) > (identityState?.at ?? 0);
  const authorised = identityState?.confirmed === true && !expiredAfterConfirming;
  const needsIdentity = options.needsConfirmation && !authorised;
  const codeSent = sendState?.step === "code" || identityState?.step === "code";
  const method = identityState?.method ?? sendState?.method;

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
          <div className="space-y-2">
            <FormSuccess message={t("auth.phone_change.done", locale)} />
            <p className="text-sm text-charcoal-ink/60">{t("auth.phone_change.hold_note", locale)}</p>
          </div>
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
                {...fieldErrorProps(codeErrorId, Boolean(confirmState?.error))}
              />
            </div>
            <FormError id={codeErrorId} message={confirmState?.error} />
            <Button type="submit" disabled={confirmPending}>
              {confirmPending ? t("auth.verify.submitting", locale) : t("auth.phone_change.confirm", locale)}
            </Button>
          </form>
        ) : needsIdentity && !codeSent ? (
          <div className="max-w-sm space-y-3">
            <p className="text-sm font-medium">{t("auth.phone_change.confirm_title", locale)}</p>
            <p className="text-sm text-charcoal-ink/60">{t("auth.phone_change.confirm_body", locale)}</p>
            {expiredAfterConfirming ? <FormError id={confirmErrorId} message={requestState?.error} /> : null}
            {options.oldPhone ? (
              <form action={sendAction}>
                <input type="hidden" name="method" value="old_phone" />
                <Button type="submit" variant="outline" className="w-full" disabled={sendPending}>
                  {t("auth.phone_change.confirm_by_phone", locale)} ({options.oldPhone.masked})
                </Button>
              </form>
            ) : null}
            {options.email ? (
              <form action={sendAction}>
                <input type="hidden" name="method" value="email" />
                <Button type="submit" variant="outline" className="w-full" disabled={sendPending}>
                  {t("auth.phone_change.confirm_by_email", locale)} ({options.email.masked})
                </Button>
              </form>
            ) : null}
            <FormError id={identityErrorId} message={sendState?.error} />
          </div>
        ) : needsIdentity && codeSent && method ? (
          <form action={identityAction} className="max-w-sm space-y-4">
            <input type="hidden" name="method" value={method} />
            <p className="text-sm text-charcoal-ink/60">{t("auth.phone_change.confirm_sent", locale)}</p>
            <div className="space-y-1.5">
              <Label htmlFor="change-phone-identity-token">{t("auth.field.code", locale)}</Label>
              <Input
                id="change-phone-identity-token"
                name="token"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                required
                {...fieldErrorProps(identityErrorId, Boolean(identityState?.error))}
              />
            </div>
            <FormError id={identityErrorId} message={identityState?.error} />
            <Button type="submit" disabled={identityPending}>
              {identityPending ? t("auth.verify.submitting", locale) : t("auth.phone_change.confirm_submit", locale)}
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
