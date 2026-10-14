"use client";

import { useRef, useState } from "react";
import { en, t, type Locale, type MessageKey } from "@tarragon/i18n";
import Link from "next/link";
import { estimatedBreakdown, formatNaira, itemiseCheckout, type FeeEstimateSchedule } from "@tarragon/commerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { checkoutErrorKey, isCoveredReply, isMessageKey, orderStateKey, type CatalogueItem, type OrderRow } from "@/lib/commerce/model";
import { CheckoutError, useCatalogue, useMyMembership, useMyOrders, useQuote, useStartCheckout } from "@/lib/queries/commerce";
import { useSponsorableProfiles } from "@/lib/queries/care-access";
import { RefundRequestDialog } from "./refund-request-dialog";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

/** The words for the state of a refund the person asked for (S72, 19.8). */
function refundStateKey(state: string): MessageKey {
  switch (state) {
    case "completed": return "receipts.refund.completed";
    case "rejected": return "receipts.refund.rejected";
    case "failed": return "receipts.refund.failed";
    default: return "receipts.refund.pending";
  }
}

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

function ItemCard({ item, locale, fee, memberUntil, go, beneficiary, beneficiaryName }: { item: CatalogueItem; locale: Locale; fee: FeeEstimateSchedule; memberUntil: string | null; go: Go; beneficiary: string | undefined; beneficiaryName: string | undefined }) {
  const start = useStartCheckout();
  // One key per card, made on first use and kept, so a double tap or a retry after a dropped connection is the SAME order.
  const clientKey = useRef<string | null>(null);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof checkoutErrorKey> | null>(null);
  // S73: the database prices every order. What is shown is its quote; the catalogue price is only the fallback when no quote could be had.
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  // S72 (19.9): Health Points lower only Tarragon's own fee, for this one payment. The database works out whether any can be used; the choice is the person's.
  const [usePoints, setUsePoints] = useState(false);
  const quoteQuery = useQuote({ code: item.code, ...(beneficiary ? { beneficiary } : {}), discountCode: appliedCode });
  const pointsQuoteQuery = useQuote({ code: item.code, ...(beneficiary ? { beneficiary } : {}), discountCode: appliedCode, usePoints: true });
  const pointsQuote = beneficiary === undefined ? (pointsQuoteQuery.data ?? null) : null;
  const pointsLine = pointsQuote?.lines.find((l) => l.rule === "points" && l.applied) ?? null;
  const pointsOn = usePoints && pointsLine !== null;
  const quote = (pointsOn ? pointsQuote : (quoteQuery.data ?? null)) ?? null;
  const shownKobo = quote?.amountDueKobo ?? item.amount_kobo;
  const b = estimatedBreakdown(shownKobo, fee);
  const blocked = item.kind === "membership" && memberUntil !== null;
  const codeFailed = appliedCode !== null && quote !== null && quote.discountCodeOk === false;
  // S71 (19.5): a sponsor pays the whole price. There is then no payment step at all: no fee, no code box, no card, and the button says what it does.
  const covered = quote?.coveredInFull === true && !codeFailed;
  const [coveredDone, setCoveredDone] = useState<{ name: string | null } | null>(null);
  const sponsorLabel = quote?.sponsorName ? t("sponsor.covered_by", locale, { name: quote.sponsorName }) : t("sponsor.covered_generic", locale);
  // S71 (19.7): the clinician or partner fee, Tarragon's service fee, every reduction, the processing estimate and the total, adding up (or nothing)
  const itemised = quote !== null && !codeFailed && !covered ? itemiseCheckout({ quote, components: item.components, fee }) : null;
  // a quote with only the list line has nothing to explain
  const explainLines = quote !== null && quote.lines.some((l) => l.rule !== "list") ? quote.lines : null;

  async function pay() {
    // For someone else, say their name and what happens before any card is touched (S29c): they are asked to accept, and a no is a refund.
    if (beneficiary !== undefined) {
      const who = beneficiaryName ?? t("circle.pay.someone", locale);
      if (!window.confirm(`${t("circle.pay.confirm_title", locale, { name: who })}\n\n${t("circle.pay.confirm_body", locale, { name: who })}`)) return;
    }
    setErrorKey(null);
    clientKey.current ??= crypto.randomUUID();
    try {
      const r = await start.mutateAsync({
        code: item.code, clientKey: clientKey.current, ...(beneficiary ? { beneficiary } : {}),
        // the code the person applied, and the total they were shown: if the database now computes a different one it refuses instead of charging it
        ...(appliedCode && !codeFailed ? { discountCode: appliedCode } : {}),
        ...(pointsOn ? { usePoints: true } : {}),
        ...(quote !== null && !codeFailed ? { expectedAmountKobo: quote.amountDueKobo } : {}),
      });
      // a fully covered order comes back already paid, with no checkout link: nothing is opened and nothing is paid
      if (isCoveredReply(r)) {
        setCoveredDone({ name: r.sponsor_name });
        return;
      }
      go(r.checkout_url);
    } catch (e) {
      // A refusal is final for this tap; a fresh key is made next time. A network failure keeps the key so a retry is the same order.
      if (e instanceof CheckoutError && e.code !== "unknown" && e.code !== "payment_unavailable") clientKey.current = null;
      setErrorKey(checkoutErrorKey(e instanceof CheckoutError ? e.code : "unknown"));
      // "You are already a member" would be wrong when the order was for somebody else.
      if (beneficiary !== undefined && e instanceof CheckoutError && e.code === "already_member") setErrorKey("circle.pay.already_member");
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
        <p><Link href={`/patient/membership/${item.code}`} className="underline">{t("shop.see_included", locale)}</Link></p>
        {coveredDone ? (
          <section aria-labelledby={`covered-done-${item.code}`} className="space-y-1" role="status">
            <h3 id={`covered-done-${item.code}`} className="font-medium">{t("sponsor.done.title", locale)}</h3>
            <p>{coveredDone.name ? t("sponsor.covered_by", locale, { name: coveredDone.name }) : t("sponsor.covered_generic", locale)}</p>
            <p className={MUTED}>{t("sponsor.done.body", locale)}</p>
          </section>
        ) : covered ? (
          <section aria-labelledby={`covered-${item.code}`} className="space-y-2">
            <h3 id={`covered-${item.code}`} className="font-medium">{sponsorLabel}</h3>
            <p>{t("sponsor.no_payment", locale, { name: quote?.sponsorName ?? t("sponsor.covered_generic", locale) })}</p>
            {blocked ? (
              <p role="status">{t("shop.member_until", locale, { date: formatPatientDate(memberUntil) })}</p>
            ) : (
              <Button type="button" className={TOUCH} onClick={pay} disabled={start.isPending}>
                {start.isPending ? t("sponsor.getting", locale) : t("sponsor.get", locale)}
              </Button>
            )}
          </section>
        ) : (
          <>
            {quote !== null && quote.sponsorShareKobo > 0 ? (
              <p role="status">{t("sponsor.part", locale, { name: quote.sponsorName ?? t("sponsor.covered_generic", locale), amount: `\u20A6${formatNaira(quote.sponsorShareKobo)}` })}</p>
            ) : null}
            {quote?.sponsorBudgetShort ? <p role="status">{t("sponsor.budget_short", locale)}</p> : null}
            {itemised ? (
              <section aria-labelledby={`itemised-${item.code}`} className="space-y-2">
                <h3 id={`itemised-${item.code}`} className="font-medium">{t("checkout.itemised.title", locale)}</h3>
                <ul className="space-y-1">
                  {itemised.lines.map((l, i) => {
                    const amount = `\u20A6${formatNaira(Math.abs(l.amountKobo))}`;
                    return (
                      <li key={`${l.kind}-${i}`} className="flex justify-between gap-3">
                        <span>{copy(l.labelKey, locale)}{l.reasonKey ? ` (${copy(l.reasonKey, locale)})` : ""}</span>
                        <span>{l.amountKobo < 0 ? "-" : ""}{l.estimate ? t("shop.fee.about", locale, { amount }) : amount}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="flex justify-between font-semibold">
                  <span>{t("checkout.total", locale)}</span>
                  <span>{t("shop.fee.about", locale, { amount: `\u20A6${formatNaira(itemised.totalKobo)}` })}</span>
                </p>
                <p className={`text-sm ${MUTED}`}>{t("checkout.itemised.note", locale)}</p>
                {itemised.international ? (
                  <p className={`text-sm ${MUTED}`}>
                    {t(beneficiary !== undefined ? "checkout.international.for_someone" : "checkout.international.line", locale, {
                      fee: `\u20A6${formatNaira(itemised.international.processingKobo)}`, total: `\u20A6${formatNaira(itemised.international.totalKobo)}`,
                    })}
                  </p>
                ) : null}
              </section>
            ) : (
              <>
                {explainLines ? (
                  <ul className="space-y-1" aria-label={t("quote.total", locale)}>
                    {explainLines.map((l) => (
                      <li key={l.rule} className="flex justify-between gap-3">
                        <span>{copy(l.labelKey, locale)}{l.reasonKey ? ` (${copy(l.reasonKey, locale)})` : ""}</span>
                        <span>{l.amountKobo < 0 ? "-" : ""}{"₦"}{formatNaira(Math.abs(l.amountKobo))}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <dl className="space-y-1">
                  <div className="flex justify-between"><dt>{t("pay.fee.price", locale)}</dt><dd><Naira kobo={b.priceKobo} /></dd></div>
                  <div className="flex justify-between"><dt>{t("pay.fee.line", locale)}</dt><dd>{t("shop.fee.about", locale, { amount: `\u20A6${formatNaira(b.feeKobo)}` })}</dd></div>
                  <div className="flex justify-between font-semibold"><dt>{t("pay.fee.total", locale)}</dt><dd>{t("shop.fee.about", locale, { amount: `\u20A6${formatNaira(b.totalKobo)}` })}</dd></div>
                </dl>
                <p className={`text-sm ${MUTED}`}>{t("pay.fee.explain", locale)}</p>
                <p className={`text-sm ${MUTED}`}>{t("shop.fee.estimate", locale)}</p>
              </>
            )}
            {pointsLine !== null && pointsQuote !== null && !blocked ? (
              <div className="space-y-1">
                <label className={`${TOUCH} flex items-center gap-2 font-medium`}>
                  <input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} aria-describedby={`points-hint-${item.code}`} className="h-5 w-5" />
                  {t("checkout.points.label", locale)}
                </label>
                <p id={`points-hint-${item.code}`} className={`text-sm ${MUTED}`}>
                  {t("checkout.points.saves", locale, { points: pointsQuote.pointsApplied, amount: `\u20A6${formatNaira(pointsQuote.pointsReductionKobo)}` })} {t("checkout.points.explain", locale)}
                </p>
              </div>
            ) : null}
            {!blocked ? (
              <div className="space-y-2">
                <label htmlFor={`code-${item.code}`} className="block font-medium">{t("quote.code.label", locale)}</label>
                <div className="flex gap-2">
                  <input
                    id={`code-${item.code}`} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} autoComplete="off" autoCapitalize="characters" maxLength={32}
                    aria-describedby={`code-hint-${item.code}`} className={`${TOUCH} w-full rounded-md border border-input bg-background px-3 py-2`}
                  />
                  {appliedCode ? (
                    <Button type="button" variant="outline" className={TOUCH} onClick={() => { setAppliedCode(null); setCodeInput(""); }}>{t("quote.code.remove", locale)}</Button>
                  ) : (
                    <Button type="button" variant="outline" className={TOUCH} disabled={codeInput.trim().length < 3} onClick={() => setAppliedCode(codeInput.trim())}>{t("quote.code.apply", locale)}</Button>
                  )}
                </div>
                <p id={`code-hint-${item.code}`} className={`text-sm ${MUTED}`}>{t("quote.code.hint", locale)}</p>
                {codeFailed ? <p role="status">{t(quote?.rateLimited ? "shop.error.discount_code_rate_limited" : "shop.error.discount_code_invalid", locale)}</p> : null}
              </div>
            ) : null}
            <p className={`text-sm ${MUTED}`}>{t("shop.no_renew", locale)}</p>
            {blocked ? (
              <p role="status">{t("shop.member_until", locale, { date: formatPatientDate(memberUntil) })}</p>
            ) : (
              <Button type="button" className={TOUCH} onClick={pay} disabled={start.isPending}>
                {start.isPending ? t("shop.paying", locale) : t("shop.pay", locale)}
              </Button>
            )}
          </>
        )}
        <FormError id={`shop-error-${item.code}`} message={errorKey ? t(errorKey, locale) : null} />
      </CardContent>
    </Card>
  );
}

function History({ rows, locale }: { rows: OrderRow[]; locale: Locale }) {
  const [refundTarget, setRefundTarget] = useState<OrderRow | null>(null);

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
                <div className="flex items-center gap-3">
                  {o.state === "paid" && o.amount_kobo > 0 && o.is_buyer && o.refund_state === null && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setRefundTarget(o)}>
                      {t("refund.request.button", locale)}
                    </Button>
                  )}
                  {o.refund_state !== null && <span className={`text-sm ${MUTED}`}>{t(refundStateKey(o.refund_state), locale)}</span>}
                  <div className="text-right">
                    {o.amount_kobo === 0 && o.sponsor_share_kobo > 0 ? <p>{o.sponsor_name ? t("sponsor.history_covered", locale, { name: o.sponsor_name }) : t("sponsor.covered_generic", locale)}</p> : <p><Naira kobo={o.total_kobo ?? o.amount_kobo} /></p>}
                    <p className={`text-sm ${MUTED}`}>{t(orderStateKey(o.state), locale)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {rows.some((o) => o.state === "paid") && <p className={`mt-3 text-sm ${MUTED}`}>{t("refund.policy.cooling_off", locale)}</p>}
      </CardContent>
      {refundTarget && (
        <RefundRequestDialog
          orderId={refundTarget.order_id}
          itemName={copy(refundTarget.name_key, locale)}
          amountKobo={refundTarget.total_kobo ?? refundTarget.amount_kobo}
          open={refundTarget !== null}
          onOpenChange={(open) => { if (!open) setRefundTarget(null); }}
          locale={locale}
        />
      )}
    </Card>
  );
}

/** `go` is where the patient is sent to pay; a test passes its own, the app uses the browser's navigation. */
export function MembershipShop({ locale, fee, go = goTo, beneficiary }: { locale: Locale; fee: FeeEstimateSchedule; go?: Go; beneficiary?: Beneficiary }) {
  const catalogue = useCatalogue();
  const orders = useMyOrders();
  const membership = useMyMembership();
  const lovedOnes = useSponsorableProfiles();
  const [beneficiaryId, setBeneficiaryId] = useState<string | undefined>(undefined);
  // A fixed beneficiary (a Care Circle member paying, S29) wins over the picker (older family grants, S26).
  const chosenId = beneficiary?.id ?? beneficiaryId;
  // The payer's own membership says nothing about the person they are paying for.
  const inGrace = !chosenId && membership.data?.is_member === true && membership.data.in_grace === true;
  // In the grace the person is still a Member but may renew, so the item is not blocked and the message is different.
  const memberUntil = !chosenId && membership.data?.is_member && !inGrace ? (membership.data.ends_at ?? "") || null : null;
  const graceEnds = inGrace ? membership.data?.grace_ends_at ?? null : null;
  const items = catalogue.data ?? [];
  const profiles = lovedOnes.data ?? [];

  return (
    <div className="space-y-6">
      {beneficiary ? (
        <section aria-labelledby="pay-for" className="space-y-1">
          <h2 id="pay-for" className="font-heading text-lg font-semibold">{t("circle.pay.who", locale, { name: beneficiary.name })}</h2>
          <p className={MUTED}>{t("circle.pay.note", locale, { name: beneficiary.name })}</p>
          <p className={MUTED}>{t("circle.pay.only_year", locale)}</p>
        </section>
      ) : null}
      {memberUntil ? <p role="status">{t("shop.member_until", locale, { date: formatPatientDate(memberUntil) })}</p> : null}
      {graceEnds ? <p role="status">{t("shop.in_grace", locale, { date: formatPatientDate(graceEnds) })}</p> : null}
      {!beneficiary && profiles.length > 0 ? (
        <fieldset>
          <label htmlFor="beneficiary-select" className="block font-medium mb-1">{t("shop.buy_for.label", locale)}</label>
          <select
            id="beneficiary-select"
            className={`${TOUCH} w-full rounded-md border border-input bg-background px-3 py-2`}
            value={beneficiaryId ?? ""}
            onChange={(e) => setBeneficiaryId(e.target.value || undefined)}
          >
            <option value="">{t("shop.buy_for.self", locale)}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name ?? p.id}</option>
            ))}
          </select>
        </fieldset>
      ) : null}
      {catalogue.isSuccess && items.length === 0 ? <p>{t("shop.not_open", locale)}</p> : null}
      {items.filter((item) => !chosenId || item.kind === "membership").map((item) => (
        <ItemCard key={item.code} item={item} locale={locale} fee={fee} memberUntil={memberUntil} go={go} beneficiary={chosenId} beneficiaryName={beneficiary?.name ?? profiles.find((p) => p.id === chosenId)?.full_name ?? undefined} />
      ))}
      <History rows={orders.data ?? []} locale={locale} />
    </div>
  );
}
