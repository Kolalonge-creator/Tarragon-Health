"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { payerForEntitlement } from "@/lib/care-circle/model";
import { useGiftPayers } from "@/lib/queries/care-circle";
import { GiftShareStep } from "./gift-share-step";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * People who paid for a gift this patient accepted and who see nothing yet (2026-11-03). The payer of the gift the patient has JUST
 * accepted gets the share step open straight away; anyone else is one tap away ("Choose what {name} can see"). Nothing is shared from
 * here without the patient pressing Share inside the step, and since Care Circle P1 (D3) Share only ASKS the payer, who sees nothing until
 * they say yes. A failed read shows nothing: this is an offer, never a required step.
 */
export function GiftPayerOffers({ locale, justAccepted }: { locale: Locale; justAccepted: string | null }) {
  const payers = useGiftPayers();
  const [open, setOpen] = useState<string | null>(null);

  if (payers.isLoading) {
    return (
      <div role="status" aria-label={t("giftshare.loading", locale)} className="space-y-3">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const rows = payers.data ?? [];
  const fresh = justAccepted ? payerForEntitlement(rows, justAccepted) : null;
  const others = rows.filter((p) => p.payer_id !== fresh?.payer_id);
  if (!fresh && others.length === 0) return null;

  // an answered step stays on screen with its confirmation; the offer list is refreshed on the next visit, not under the person's eyes
  return (
    <div className="space-y-4">
      {fresh ? <GiftShareStep payer={fresh} locale={locale} /> : null}
      {others.length > 0 ? (
        <section aria-labelledby="gift-payers-title" className="space-y-3 rounded-xl border border-charcoal-ink/10 p-4 dark:border-night-ink/15">
          <h3 id="gift-payers-title" className="font-heading text-lg font-semibold">{t("giftshare.later_title", locale)}</h3>
          <p className={`text-sm ${MUTED}`}>{t("giftshare.later_body", locale)}</p>
          <ul className="space-y-3">
            {others.map((p) => {
              const name = p.first_name ?? t("giftshare.someone", locale);
              return (
                <li key={p.payer_id}>
                  {p.offer_pending ? (
                    // P1 (D3): already asked; they see nothing until they say yes. The patient can withdraw it under "Waiting for a reply".
                    <p className={`text-sm ${MUTED}`}>{t("giftshare.waiting", locale, { name })}</p>
                  ) : open === p.payer_id ? (
                    <GiftShareStep payer={p} locale={locale} headingLevel="h4" />
                  ) : (
                    <Button type="button" variant="outline" className="min-h-11 w-full justify-start sm:w-auto" onClick={() => setOpen(p.payer_id)}>
                      {t("giftshare.later_open", locale, { name })}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
