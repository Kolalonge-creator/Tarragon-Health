"use client";

import { en, t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { itemLabel } from "@/lib/commerce/item-label";
import { useMyFundSupport } from "@/lib/queries/commerce";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * Support the Community Access Fund approved for this person (S72, 19.11): which item, whether it is ready, used or ended, and the end date.
 * Never the reason, the criterion, the amount or who approved it. Renders nothing when there is none.
 */
export function FundSupportCard({ locale }: { locale: Locale }) {
  const { data } = useMyFundSupport();
  const rows = data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("fund.support.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map((r) => {
            const key = `fund.support.${r.status}`;
            const item = itemLabel(r.itemNameKey, r.itemCode, locale);
            return (
              <li key={`${r.itemCode}-${r.expiresAt}`} className={`py-3 ${MUTED}`}>
                {(Object.hasOwn(en, key) ? t(key as MessageKey, locale, { item, date: formatPatientDate(r.expiresAt) }) : "")}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
