"use client";

import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { itemLabel } from "@/lib/commerce/item-label";
import { useMyEntitlements, type EntitlementRow } from "@/lib/queries/commerce";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

function stateBadge(state: string) {
  switch (state) {
    case "active":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "revoked":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  }
}

const STATE_KEYS = {
  active: "entitlement.state.active",
  expired: "entitlement.state.expired",
  used: "entitlement.state.used",
  revoked: "entitlement.state.revoked",
} as const;

/** The states the database allows; anything else shows the active label's neighbour, never a raw key. */
function stateKey(state: string): (typeof STATE_KEYS)[keyof typeof STATE_KEYS] {
  return state === "expired" || state === "used" || state === "revoked" ? STATE_KEYS[state] : STATE_KEYS.active;
}

function EntitlementItem({ row, locale }: { row: EntitlementRow; locale: Locale }) {
  const name = itemLabel(row.order?.catalog_item?.name_key, row.kind, locale);

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div>
        <p className="font-medium">{name}</p>
        {row.ends_at ? (
          <p className={`text-sm ${MUTED}`}>
            {t("entitlement.expires_on", locale, { date: formatPatientDate(row.ends_at) })}
          </p>
        ) : null}
        {row.remaining_uses !== null ? (
          <p className={`text-sm ${MUTED}`}>
            {row.remaining_uses === 1
              ? t("entitlement.remaining_uses", locale, { count: String(row.remaining_uses) })
              : t("entitlement.remaining_uses_plural", locale, { count: String(row.remaining_uses) })}
          </p>
        ) : null}
      </div>
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${stateBadge(row.state)}`}
      >
        {t(stateKey(row.state), locale)}
      </span>
    </li>
  );
}

export function EntitlementsCard({ locale }: { locale: Locale }) {
  const { data } = useMyEntitlements();
  const rows = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("entitlement.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className={MUTED}>{t("entitlement.empty", locale)}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <EntitlementItem key={row.id} row={row} locale={locale} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
