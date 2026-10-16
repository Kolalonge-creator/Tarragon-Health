"use client";

import { useActionState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";
import { resendSignupEmail, verifySignupEmail } from "./actions";

/**
 * The optional six-digit code from the confirmation email (S41, spec 1.4). The link in the same email keeps working and
 * nothing waits on this box: it is for someone whose email opens in a different app or browser than the one they signed up in.
 * The server decides who is verified; this component only sends the code.
 */
export function EmailCodeBox({ email, redirectTo, locale }: { email: string; redirectTo?: string; locale: Locale }) {
  const [verifyState, verifyAction, verifyPending] = useActionState(verifySignupEmail, undefined);
  const [resendState, resendAction, resendPending] = useActionState(resendSignupEmail, undefined);
  const errorId = fieldErrorId("email-code");
  const invalid = Boolean(verifyState?.error) && verifyState?.field === "token";

  return (
    <div className="w-full space-y-3 border-t border-charcoal-ink/10 pt-4 text-left">
      <div>
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("auth.email_code.title", locale)}</h2>
        <p className="mt-1 text-sm text-charcoal-ink/60">{t("auth.email_code.body", locale, { email })}</p>
      </div>
      <form action={verifyAction} className="space-y-3">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
        <div className="space-y-1.5">
          <Label htmlFor="email-token" className="sr-only">
            {t("auth.email_code.placeholder", locale)}
          </Label>
          <Input
            id="email-token"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder={t("auth.email_code.placeholder", locale)}
            className="h-11 rounded-xl tracking-widest"
            {...fieldErrorProps(errorId, invalid)}
          />
          <FormError id={errorId} message={verifyState?.error} />
        </div>
        <Button type="submit" disabled={verifyPending} className="w-full">
          {verifyPending ? t("auth.verify.submitting", locale) : t("auth.verify.submit", locale)}
        </Button>
      </form>
      <form action={resendAction}>
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
        <button type="submit" disabled={resendPending} className="min-h-11 text-sm font-medium text-brand-green underline underline-offset-2">
          {t("auth.email_code.resend", locale)}
        </button>
        {resendState?.sentAt && !resendState.error ? (
          <p role="status" className="text-xs text-charcoal-ink/60">
            {t("auth.email_code.resent", locale)}
          </p>
        ) : null}
        {resendState?.error ? <p role="alert" className="text-xs text-red-600">{resendState.error}</p> : null}
      </form>
    </div>
  );
}
