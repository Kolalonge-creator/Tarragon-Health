"use client";

import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fallbackRefundPolicy } from "@/lib/commerce/refund-rule";
import { itemLabel } from "@/lib/commerce/item-label";
import { formatPatientDate } from "@/lib/format-date";
import { formatKobo } from "@/lib/format-money";
import { useMyOrderRefunds, useRefundPolicy, type MyOrderRefund, type RefundStep } from "@/lib/queries/order-refunds";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

const STEP_KEYS: Record<RefundStep, MessageKey> = {
  requested: "refund.step.requested",
  approved: "refund.step.approved",
  declined: "refund.step.declined",
  sending: "refund.step.sending",
  completed: "refund.step.completed",
  problem: "refund.step.problem",
  retrying: "refund.step.retrying",
};

function RefundItem({ refund, locale }: { refund: MyOrderRefund; locale: Locale }) {
  const { data } = useRefundPolicy();
  const policy = data ?? fallbackRefundPolicy();
  const name = itemLabel(refund.order?.catalog_item?.name_key, refund.order?.catalog_item?.code ?? "", locale);
  const open = refund.state === "pending" || refund.state === "approved" || refund.state === "processing";
  return (
    <li className="space-y-2 py-3">
      <div>
        <p className="font-medium">{name}</p>
        <p className={`text-sm ${MUTED}`}>{t("refund.status.amount", locale, { amount: formatKobo(refund.amount_kobo) })}</p>
      </div>
      {/* The steps so far, oldest first. The last one is the current state. */}
      <ol className="space-y-1 text-sm" aria-label={t("refund.status.title", locale)}>
        {refund.steps.map((s, i) => (
          <li key={`${s.step}-${s.created_at}`} aria-current={i === refund.steps.length - 1 ? "step" : undefined}>
            <span className="font-medium">{t(STEP_KEYS[s.step], locale)}</span>
            <span className={MUTED}>{` · ${formatPatientDate(s.created_at)}`}</span>
          </li>
        ))}
      </ol>
      {refund.state === "pending" ? <p className={`text-sm ${MUTED}`}>{t("refund.status.sla", locale, { days: policy.decisionSlaDays })}</p> : null}
      {open && refund.state !== "pending" ? (
        <p className={`text-sm ${MUTED}`}>{t("refund.status.bank", locale, { min: policy.bankDaysMin, max: policy.bankDaysMax })}</p>
      ) : null}
      {refund.state === "rejected" && refund.decision_note ? (
        <p className="text-sm">
          <span className="font-medium">{t("refund.status.reason_label", locale)}</span>
          <span>{`: ${refund.decision_note}`}</span>
        </p>
      ) : null}
    </li>
  );
}

/** Every refund the person asked for, with the steps it has been through, the answer time, and the reason when it was declined (S26b). */
export function RefundStatusCard({ locale }: { locale: Locale }) {
  const { data } = useMyOrderRefunds();
  const rows = data ?? [];
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("refund.status.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map((r) => (
            <RefundItem key={r.id} refund={r} locale={locale} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
