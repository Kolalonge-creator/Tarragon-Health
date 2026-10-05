"use client";

import { useActionState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { CARE_ACCESS_CATEGORIES } from "@/lib/validation/proxy-setup";
import { confirmProxySetupAction, declineProxySetupAction } from "./proxy-setup-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export interface PendingProxySetup {
  id: string;
  requester_first_name: string;
  expires_at: string;
}

/**
 * What the PARENT sees after signing in with the code on their own phone. Every box starts unticked: the default is
 * to share nothing, and the parent decides (v5 8.2, safety case 23). The requester's first name is all that is shown
 * about them.
 */
function SetupCard({ setup, locale }: { setup: PendingProxySetup; locale: Locale }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmProxySetupAction, undefined);
  const [declineState, declineAction, declinePending] = useActionState(declineProxySetupAction, undefined);
  const name = setup.requester_first_name || "Someone";
  const done = confirmState?.done ?? declineState?.done;

  if (done) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p role="status" className="text-sm">
            {t(done === "confirmed" ? "proxy.confirm.done" : "proxy.confirm.declined", locale, { name })}
          </p>
          {confirmState?.passwordError && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {confirmState.passwordError}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("proxy.confirm.title", locale, { name })}</CardTitle>
        <CardDescription>{t("proxy.confirm.body", locale, { name })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={confirmAction} className="space-y-4">
          <input type="hidden" name="setupId" value={setup.id} />
          <input type="hidden" name="requesterName" value={name} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("proxy.confirm.categories_label", locale, { name })}</legend>
            {CARE_ACCESS_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="categories" value={category} defaultChecked={false} />
                {t(`care_category.${category}` as MessageKey, locale)}
              </label>
            ))}
            <p className="text-xs text-charcoal-ink/60">{t("proxy.confirm.none_note", locale, { name })}</p>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor={`proxy-pw-${setup.id}`}>{t("proxy.parent.password_label", locale)}</Label>
            <PasswordInput id={`proxy-pw-${setup.id}`} name="password" autoComplete="new-password" className="h-11 rounded-xl" />
            {confirmState?.passwordError && (
              <p role="alert" className="text-sm text-red-700">
                {confirmState.passwordError}
              </p>
            )}
          </div>
          {(confirmState?.error || declineState?.error) && (
            <p role="alert" className="text-sm text-red-700">
              {confirmState?.error ?? declineState?.error}
            </p>
          )}
          <div className="flex gap-3">
            <Button type="submit" disabled={confirmPending || declinePending} className="rounded-xl">
              {t("proxy.confirm.confirm", locale)}
            </Button>
            <Button type="submit" variant="outline" formAction={declineAction} formNoValidate disabled={confirmPending || declinePending} className="rounded-xl">
              {t("proxy.confirm.decline", locale)}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ProxyConfirmationCard({ setups, locale }: { setups: PendingProxySetup[]; locale: Locale }) {
  if (setups.length === 0) return null;
  return (
    <div className="space-y-4">
      {setups.map((setup) => (
        <SetupCard key={setup.id} setup={setup} locale={locale} />
      ))}
    </div>
  );
}
