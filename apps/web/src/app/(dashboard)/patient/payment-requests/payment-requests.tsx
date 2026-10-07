"use client";

import { useState } from "react";
import { en, t, type Locale, type MessageKey } from "@tarragon/i18n";
import { paymentRequestLink, requestErrorKey } from "@tarragon/commerce";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { itemLabel } from "@/lib/commerce/item-label";
import { CheckoutError, useCancelPaymentRequest, useCatalogue, useCreatePaymentRequest, useMyPaymentRequests } from "@/lib/queries/commerce";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";
const say = (key: string, locale: Locale, params?: Record<string, string | number>) => (Object.hasOwn(en, key) ? t(key as MessageKey, locale, params) : "");

/**
 * Ask someone who has offered to help to pay for the yearly Membership (S72, 19.13). The link is shown ONCE, when it is made, and shared through the phone's own
 * share sheet (or copied). It is not a messaging integration. The page behind it shows only what it is and the price, never anything about health (INV-07).
 */
export function PaymentRequests({ locale }: { locale: Locale }) {
  const catalogue = useCatalogue();
  const list = useMyPaymentRequests();
  const create = useCreatePaymentRequest();
  const cancel = useCancelPaymentRequest();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const items = (catalogue.data ?? []).filter((i) => i.kind === "membership");

  async function make(itemCode: string) {
    setError(null); setLink(null); setCopied(false);
    try {
      const r = await create.mutateAsync({ itemCode });
      setLink(paymentRequestLink(window.location.origin, r.code));
    } catch (e) {
      setError(say(requestErrorKey(e instanceof CheckoutError ? e.code : "unknown"), locale));
    }
  }

  async function share(url: string) {
    const data = { title: t("request.share.title", locale), text: t("request.share.message", locale, { link: url }), url };
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try { await navigator.share(data); return; } catch { /* the person closed the sheet: nothing to do */ }
    }
    await copy(url);
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setError(say("request.error.unknown", locale)); }
  }

  return (
    <div className="space-y-6">
      <p className={MUTED}>{t("request.intro", locale)}</p>
      <p className={MUTED}>{t("request.only_year", locale)}</p>
      {catalogue.isSuccess && items.length === 0 ? <p>{t("shop.not_open", locale)}</p> : null}
      {items.map((i) => (
        <Card key={i.code}>
          <CardHeader><CardTitle>{itemLabel(i.name_key, i.code, locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button type="button" className={TOUCH} onClick={() => make(i.code)} disabled={create.isPending}>
              {create.isPending ? t("request.creating", locale) : t("request.create", locale)}
            </Button>
          </CardContent>
        </Card>
      ))}
      <FormError id="payreq-error" message={error} />
      {link ? (
        <Card>
          <CardHeader><CardTitle>{t("request.link_ready", locale)}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className={`text-sm ${MUTED}`}>{t("request.link_once", locale)}</p>
            <p className="break-all rounded-md border border-input px-3 py-2 text-sm" data-testid="request-link">{link}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className={TOUCH} onClick={() => share(link)}>{t("request.share", locale)}</Button>
              <Button type="button" variant="outline" className={TOUCH} onClick={() => copy(link)}>{t("request.copy", locale)}</Button>
            </div>
            {copied ? <p role="status">{t("request.copied", locale)}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader><CardTitle>{t("request.list.title", locale)}</CardTitle></CardHeader>
        <CardContent>
          {(list.data ?? []).length === 0 ? <p className={MUTED}>{t("request.list.empty", locale)}</p> : (
            <ul className="divide-y">
              {(list.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{itemLabel(r.nameKey, r.itemCode, locale)}</p>
                    <p className={`text-sm ${MUTED}`}>{say(`request.status.${r.status}`, locale)}{r.status === "open" ? `, ${t("request.expires_on", locale, { date: formatPatientDate(r.expiresAt) })}` : ""}</p>
                  </div>
                  {r.status === "open" ? (
                    <Button type="button" variant="outline" size="sm" className={TOUCH} disabled={cancel.isPending}
                      onClick={async () => { const res = await cancel.mutateAsync(r.id); if (res === "payment_in_progress") setError(t("request.cancel.in_progress", locale)); }}>
                      {t("request.cancel", locale)}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
