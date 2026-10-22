"use client";

import { useQuery } from "@tanstack/react-query";
import { t, type Locale } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { loose } from "@/lib/clinician/loose-client";
import { analyteLabel, myTrendsSchema } from "@/lib/lab-results/lifecycle";
import { formatPatientDate } from "@/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * S27h: released, coded, numeric values beside the previous one, with the care team's note if they wrote one. The database returns only
 * released results, never a held one, never a screening analyte, never a patient's own upload, and no range or flag: this card adds none.
 * With fewer than two values for a test it shows nothing for that test; with no trend at all it renders nothing.
 */
export function LabTrendCard({ patientId, locale }: { patientId: string; locale: Locale }) {
  const q = useQuery({
    queryKey: ["my-lab-trends", patientId],
    queryFn: async () => {
      const { data, error } = await loose(createClient()).rpc("my_lab_trends");
      if (error) throw error;
      return myTrendsSchema.parse(data ?? []);
    },
  });
  if (q.isError) return <p role="alert" className="text-sm text-red-700">{t("labtrend.error", locale)}</p>;
  if (!q.data || q.data.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("labtrend.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={`text-sm ${MUTED}`}>{t("labtrend.intro", locale)}</p>
        <ul className="space-y-3">
          {q.data.map((tr) => (
            <li key={`${tr.analyte_code}-${tr.unit}`} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{analyteLabel(tr.analyte_code)}</p>
              <dl className="mt-1 grid grid-cols-2 gap-2">
                <div>
                  <dt className={MUTED}>{t("labtrend.last", locale)}</dt>
                  <dd>{tr.previous.value} {tr.unit} <span className={MUTED}>({formatPatientDate(tr.previous.released_at)})</span></dd>
                </div>
                <div>
                  <dt className={MUTED}>{t("labtrend.now", locale)}</dt>
                  <dd>{tr.latest.value} {tr.unit} <span className={MUTED}>({formatPatientDate(tr.latest.released_at)})</span></dd>
                </div>
              </dl>
              <p className="mt-1">{t(`labtrend.${tr.direction}` as const, locale)}</p>
              {tr.note ? (
                <p className={`mt-1 ${MUTED}`}>
                  <span className="font-medium">{t("labtrend.note", locale)}: </span>
                  {tr.note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
