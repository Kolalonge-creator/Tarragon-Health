"use client";

import { useActionState } from "react";
import { t } from "@tarragon/i18n";
import { askRecoveryContactAction, sendContactRecoveryLinkAction } from "./recovery-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

/**
 * Recovery through the Care Circle recovery contact (S03b). Two steps on one screen, because the person comes back to it:
 *  1. ask the contact they named; the contact confirms in their own signed-in session;
 *  2. after a wait that protects them, ask for the one-time link, which goes to their OWN verified email (or a code to their
 *     own verified phone), never to the contact.
 * Both steps answer the same way whether or not an account, a contact or a confirmation exists.
 */
export function ContactRecoveryForm() {
  const [askState, askAction, askPending] = useActionState(askRecoveryContactAction, undefined);
  const [sendState, sendAction, sendPending] = useActionState(sendContactRecoveryLinkAction, undefined);
  const askErrorId = fieldErrorId("contact-ask");
  const sendErrorId = fieldErrorId("contact-send");

  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal-ink/60">{t("auth.recovery.contact_intro")}</p>

      <form action={askAction} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="contact-ask-identifier">{t("auth.recovery.identifier")}</Label>
          <Input
            id="contact-ask-identifier"
            name="identifier"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            {...fieldErrorProps(askErrorId, Boolean(askState?.error))}
          />
        </div>
        <FormError id={askErrorId} message={askState?.error} />
        {askState?.success ? (
          <p role="status" className="text-sm text-charcoal-ink/70">
            {askState.message}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={askPending}>
          {t("auth.recovery.contact_ask")}
        </Button>
      </form>

      <form action={sendAction} className="space-y-3 border-t border-charcoal-ink/10 pt-4">
        <div className="space-y-1.5">
          <Label htmlFor="contact-send-identifier">{t("auth.recovery.identifier")}</Label>
          <Input
            id="contact-send-identifier"
            name="identifier"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            {...fieldErrorProps(sendErrorId, Boolean(sendState?.error))}
          />
        </div>
        <FormError id={sendErrorId} message={sendState?.error} />
        {sendState?.success ? (
          <p role="status" className="text-sm text-charcoal-ink/70">
            {sendState.message}
          </p>
        ) : null}
        <Button type="submit" variant="outline" className="w-full" disabled={sendPending}>
          {t("auth.recovery.contact_send")}
        </Button>
      </form>
    </div>
  );
}
