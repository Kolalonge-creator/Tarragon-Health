"use client";

import Link from "next/link";
import { useMyServicePurchases, isPurchaseCurrentlyActive } from "@/lib/queries/service-purchases";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { formatPatientDate } from "@/lib/format-date";

/**
 * Whether a doctor is watching this person's readings, and until when.
 *
 * This is the platform's flagship promise and, until 2026-09-10, nobody could
 * see its state anywhere — because nobody could hold it. The escalation feature
 * was granted by exactly one product, the never-sold 12-week pack, so in
 * practice no patient on the platform had a doctor behind their readings at
 * all.
 *
 * TWO THINGS THIS CARD MUST NEVER DO
 *
 * 1. Imply that an uncovered patient is unmonitored or unsafe. They are not.
 *    Every reading is checked against care protocols whatever they pay, and the
 *    full emergency safety net — acknowledge-gated guidance, emergency contact
 *    notified, follow-up afterwards — never depended on payment and never will.
 *    What cover adds is a named doctor being told. Fear-based urgency is also
 *    against the brand voice rules, and here it would be dishonest as well.
 * 2. Auto-renew, or suggest that it might. The pricing page promises no
 *    subscription, no stored card and nothing to cancel. This card exists partly
 *    to keep that promise honest: it tells someone their cover is ending in good
 *    time so the end is never a surprise.
 */

const ENDING_SOON_DAYS = 21;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function MonitoringCoverCard() {
  const { data: purchases, isLoading } = useMyServicePurchases();
  if (isLoading) return null;

  const cover = (purchases ?? [])
    .filter(isPurchaseCurrentlyActive)
    .filter((purchase) => {
      const code = purchase.service_product?.code ?? "";
      return code.startsWith("continuous_monitoring_") || code.startsWith("weight_management_");
    })
    .sort((a, b) => (b.expires_at ?? "").localeCompare(a.expires_at ?? ""))[0];

  if (!cover) {
    return (
      <Card className="border-brand-green/25">
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              Nobody is alerted when one of your readings is dangerous
            </p>
            <p className="mt-1 text-xs leading-relaxed text-charcoal-ink/65 dark:text-night-ink/65">
              Every reading you log is still checked against care protocols, and you still get the
              full emergency safety net: immediate guidance, your emergency contact notified, and a
              check-in afterwards. Continuous Monitoring adds a doctor on your care team being told
              as well, from ₦7,500 for three months. Nothing renews and no card is kept.
            </p>
          </div>
          <Button asChild size="sm" className="self-start">
            <Link href="/patient/subscription">See Continuous Monitoring</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const endsAt = cover.expires_at;
  const remaining = endsAt ? daysUntil(endsAt) : null;
  const endingSoon = remaining !== null && remaining <= ENDING_SOON_DAYS;

  return (
    <Card className={endingSoon ? "border-amber-400/50" : "border-brand-green/30"}>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <SEMANTIC_ICON.clinicianFollowUp
            className="mt-0.5 h-5 w-5 shrink-0 text-deep-forest dark:text-brand-green-bright"
            strokeWidth={2}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              A doctor is watching your readings
            </p>
            <p className="mt-1 text-xs leading-relaxed text-charcoal-ink/65 dark:text-night-ink/65">
              {endsAt ? (
                <>
                  Your {cover.service_product?.name ?? "cover"} runs until{" "}
                  {formatPatientDate(new Date(endsAt), {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                  {endingSoon ? (
                    <>
                      , ending in {remaining} day{remaining === 1 ? "" : "s"}. It will simply stop
                      then; nothing renews on its own.
                    </>
                  ) : (
                    <>. It will simply stop then; nothing renews on its own.</>
                  )}
                </>
              ) : (
                <>Your cover has no end date.</>
              )}
            </p>
          </div>
        </div>
        {endingSoon ? (
          <Button asChild size="sm" variant="outline" className="self-start">
            <Link href="/patient/subscription">Extend it</Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
