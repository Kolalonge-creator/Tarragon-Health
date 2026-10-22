"use client";

import { useState } from "react";
import { en, t, type Locale } from "@tarragon/i18n";
import { formatNaira } from "@tarragon/commerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { checkoutErrorKey, isMessageKey } from "@/lib/commerce/model";
import { nextPart, openPlans, type InstalmentPlan, type InstalmentRow } from "@/lib/commerce/instalments";
import { CheckoutError, useMyInstalmentPlans, usePayInstalment } from "@/lib/queries/commerce";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";
const naira = (kobo: number) => `₦${formatNaira(kobo)}`;

type Go = (url: string) => void;
const goTo: Go = (url) => window.location.assign(url);

function partLine(p: InstalmentRow, locale: Locale): string {
  if (p.state === "paid") return p.paid_at === null ? "" : t("instalments.card.paid_on", locale, { date: formatPatientDate(p.paid_at) });
  if (p.state === "cancelled") return t("instalments.card.cancelled_part", locale);
  if (p.due_at === null) return "";
  return t(p.overdue ? "instalments.card.overdue" : "instalments.card.due_on", locale, { date: formatPatientDate(p.due_at) });
}

function PlanCard({ plan, locale, go }: { plan: InstalmentPlan; locale: Locale; go: Go }) {
  const pay = usePayInstalment();
  const [errorKey, setErrorKey] = useState<ReturnType<typeof checkoutErrorKey> | null>(null);
  const next = nextPart(plan);
  const paidParts = plan.instalments.filter((i) => i.state === "paid").length;
  const name = isMessageKey(plan.name_key, en) ? t(plan.name_key, locale) : "";

  async function payNext() {
    if (!next) return;
    setErrorKey(null);
    try {
      const r = await pay.mutateAsync(next.id);
      go(r.checkout_url);
    } catch (e) {
      setErrorKey(checkoutErrorKey(e instanceof CheckoutError ? e.code : "unknown"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("instalments.card.title", locale)}{name ? `: ${name}` : ""}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-medium">{t("instalments.card.summary", locale, { paid: paidParts, total: plan.parts })} ({naira(plan.paid_kobo)} / {naira(plan.price_kobo)})</p>
        <p role={plan.state === "lapsed" ? "alert" : "status"}>{t(`instalments.card.state.${plan.state}`, locale)}</p>
        {plan.access_ends_at && plan.state !== "cancelled" ? <p className={MUTED}>{t("instalments.card.access_until", locale, { date: formatPatientDate(plan.access_ends_at) })}</p> : null}
        <ul className="divide-y">
          {plan.instalments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="font-medium">{t("instalments.card.part", locale, { n: p.seq })}</p>
                <p className={`text-sm ${p.overdue && p.state === "pending" ? "" : MUTED}`}>{partLine(p, locale)}</p>
              </div>
              <p>{naira(p.amount_kobo)}</p>
            </li>
          ))}
        </ul>
        {plan.grace_days !== null ? <p className={`text-sm ${MUTED}`}>{t("instalments.card.grace", locale, { days: plan.grace_days })}</p> : null}
        {next ? (
          <Button type="button" className={TOUCH} onClick={payNext} disabled={pay.isPending}>
            {pay.isPending ? t("instalments.card.paying", locale) : t("instalments.card.pay_next", locale, { n: next.seq, amount: naira(next.amount_kobo) })}
          </Button>
        ) : null}
        <FormError id={`instalment-error-${plan.plan_id}`} message={errorKey ? t(errorKey, locale) : null} />
      </CardContent>
    </Card>
  );
}

/**
 * The schedule of a pay-in-parts plan, with the next part's pay button (S25b). It shows nothing at all for a person with no plan, so while
 * the feature is off (and for everyone who pays in full) the page is exactly what it was.
 */
export function InstalmentPlansCard({ locale, go = goTo }: { locale: Locale; go?: Go }) {
  const plans = useMyInstalmentPlans();
  const open = openPlans(plans.data ?? []);
  if (open.length === 0) return null;
  return (
    <div className="space-y-6">
      {open.map((p) => <PlanCard key={p.plan_id} plan={p} locale={locale} go={go} />)}
    </div>
  );
}
