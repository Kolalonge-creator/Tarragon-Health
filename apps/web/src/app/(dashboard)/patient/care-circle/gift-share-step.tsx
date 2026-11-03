"use client";

import { useId, useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-error";
import { GIFT_SHARE_PERMISSIONS, GIFT_SHARE_USUAL, permissionKey, type GiftPayer, type GiftSharePermission } from "@/lib/care-circle/model";
import { useShareWithGiftPayer } from "@/lib/queries/care-circle";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
// 44px touch targets everywhere a finger lands; colour changes only, and only when the person has not asked for reduced motion
const ROW = "flex min-h-11 items-start gap-3 rounded-lg px-2 py-2 motion-safe:transition-colors hover:bg-charcoal-ink/[0.03] dark:hover:bg-night-ink/5";
const BOX = "mt-0.5 h-5 w-5 shrink-0 accent-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2";

export type GiftShareOutcome = "shared" | "not_now";

/**
 * The next step after a patient accepts a gift someone else paid for (2026-11-03): "Would you like [first name] to see how you are
 * doing?". Every permission is an UNTICKED box; "Share the usual" only ticks the usual set (the patient still presses Share, so they see
 * exactly what goes before it goes); "Not now" shares nothing. Nothing is sent until the patient presses Share. Used right after the yes,
 * and again from the Care Circle page for a payer who sees nothing yet. Changing or stopping it later is the existing member settings.
 */
export function GiftShareStep({
  payer,
  locale,
  headingLevel = "h3",
  onDone,
}: {
  payer: GiftPayer;
  locale: Locale;
  headingLevel?: "h2" | "h3" | "h4";
  onDone?: (outcome: GiftShareOutcome) => void;
}) {
  const id = useId();
  const share = useShareWithGiftPayer();
  const [ticked, setTicked] = useState<GiftSharePermission[]>([]);
  const [monthly, setMonthly] = useState(false);
  const [problem, setProblem] = useState<"nothing" | "full" | "failed" | null>(null);
  const [outcome, setOutcome] = useState<GiftShareOutcome | null>(null);
  const name = payer.first_name ?? t("giftshare.someone", locale);
  const headingId = `${id}-title`;

  if (outcome) {
    return (
      <p role="status" className="rounded-xl border border-brand-green/30 bg-soft-sage/60 p-4 text-sm dark:bg-brand-green/15">
        {outcome === "shared" ? t("giftshare.done", locale, { name }) : t("giftshare.not_now_done", locale)}
      </p>
    );
  }

  function toggle(p: GiftSharePermission) {
    setProblem(null);
    setTicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }
  function tickUsual() {
    setProblem(null);
    setTicked((cur) => [...new Set([...cur, ...GIFT_SHARE_USUAL])]);
    setMonthly(true);
  }
  function finish(o: GiftShareOutcome) {
    setOutcome(o);
    onDone?.(o);
  }
  async function submit() {
    if (ticked.length === 0) {
      setProblem("nothing");
      return;
    }
    setProblem(null);
    try {
      await share.mutateAsync({ payerId: payer.payer_id, permissions: ticked, monthlyReport: monthly });
      finish("shared");
    } catch (e) {
      setProblem(e instanceof Error && e.message.includes("circle_full") ? "full" : "failed");
    }
  }

  const problemText =
    problem === "nothing" ? t("giftshare.nothing_ticked", locale) : problem === "full" ? t("giftshare.error_full", locale) : problem === "failed" ? t("giftshare.error", locale) : null;

  return (
    <Card variant="soft" aria-labelledby={headingId} className="overflow-hidden">
      <CardHeader className="gap-2">
        <CardTitle as={headingLevel} id={headingId} className="text-lg sm:text-xl">
          {t("giftshare.title", locale, { name })}
        </CardTitle>
        <p className={`text-sm leading-relaxed ${MUTED}`}>{t("giftshare.intro", locale, { name })}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card">
          <p className={`text-sm leading-relaxed ${MUTED}`}>{t("giftshare.usual_hint", locale)}</p>
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={share.isPending} onClick={tickUsual}>
            {t("giftshare.usual", locale)}
          </Button>
        </div>

        <fieldset className="space-y-1" aria-describedby={problemText ? `${id}-error` : undefined}>
          <legend className="mb-2 text-sm font-semibold">{t("giftshare.legend", locale)}</legend>
          {GIFT_SHARE_PERMISSIONS.map((p) => {
            const boxId = `${id}-${p}`;
            return (
              <div key={p} className={ROW}>
                <input id={boxId} type="checkbox" className={BOX} checked={ticked.includes(p)} onChange={() => toggle(p)} disabled={share.isPending} />
                <Label htmlFor={boxId} className="flex-1 cursor-pointer font-normal leading-snug">{t(permissionKey(p), locale)}</Label>
              </div>
            );
          })}
          <div className={ROW}>
            <input id={`${id}-monthly`} type="checkbox" className={BOX} checked={monthly} onChange={() => { setProblem(null); setMonthly((m) => !m); }} disabled={share.isPending} />
            <Label htmlFor={`${id}-monthly`} className="flex-1 cursor-pointer font-normal leading-snug">{t("giftshare.monthly", locale)}</Label>
          </div>
        </fieldset>

        <FormError id={`${id}-error`} message={problemText} />

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <Button type="button" variant="ghost" className="min-h-11" disabled={share.isPending} onClick={() => finish("not_now")}>
            {t("giftshare.not_now", locale)}
          </Button>
          <Button type="button" className="min-h-11 sm:ml-auto" disabled={share.isPending} aria-busy={share.isPending} onClick={() => void submit()}>
            {share.isPending ? t("giftshare.saving", locale) : t("giftshare.share", locale)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
