"use client";

import { useActionState, useEffect, useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { resendSignupCode } from "@/app/signup/actions";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";

/** Seconds before a new code may be requested. Spec 8.2; GoTrue also enforces it (`[auth.sms] max_frequency`). */
export const RESEND_SECONDS = 60;

/**
 * The button and its countdown. Mounted with `key={sentAt}` by the parent, so each successful resend gives a fresh
 * component that starts at 60 again (resetting state from inside an effect is what the React lint rule forbids).
 */
function ResendButton({ locale, pending }: { locale: Locale; pending: boolean }) {
  const [left, setLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    const id = setInterval(() => setLeft((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <Button type="submit" variant="outline" className="w-full rounded-xl" disabled={pending || left > 0}>
        {t("auth.verify.resend", locale)}
      </Button>
      {left > 0 && (
        <p role="status" className="text-center text-xs text-charcoal-ink/60">
          {t("auth.verify.resend_in", locale, { seconds: left })}
        </p>
      )}
    </>
  );
}

/**
 * "Send a new code" with a visible 60 second wait. The wait is a convenience; the server limits are the real
 * control (GoTrue's 60 second gap and the hook's per-phone hourly cap), so a client that ignores this gains nothing.
 */
export function ResendCode({ phone, locale, redirectTo }: { phone: string; locale: Locale; redirectTo?: string }) {
  const [state, action, pending] = useActionState(resendSignupCode, undefined);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
      <ResendButton key={state?.sentAt ?? 0} locale={locale} pending={pending} />
      <FormError id="resend-code-error" message={state?.error} />
    </form>
  );
}
