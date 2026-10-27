import { moodInsights, moodInsightsConfig, renderInsight, type MoodInsightsResult } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { fetchMoodTrendDays } from "@/lib/queries/mood-trend-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PatternsVisibilityButton } from "@/components/mental-health/mood-patterns-visibility";

const tr = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, "en", params);

/**
 * Patterns in a patient's own check-ins (S56b, function 3). A SERVER component: the patient's entries are read with their own session (owner
 * row-level security), the counts are worked out here, and only finished sentences reach the browser. Nothing is stored, nothing is sent
 * anywhere, no analytics runs on this screen, no push is ever sent about it, and the result is never read by a score, a task or an alert.
 * Only the patient's own profile can see it (never a caregiver acting for someone). Behind the guard mood_insights_enabled.
 */
export async function MoodPatterns({ patientId, hidden }: { patientId: string; hidden: boolean }) {
  if (hidden) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">{tr("insights.title")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{tr("insights.hidden")}</p>
          <PatternsVisibilityButton hide={false} />
        </CardContent>
      </Card>
    );
  }
  let result: MoodInsightsResult | null = null;
  try {
    const cfg = moodInsightsConfig();
    const days = await fetchMoodTrendDays(await createClient(), patientId, cfg.window_days);
    result = moodInsights(days, { config: cfg });
  } catch {
    result = null;
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{tr("insights.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-charcoal-ink/80 dark:text-night-ink/80">{tr("insights.intro")}</p>
        {result === null ? (
          <p className="text-charcoal-ink/70 dark:text-night-ink/70">{tr("insights.error")}</p>
        ) : result.status === "not_enough_data" ? (
          <p>{tr("insights.need_more", { days: result.neededDays, window: result.windowDays, have: result.daysWithMood })}</p>
        ) : (
          <>
            {result.insights.length === 0 ? (
              <p>{tr("insights.none")}</p>
            ) : (
              <ul className="list-disc space-y-2 pl-5">
                {result.insights.map((i) => (
                  <li key={`${i.kind}-${i.tag ?? i.weekday ?? ""}`}>{renderInsight(i, tr)}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">
              {tr("insights.basis", { days: result.daysWithMood, window: result.windowDays, median: result.medianMood ?? "-" })}
            </p>
          </>
        )}
        <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{tr("insights.not_advice")}</p>
        <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{tr("insights.private")}</p>
        <PatternsVisibilityButton hide />
      </CardContent>
    </Card>
  );
}
