"use client";

import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { fallbackRefundPolicy, refundRuleLines } from "@/lib/commerce/refund-rule";
import { useRefundPolicy } from "@/lib/queries/order-refunds";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * The refund and cancellation rule in plain words (S26b), shown at checkout and on the receipt. Every number of days is the active
 * configuration's, never typed here, and the lines promise only what the database enforces (the window, the answer time and a stated
 * reason when a request is declined). No legal claim is made.
 */
export function RefundRule({ locale, membership, pack, id }: { locale: Locale; membership: boolean; pack: boolean; id: string }) {
  const { data: policy } = useRefundPolicy();
  // Until the database answers, the shared registry values are used, so the rule is on the screen from the first paint.
  const lines = refundRuleLines(policy ?? fallbackRefundPolicy(), { membership, pack });
  return (
    <div role="group" aria-labelledby={`refund-rule-${id}`} className="space-y-1">
      <h3 id={`refund-rule-${id}`} className="font-medium">{t("refund.rule.title", locale)}</h3>
      <ul className={`list-disc space-y-1 pl-5 text-sm ${MUTED}`}>
        {lines.map((l) => (
          <li key={l.key}>{t(l.key as MessageKey, locale, { ...l.params })}</li>
        ))}
      </ul>
    </div>
  );
}
