"use client";

import Link from "next/link";
import { useState } from "react";
import { en, t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { isMessageKey } from "@/lib/commerce/model";
import { endsSoonForRenewal, type GiftPaid } from "@/lib/care-circle/model";
import { useGiftsPaid } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

function stateLine(g: GiftPaid, locale: Locale, nowMs: number): string {
  switch (g.state) {
    case "waiting":
      return t("circlep5.paid.waiting", locale, { name: g.name });
    case "accepted":
      return g.ends_at && endsSoonForRenewal(g.ends_at, nowMs)
        ? t("circlep5.paid.renew_soon", locale, { date: formatPatientDate(g.ends_at) })
        : g.ends_at
          ? t("circlep5.paid.accepted", locale, { date: formatPatientDate(g.ends_at) })
          : t("circlep5.paid.not_accepted", locale);
    case "declined":
      return t("circlep5.paid.declined", locale, { name: g.name });
    case "not_answered":
      return t("circlep5.paid.not_answered", locale, { name: g.name });
    default:
      return t("circlep5.paid.not_accepted", locale);
  }
}

/**
 * Care Circle P5 (spec 12.2): what someone who paid for another person's care sees about those payments. Billing facts only, from
 * public.my_gifts_paid; paying never lets them see health information, and the card says so. Hidden when there is nothing to show.
 */
export function GiftsPaid({ locale }: { locale: Locale }) {
  const gifts = useGiftsPaid();
  const [nowMs] = useState(() => Date.now());
  if (!gifts.isSuccess || gifts.data.length === 0) return null;
  const anyRenewable = gifts.data.some((g) => g.state === "accepted" && endsSoonForRenewal(g.ends_at, nowMs));
  return (
    <Card>
      <CardHeader><CardTitle>{t("circlep5.paid.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className={`text-sm ${MUTED}`}>{t("circlep5.paid.privacy", locale)}</p>
        <ul className="divide-y">
          {gifts.data.map((g) => (
            <li key={g.order_id} className="space-y-0.5 py-2">
              <p className="font-medium">
                {t("circlep5.paid.row", locale, { item: g.name_key && isMessageKey(g.name_key, en) ? t(g.name_key, locale) : "", name: g.name })}
              </p>
              <p className="text-sm">{stateLine(g, locale, nowMs)}</p>
              {g.paid_at ? <p className={`text-sm ${MUTED}`}>{t("circlep5.paid.paid_on", locale, { date: formatPatientDate(g.paid_at) })}</p> : null}
              {g.refund_state ? <p className={`text-sm ${MUTED}`}>{t("circlep5.paid.refund", locale, { state: g.refund_state.replaceAll("_", " ") })}</p> : null}
            </li>
          ))}
        </ul>
        {anyRenewable ? (
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/patient/supporting/new">{t("circlep5.paid.renew", locale)}</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
