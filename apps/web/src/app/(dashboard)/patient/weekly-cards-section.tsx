import { t } from "@tarragon/i18n";
import type { WeeklySummary } from "@tarragon/clinical/today";
import { createClient } from "@/lib/supabase/server";
import { loadWeeklyCards } from "@/lib/today/weekly-cards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** The four weekly cards, drawn from a built summary. Words only; a card that has too little to say says so calmly. */
export function WeeklyCardsBody({ summary }: { summary: WeeklySummary }) {
  if (summary.cards.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("weekly.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="grid gap-3 sm:grid-cols-2">
          {summary.cards.map((c) => (
            <li key={c.code} className="rounded-lg border p-3">
              <p className="text-sm font-semibold">{t(c.title.key, "en", c.title.params)}</p>
              <p className="text-sm">{t(c.line.key, "en", c.line.params)}</p>
              {c.state === "not_enough" ? <p className="text-xs text-charcoal-ink/60">{t("weekly.state.not_enough")}</p> : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("weekly.caption")}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Loads and shows the weekly cards for the signed-in person's own account. Shows nothing at all until the Chief Medical Officer has signed the Today
 * screen configuration, and nothing when no source could be read.
 */
export async function WeeklyCardsSection({ patientId }: { patientId: string }) {
  const result = await loadWeeklyCards(await createClient(), patientId);
  if (result.state !== "ready") return null;
  return <WeeklyCardsBody summary={result.summary} />;
}
