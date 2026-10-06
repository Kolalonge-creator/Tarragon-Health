"use client";

import { useRef, useState } from "react";
import { en, t, type Locale } from "@tarragon/i18n";
import { estimatedBreakdown, formatNaira, type FeeEstimateSchedule } from "@tarragon/commerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { checkoutErrorKey, isMessageKey, orderStateKey, type CatalogueItem, type OrderRow } from "@/lib/commerce/model";
import { CheckoutError, useCatalogue, useMyMembership, useMyOrders, useStartCheckout } from "@/lib/queries/commerce";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

/** Catalogue copy keys come from the database. A key this build does not know shows nothing, never the raw key. */
function copy(key: string, locale: Locale): string {
  return isMessageKey(key, en) ? t(key, locale) : "";
}

function Naira({ kobo }: { kobo: number }) {
  return <span>{"₦"}{formatNaira(kobo)}</span>;
}

type Go = (url: string) => void;
const goTo: Go = (url) => window.location.assign(url);

/** Set when a supporter pays for someone in their Care Circle (S29): the order is for them, the card is the payer's own. */
export interface Beneficiary { readonly id: string; readonly name: string }

function ItemCard({ item, locale, fee, memberUntil, go, beneficiary }: { item: CatalogueItem; locale: Locale; fee: FeeEstimateSchedule; memberUntil: string | null; go: Go; beneficiary?: Beneficiary }) {
  const start = useStartCheckout();
  // One key per card, made on first use and kept, so a double tap or a retry after a dropped connection is the SAME order.
  const clientKey = useRef<string | null>(null);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof checkoutErrorKey> | null>(null);
  const b = estimatedBreakdown(item.amount_kobo, fee);
  const blocked = item.kind === "membership" && memberUntil !== null;

  async function pay() {
    setErrorKey(null);
    clientKey.current ??= crypto.randomUUID();
    try {
      const r = await start.mutateAsync({ code: item.code, clientKey: clientKey.current, ...(beneficiary ? { beneficiary: beneficiary.id } : {}) });
      go(r.checkout_url);
    } catch (e) {
      // A refusal is final for this tap; a fresh key is made next time. A network failure keeps the key so a retry is the same order.
      if (e instanceof CheckoutError && e.code !== "unknown" && e.code !== "payment_unavailable") clientKey.current = null;
      setErrorKey(checkoutErrorKey(e instanceof CheckoutError ? e.code : "unknown"));
      // "You are already a member" would be wrong when the order was for somebody else.
      if (beneficiary && e instanceof CheckoutError && e.code === "already_member") setErrorKey("circle.pay.already_member");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy(item.name_key, locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>{copy(item.description_key, locale)}</p>
        <section aria-labelledby={`incl-${item.code}`}>
          <h3 id={`incl-${item.code}`} className="font-medium">{t("shop.included", locale)}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {item.included_keys.map((k) => (
              <li key={k}>{copy(k, locale)}</li>
            ))}
          </ul>
        </section>
        <dl className="space-y-1">
          <div className="flex justify-between"><dt>{t("pay.fee.price", locale)}</dt><dd><Naira kobo={b.priceKobo} /></dd></div>
          <div className="flex justify-between"><dt>{t("pay.fee.line", locale)}</dt><dd>{t("shop.fee.about", locale, { amount: `\u20A6${formatNaira(b.feeKobo)}` })}</dd></div>
          <div className="flex justify-between font-semibold"><dt>{t("pay.fee.total", locale)}</dt><dd>{t("shop.fee.about", locale, { amount: `\u20A6${formatNaira(b.totalKobo)}` })}</dd></div>
        </dl>
        <p className={`text-sm ${MUTED}`}>{t("pay.fee.explain", locale)}</p>
        <p className={`text-sm ${MUTED}`}>{t("shop.fee.estimate", locale)}</p>
        <p className={`text-sm ${MUTED}`}>{t("shop.no_renew", locale)}</p>
        {blocked ? (
          <p role="status">{t("shop.member_until", locale, { date: formatPatientDate(memberUntil) })}</p>
        ) : (
          <Button type="button" className={TOUCH} onClick={pay} disabled={start.isPending}>
            {start.isPending ? t("shop.paying", locale) : t("shop.pay", locale)}
          </Button>
        )}
        <FormError id={`shop-error-${item.code}`} message={errorKey ? t(errorKey, locale) : null} />
      </CardContent>
    </Card>
  );
}

function History({ rows, locale }: { rows: OrderRow[]; locale: Locale }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("shop.history.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className={MUTED}>{t("shop.history.empty", locale)}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((o) => (
              <li key={o.order_id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{copy(o.name_key, locale)}</p>
                  <p className={`text-sm ${MUTED}`}>{formatPatientDate(o.paid_at ?? o.created_at)}</p>
                </div>
                <div className="text-right">
                  <p><Naira kobo={o.total_kobo ?? o.amount_kobo} /></p>
                  <p className={`text-sm ${MUTED}`}>{t(orderStateKey(o.state), locale)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** `go` is where the patient is sent to pay; a test passes its own, the app uses the browser's navigation. */
export function MembershipShop({ locale, fee, go = goTo, beneficiary }: { locale: Locale; fee: FeeEstimateSchedule; go?: Go; beneficiary?: Beneficiary }) {
  const catalogue = useCatalogue();
  const orders = useMyOrders();
  const membership = useMyMembership();
  // The payer's own membership says nothing about the person they are paying for.
  const memberUntil = !beneficiary && membership.data?.is_member ? (membership.data.ends_at ?? "") || null : null;
  const items = catalogue.data ?? [];

  return (
    <div className="space-y-6">
      {beneficiary ? (
        <section aria-labelledby="pay-for" className="space-y-1">
          <h2 id="pay-for" className="font-heading text-lg font-semibold">{t("circle.pay.who", locale, { name: beneficiary.name })}</h2>
          <p className={MUTED}>{t("circle.pay.note", locale, { name: beneficiary.name })}</p>
        </section>
      ) : null}
      {memberUntil ? <p role="status">{t("shop.member_until", locale, { date: formatPatientDate(memberUntil) })}</p> : null}
      {catalogue.isSuccess && items.length === 0 ? <p>{t("shop.not_open", locale)}</p> : null}
      {items.map((item) => (
        <ItemCard key={item.code} item={item} locale={locale} fee={fee} memberUntil={memberUntil} go={go} {...(beneficiary ? { beneficiary } : {})} />
      ))}
      <History rows={orders.data ?? []} locale={locale} />
    </div>
  );
}
