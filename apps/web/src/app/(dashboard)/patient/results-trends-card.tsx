"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { LIPID_ANALYTE_META, type LipidAnalyteCode } from "@/lib/lipids/analytes";

interface AnalyteReading {
  code: string;
  value: number;
  unit: string | null;
  taken_at: string;
}

interface AnalyteTrend {
  code: string;
  latest: AnalyteReading;
  previous: AnalyteReading | null;
}

/** Display names for non-lipid analytes; lipids come from LIPID_ANALYTE_META.
 * Fallback humanises the raw code (same rule as patient-timeline's fix). */
const ANALYTE_LABEL: Record<string, string> = {
  hba1c: "HbA1c",
  fasting_glucose: "Fasting glucose",
  psa: "PSA",
  creatinine: "Creatinine",
  egfr: "eGFR",
};

function labelFor(code: string): string {
  if (code in LIPID_ANALYTE_META) return LIPID_ANALYTE_META[code as LipidAnalyteCode].label;
  if (code in ANALYTE_LABEL) return ANALYTE_LABEL[code];
  const spaced = code.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function useAnalyteTrends(patientId: string) {
  return useQuery({
    queryKey: ["analyte-trends", patientId],
    queryFn: async (): Promise<AnalyteTrend[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_analyte_readings")
        .select("code, value, unit, taken_at")
        .eq("patient_id", patientId)
        .order("taken_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      const byCode = new Map<string, AnalyteReading[]>();
      for (const row of (data ?? []) as AnalyteReading[]) {
        const list = byCode.get(row.code) ?? [];
        if (list.length < 2) list.push(row);
        byCode.set(row.code, list);
      }
      return [...byCode.entries()]
        .map(([code, readings]) => ({ code, latest: readings[0], previous: readings[1] ?? null }))
        .sort((a, b) => (a.latest.taken_at < b.latest.taken_at ? 1 : -1));
    },
    enabled: !!patientId,
  });
}

/**
 * "Your numbers moved" — latest value per lab analyte with the change since
 * the previous test. Deliberately neutral presentation: a delta and dates,
 * never a per-analyte good/bad verdict — interpretation is the reviewing
 * doctor's job (results carry doctor review via the existing pipelines).
 * The retention insight behind it: year-on-year deltas are what make an
 * annual check worth repeating.
 */
export function ResultsTrendsCard({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useAnalyteTrends(patientId);

  if (isLoading || isError) return null;
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.labs className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your results over time
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-charcoal-ink/60">
          Each lab result, compared with your previous one. Changes here are for tracking, not
          diagnosis — your doctor reviews what they mean.
        </p>
        <ul className="divide-y divide-charcoal-ink/10">
          {data.map(({ code, latest, previous }) => {
            const delta = previous ? latest.value - previous.value : null;
            return (
              <li key={code} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">{labelFor(code)}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {new Date(latest.taken_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {previous &&
                      ` · previous ${new Date(previous.taken_at).toLocaleDateString("en-GB", {
                        month: "short",
                        year: "numeric",
                      })}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-charcoal-ink">
                    {latest.value}
                    {latest.unit ? ` ${latest.unit}` : ""}
                  </p>
                  {delta !== null && (
                    <p className="text-xs text-charcoal-ink/60">
                      {delta === 0
                        ? "no change"
                        : `${delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta * 100) / 100)} since last test`}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
