"use client";

import { useState } from "react";
import { en, t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { isMessageKey } from "@/lib/commerce/model";
import { usePendingGifts, useRespondToGift } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

/**
 * A care pack or Membership someone in the Care Circle paid for waits here for the patient's yes (S29b, OQ-191). Nothing starts and
 * no lead clinician is assigned until the patient accepts; a no refunds the payer and tells the payer nothing.
 */
export function PendingGifts({ locale }: { locale: Locale }) {
  const gifts = usePendingGifts();
  const respond = useRespondToGift();
  const [notice, setNotice] = useState<"circle.gift.accepted" | "circle.gift.declined" | null>(null);
  const [failed, setFailed] = useState(false);
  const rows = gifts.data ?? [];
  if (rows.length === 0 && !notice) return null;

  async function answer(entitlementId: string, accept: boolean) {
    setFailed(false);
    setNotice(null);
    try {
      const r = await respond.mutateAsync({ entitlementId, accept });
      setNotice(r === "accepted" ? "circle.gift.accepted" : "circle.gift.declined");
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="space-y-4">
      {rows.map((g) => (
        <Card key={g.entitlement_id}>
          <CardHeader><CardTitle>{t("circle.gift.title", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p>{t("circle.gift.body", locale, { item: isMessageKey(g.name_key, en) ? t(g.name_key, locale) : "" })}</p>
            <p className={`text-sm ${MUTED}`}>{t("circle.gift.decide_by", locale, { date: formatPatientDate(g.decide_by) })}</p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" className={TOUCH} disabled={respond.isPending} onClick={() => void answer(g.entitlement_id, true)}>
                {t("circle.gift.accept", locale)}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={TOUCH}
                disabled={respond.isPending}
                onClick={() => {
                  if (window.confirm(t("circle.gift.decline_confirm", locale))) void answer(g.entitlement_id, false);
                }}
              >
                {t("circle.gift.decline", locale)}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {notice ? <p role="status">{t(notice, locale)}</p> : null}
      <FormError id="gift-error" message={failed ? t("circle.gift.error", locale) : null} />
    </div>
  );
}
