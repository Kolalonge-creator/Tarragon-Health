"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { formatNaira } from "@tarragon/commerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { useCancelRenewal, useMyRenewal } from "@/lib/queries/commerce";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * Where a Member sees, and stops, automatic renewal. Shown only to someone with a Membership, and only while the renewal switch is on or
 * they are already on it, so a person is never shown a promise that is not running. Cancelling is one tap, with no confirmation maze:
 * it keeps the year already paid for, stops the next charge and deletes the saved card.
 */
export function RenewalCard({ locale }: { locale: Locale }) {
  const renewal = useMyRenewal();
  const cancel = useCancelRenewal();
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const r = renewal.data;
  if (!r || !r.has_membership || (!r.enabled && !r.auto_renew && !done)) return null;
  const date = r.ends_at ? formatPatientDate(r.ends_at) : "";

  async function stop() {
    setFailed(false);
    try {
      await cancel.mutateAsync();
      setDone(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("renewal.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {done || !r.auto_renew ? (
          <>
            <p role="status">{done ? t("renewal.cancelled", locale, { date }) : t("renewal.off", locale, { date })}</p>
            {!done ? <p className={`text-sm ${MUTED}`}>{t("renewal.off_how", locale)}</p> : null}
          </>
        ) : (
          <>
            <p>
              {r.amount_kobo != null
                ? t("renewal.on", locale, { date, last4: r.card?.last4 ?? "", amount: `₦${formatNaira(r.amount_kobo)}` })
                : t("renewal.on_no_amount", locale, { date, last4: r.card?.last4 ?? "" })}
            </p>
            <p className={`text-sm ${MUTED}`}>{t("renewal.cancel_keeps", locale, { date })}</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={stop} disabled={cancel.isPending}>
              {cancel.isPending ? t("renewal.cancelling", locale) : t("renewal.cancel", locale)}
            </Button>
          </>
        )}
        <FormError id="renewal-error" message={failed ? t("renewal.error", locale) : null} />
      </CardContent>
    </Card>
  );
}
