"use client";

import { useWellnessBadgesCatalogue, useMyWellnessBadges } from "@/lib/queries/wellness";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

export function BadgesGrid({ patientId }: { patientId: string }) {
  const { data: catalogue, isLoading } = useWellnessBadgesCatalogue();
  const { data: earned } = useMyWellnessBadges(patientId);

  const earnedIds = new Set((earned ?? []).map((b) => b.badge_id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.badge className="h-5 w-5 text-sprout-gold" strokeWidth={2} aria-hidden />
          Badges
        </CardTitle>
        <CardDescription>
          {earned?.length ?? 0} of {catalogue?.length ?? 0} earned.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {catalogue && catalogue.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {catalogue.map((badge) => {
              const isEarned = earnedIds.has(badge.id);
              return (
                <li
                  key={badge.id}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center",
                    isEarned
                      ? "border-brand-green/30 bg-brand-green/5 dark:bg-brand-green/10"
                      : "border-charcoal-ink/10 dark:border-night-ink/15 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 opacity-60"
                  )}
                >
                  <SEMANTIC_ICON.badge
                    className={cn("h-6 w-6", isEarned ? "text-sprout-gold" : "text-charcoal-ink/30 dark:text-night-ink/45")}
                    strokeWidth={2} aria-hidden />
                  <p className="text-xs font-medium text-charcoal-ink dark:text-night-ink">{badge.name}</p>
                  <p className="text-[11px] leading-snug text-charcoal-ink/60 dark:text-night-ink/60">{badge.description}</p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
