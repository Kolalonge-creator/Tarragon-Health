"use client";

import { milestoneCopy, t } from "@tarragon/i18n";
import { useDismissMilestone, useMyPendingMilestone } from "@/lib/queries/wellness";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * S58b. One calm card for a care step that was just done (a first check logged, a first lab, four weeks of check-ins).
 * It celebrates doing the step, never what it found, and never body size. There is no animation (nothing to switch off for
 * reduced motion), no counter, no comparison and no loss wording. It is shown until dismissed, never blocks the page, and the
 * database returns nothing at all while an emergency is open, so a red flow always comes first.
 */
export function MilestoneCard({ patientId }: { patientId: string }) {
  const { data: milestone } = useMyPendingMilestone(patientId);
  const dismiss = useDismissMilestone(patientId);
  if (!milestone) return null;
  const copy = milestoneCopy(milestone.code);

  return (
    <Card role="status" aria-live="polite" className="border-brand-green/30 bg-brand-green/5 dark:bg-brand-green/10">
      <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SEMANTIC_ICON.badge className="mt-0.5 h-5 w-5 shrink-0 text-sprout-gold" strokeWidth={2} aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">{t("points.milestone.heading")}</p>
            <h2 className="font-heading text-base font-semibold text-charcoal-ink dark:text-night-ink">{copy.title}</h2>
            <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{copy.body}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate(milestone.id)}>
          {t("points.milestone.dismiss")}
        </Button>
      </CardContent>
    </Card>
  );
}
