"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPatientDate } from "@/lib/format-date";
import { permissionKey, permissionSchema, type ShareOffer } from "@/lib/care-circle/model";
import { useRespondShareOffer, useShareOffers } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

/**
 * Care Circle P1 (founder decision D3, 2026-11-04): someone this person paid for has asked them to join their Care Circle. Nothing is
 * shown to them until they say yes here. Hidden when there is nothing to answer, and when the read fails (an offer is never a required
 * step, and a failed read must not look like an error on a page that has other work on it).
 */
export function ShareOffers({ locale }: { locale: Locale }) {
  const offers = useShareOffers();
  if (!offers.isSuccess || offers.data.length === 0) return null;
  return (
    <div className="space-y-4">
      {offers.data.map((o) => (
        <OfferCard key={o.member_id} offer={o} locale={locale} />
      ))}
    </div>
  );
}

function OfferCard({ offer, locale }: { offer: ShareOffer; locale: Locale }) {
  const respond = useRespondShareOffer();
  const [answer, setAnswer] = useState<"accepted" | "declined" | null>(null);
  const titleId = `offer-${offer.member_id}-title`;
  // what they would see, in the same words the patient chose from; anything unrecognised is simply not listed
  const sees = offer.permissions.flatMap((p) => {
    const r = permissionSchema.safeParse(p);
    return r.success ? [t(permissionKey(r.data), locale)] : [];
  });

  async function answerWith(accept: boolean) {
    try {
      const r = await respond.mutateAsync({ memberId: offer.member_id, accept });
      setAnswer(r.accepted ? "accepted" : "declined");
    } catch {
      // the error line below says so; nothing changed
    }
  }

  if (answer) {
    return (
      <p role="status" className="rounded-xl border border-brand-green/30 bg-soft-sage/60 p-4 text-sm dark:bg-brand-green/15">
        {answer === "accepted" ? t("circlep1.offer.accepted", locale, { name: offer.name }) : t("circlep1.offer.declined", locale)}
      </p>
    );
  }
  return (
    <Card aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle as="h2" id={titleId} className="text-lg">{t("circlep1.offer.title", locale, { name: offer.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed">{t("circlep1.offer.body", locale)}</p>
        {sees.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {sees.map((s) => <li key={s}>{s}</li>)}
          </ul>
        ) : null}
        <p className={`text-sm ${MUTED}`}>{t("circlep1.offer.answer_by", locale, { date: formatPatientDate(offer.answer_by) })}</p>
        {respond.isError ? (
          <p role="alert" className="text-sm">
            {/* a full circle is not a passing fault: trying again cannot help, so say what happened and who can fix it */}
            {respond.error?.message.includes("circle_full") ? t("circlep5.offer.full", locale, { name: offer.name }) : t("circlep1.offer.error", locale)}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Button type="button" variant="ghost" className={TOUCH} disabled={respond.isPending} onClick={() => void answerWith(false)}>
            {t("circlep1.offer.decline", locale)}
          </Button>
          <Button type="button" className={`${TOUCH} sm:ml-auto`} disabled={respond.isPending} aria-busy={respond.isPending} onClick={() => void answerWith(true)}>
            {t("circlep1.offer.accept", locale)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
