"use client";

import { en, t, type Locale, type MessageKey } from "@tarragon/i18n";
import { entitlementLines, entitlementSource, type EntitlementView } from "@tarragon/commerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { itemLabel } from "@/lib/commerce/item-label";
import { isMessageKey } from "@/lib/commerce/model";
import { useMyEntitlements } from "@/lib/queries/commerce";

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

/** The words come from the shared wording (S72, 19.12) as keys; a key this build does not know shows nothing, never a raw key. */
function say(line: { key: string; params: Readonly<Record<string, string | number>> }, locale: Locale): string {
  return isMessageKey(line.key, en) ? t(line.key as MessageKey, locale, { ...line.params }) : "";
}

function EntitlementItem({ row, locale }: { row: EntitlementView; locale: Locale }) {
  const name = itemLabel(row.nameKey, row.kind, locale);
  const lines = entitlementLines(row).filter((l) => !l.key.startsWith("entitlement.state."));
  const source = entitlementSource(row);

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div>
        <p className="font-medium">{name}</p>
        {lines.map((l) => (
          <p key={l.key} className={`text-sm ${MUTED}`}>{say(l, locale)}</p>
        ))}
        <p className={`text-sm ${MUTED}`}>{say(source, locale)}</p>
        {row.partCovered ? <p className={`text-sm ${MUTED}`}>{t("entitlement.part_covered", locale)}</p> : null}
      </div>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${stateBadge(row.state)}`}>
        {t(STATE_KEYS[row.state], locale)}
      </span>
    </li>
  );
}

/** What the person has paid for, been given by a supporter, had covered by a sponsor, or received from the Community Access Fund. Never money (INV-09). */
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
