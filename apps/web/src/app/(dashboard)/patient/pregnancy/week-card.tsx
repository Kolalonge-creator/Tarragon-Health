"use client";

import { weekCardState } from "@tarragon/clinical";
import { t } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePregnancyWeekContent } from "@/lib/queries/pregnancy-tools";

/**
 * Week by week (S67, spec 16.5). Shows only a row the CMO has marked reviewed. No row is seeded, so today every patient sees the calm
 * "coming soon from your care team" line; nothing is ever written or generated here (OQ-343).
 */
export function WeekCard({ week }: { week: number | null }) {
  const content = usePregnancyWeekContent(week);
  // A failed or loading read is shown as "coming soon", never as invented text.
  const state = weekCardState(week, content.data ?? []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("preg.ui.week.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {state.kind === "unknown_week" && <p className="text-sm">{t("preg.ui.week.unknown")}</p>}
        {state.kind === "coming_soon" && (
          <>
            <p className="text-sm font-medium">{t("preg.ui.week.heading", "en", { week: state.week })}</p>
            <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("preg.ui.week.coming_soon")}</p>
          </>
        )}
        {state.kind === "content" && (
          <>
            <p className="text-sm font-medium">{t("preg.ui.week.heading", "en", { week: state.week })}</p>
            <h3 className="text-base font-semibold">{state.title}</h3>
            <p className="whitespace-pre-line text-sm">{state.body}</p>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("preg.ui.card_label")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
