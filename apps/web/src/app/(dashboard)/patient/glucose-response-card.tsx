"use client";

import { useQuery } from "@tanstack/react-query";
import { t } from "@tarragon/i18n";
import { getProposedConfig, formatGlucose, GLUCOSE_UNIT_LABEL } from "@tarragon/shared";
import { mealsFromFoodLogs, parseGlucoseSeries, responseRows, summariseGlucoseResponse, type GlucoseResponseConfig, type GlucoseResponseSummary } from "@tarragon/clinical/glucose-response";
import { createClient } from "@/lib/supabase/client";
import { useGlucoseUnit } from "@/components/glucose-unit-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const config = getProposedConfig("glucose_response.rules").value as unknown as GlucoseResponseConfig;

type Loaded = { state: "unavailable" } | { state: "ok"; summary: GlucoseResponseSummary };

/** Reads the meals (food_logs, RLS) and the readings (public.my_glucose_series, which applies the guard and the withheld rule) and pairs them in the browser with the shared pure rules. */
async function load(): Promise<Loaded> {
  const supabase = createClient();
  const now = new Date();
  const since = new Date(now.getTime() - config.max_age_days * 86_400_000).toISOString();
  const [series, meals] = await Promise.all([
    supabase.rpc("my_glucose_series", { p_days: config.max_age_days }),
    supabase.from("food_logs").select("id, logged_at, items").gte("logged_at", since).order("logged_at", { ascending: false }).limit(500),
  ]);
  if (series.error || meals.error) return { state: "unavailable" };
  const parsed = parseGlucoseSeries(series.data);
  if (parsed.state === "unavailable") return { state: "unavailable" };
  const rows = (meals.data ?? []).flatMap((m) => (m.id && m.logged_at ? [{ id: m.id, logged_at: m.logged_at, items: m.items }] : []));
  return { state: "ok", summary: summariseGlucoseResponse(mealsFromFoodLogs(rows), parsed.points, config, now.toISOString()) };
}

/**
 * Personal glucose-response insights (S50b, 6.11). Ranges and sample counts only: it never ranks, scores or colours a food, never says a food
 * caused a change, and shows nothing for a food with fewer paired meals than the configured minimum. Deterministic: no language model.
 * Behind the glucose_response_insights go-live guard (OFF): while off, or for a person the nutrition rules withhold targets from, the card is not shown.
 */
export function GlucoseResponseCard() {
  const unit = useGlucoseUnit();
  const q = useQuery({ queryKey: ["glucose-response"], queryFn: load, staleTime: 5 * 60 * 1000 });
  if (q.isLoading || !q.data || q.data.state === "unavailable") return null;
  const { summary } = q.data;
  const fmt = (mmol: number): string => formatGlucose(mmol, unit, { withUnit: false }) ?? "";
  const rows = responseRows(summary, fmt, GLUCOSE_UNIT_LABEL[unit]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("glucose.response.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{t("glucose.response.intro")}</p>
        <p className="text-charcoal-ink/70">{t("glucose.response.counts", "en", { paired: summary.pairedMeals, meals: summary.mealsConsidered })}</p>
        {!summary.enoughData ? (
          <p>{t("glucose.response.not_enough", "en", { n: config.min_pairs_to_show })}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.key} className="space-y-1">
                <p className="font-medium">{r.key === "all" ? t("glucose.response.all") : r.label}</p>
                <p>
                  {r.key === "all"
                    ? t("glucose.response.row_all", "en", { after: r.after, before: r.before, n: r.n })
                    : t("glucose.response.row", "en", { food: r.label, after: r.after, before: r.before, n: r.n })}
                </p>
                <p className="text-charcoal-ink/70">{t("glucose.response.change", "en", { change: r.change })}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-charcoal-ink/70">{t("glucose.response.disclaimer")}</p>
      </CardContent>
    </Card>
  );
}
