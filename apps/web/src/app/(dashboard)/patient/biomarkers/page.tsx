import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { t, type MessageKey } from "@tarragon/i18n";
import { getProposedConfig, type BiomarkerBand } from "@tarragon/shared";
import { BiomarkerResultCard } from "@/components/biomarker/biomarker-result-card";
import { LifestyleGuide, type LifestyleItem } from "@/components/biomarker/lifestyle-guide";
import { ResultExplainer } from "@/components/result-explainer";
import { activeBiomarkerBands, gradeResult } from "@/lib/biomarkers/grade";
import { displayCode, groupByUnit, labRangeLabel, parseTrend, targetLabel } from "@/lib/biomarkers/trend";
import { TrendChart } from "./trend-chart";

interface ListItem {
  code: string;
  readings: number;
  last_at: string;
  latest_value: number | null;
  latest_unit: string | null;
}

function fmt(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

/**
 * Every released numeric result, test by test, across years (S43, spec 2.5). The
 * database returns only results the person may see (released, not withdrawn, never
 * a sensitive positive) with the laboratory's own range on each. Nothing here
 * invents a range or says what a result means.
 */
export default async function BiomarkersPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { subjectId, uiLanguage } = await getPatientDashboardContext();
  const { code } = await searchParams;
  const supabase = await createClient();

  const { data: listRaw } = await supabase.rpc("patient_biomarker_list", { p_patient: subjectId });
  const list = (Array.isArray(listRaw) ? listRaw : []) as unknown as ListItem[];
  const selected = code && list.some((i) => i.code === code) ? code : list[0]?.code;

  let series = null;
  if (selected) {
    const { data } = await supabase.rpc("patient_biomarker_trend", { p_code: selected, p_patient: subjectId });
    series = parseTrend(data);
  }
  const groups = series ? groupByUnit(series.points) : [];

  // One latest-result card per test. The Tarragon grade and range bar appear only once the CMO has confirmed the bands.
  const bands = activeBiomarkerBands();
  const cards = (
    await Promise.all(
      list.map(async (item) => {
        const { data } = await supabase.rpc("patient_biomarker_trend", { p_code: item.code, p_patient: subjectId });
        const latest = parseTrend(data)?.points.at(-1);
        return latest ? { code: item.code, latest } : null;
      }),
    )
  ).filter((c): c is NonNullable<typeof c> => c !== null);
  const guide = getProposedConfig("biomarkers.lifestyle_guide").value as unknown as { items: LifestyleItem[] };

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: t("passport.back", uiLanguage) }}
        title={t("biomarkers.title", uiLanguage)}
        icon={NAV_ICON.analytics}
        description={t("biomarkers.description", uiLanguage)}
      />

      {list.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("biomarkers.none", uiLanguage)}</p>
      ) : (
        <>
          <section aria-label={t("biomarkers.pick", uiLanguage)} className="grid gap-3 sm:grid-cols-2">
            {cards.map(({ code: c, latest }) => {
              const grade = gradeResult(c, latest, bands);
              const band: BiomarkerBand | null = grade ? (bands?.analytes[c] ?? null) : null;
              return (
                <BiomarkerResultCard
                  key={c}
                  code={c}
                  point={latest}
                  grade={grade}
                  band={band}
                  selected={c === selected}
                  href={`/patient/biomarkers?code=${encodeURIComponent(c)}`}
                  uiLanguage={uiLanguage}
                >
                  <ResultExplainer kind="lab_analyte" subjectKey={c} label={displayCode(c)} />
                </BiomarkerResultCard>
              );
            })}
          </section>

          {series && (
            <>
              {series.unitMixed && (
                <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  {t("biomarkers.unit_mixed", uiLanguage)}
                </p>
              )}
              {series.target && (
                <p className="text-sm font-medium text-deep-forest dark:text-brand-green-bright">
                  {t("biomarkers.care_target", uiLanguage, { range: targetLabel(series.target) })}
                </p>
              )}
              {groups.map((g) => (
                <Card key={g.unit ?? "none"}>
                  <CardHeader>
                    <CardTitle>
                      {displayCode(series.code)}
                      {g.unit ? ` (${g.unit})` : ""}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <TrendChart code={series.code} unit={g.unit} points={g.points} target={groups.length === 1 ? series.target : null} />
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-charcoal-ink/60">
                            <th className="py-1 pr-3 font-medium">{t("biomarkers.col.date", uiLanguage)}</th>
                            <th className="py-1 pr-3 font-medium">{t("biomarkers.col.result", uiLanguage)}</th>
                            <th className="py-1 pr-3 font-medium">{t("biomarkers.col.range", uiLanguage)}</th>
                            <th className="py-1 font-medium">{t("biomarkers.col.from", uiLanguage)}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...g.points].reverse().map((p, i) => (
                            <tr key={i} className="border-t border-charcoal-ink/10">
                              <td className="py-1 pr-3">{fmt(p.takenAt)}</td>
                              <td className="py-1 pr-3">
                                {p.value}
                                {p.unit ? ` ${p.unit}` : ""}
                                {p.flag && p.flag !== "normal" && (
                                  <span className="ml-2 text-xs text-charcoal-ink/70">{t(`biomarkers.flag.${p.flag}` as MessageKey, uiLanguage)}</span>
                                )}
                              </td>
                              <td className="py-1 pr-3">{labRangeLabel(p) ?? ""}</td>
                              <td className="py-1">{p.laboratory ?? t(`biomarkers.source.${p.source}` as MessageKey, uiLanguage)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("biomarkers.note", uiLanguage)}</p>
            </>
          )}
          <LifestyleGuide items={guide.items} uiLanguage={uiLanguage} />
        </>
      )}
    </div>
  );
}

export type { ListItem };
