"use client";

import Link from "next/link";
import { useWellnessPointsBalance, useMyWellnessBadges } from "@/lib/queries/wellness";
import { Card, CardContent } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/** Compact dashboard teaser for the full Wellness hub at /patient/wellness. */
export function WellnessPointsSummary({ patientId }: { patientId: string }) {
  const { data: balance } = useWellnessPointsBalance(patientId);
  const { data: badges } = useMyWellnessBadges(patientId);

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <SEMANTIC_ICON.points className="h-8 w-8 text-sprout-gold" strokeWidth={2} />
          <div>
            <p className="font-heading text-xl font-bold text-charcoal-ink">
              {(balance?.balance ?? 0).toLocaleString()} points
            </p>
            <p className="text-xs text-charcoal-ink/60">
              {badges?.length ?? 0} badge{badges?.length === 1 ? "" : "s"} earned · challenges &amp;
              rewards
            </p>
          </div>
        </div>
        <Link href="/patient/wellness" className="text-sm font-medium text-brand-green hover:underline">
          View →
        </Link>
      </CardContent>
    </Card>
  );
}
