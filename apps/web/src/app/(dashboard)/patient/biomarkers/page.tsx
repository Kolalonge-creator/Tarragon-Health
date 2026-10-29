import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { t, type MessageKey } from "@tarragon/i18n";
import type { BiomarkerBand } from "@tarragon/shared";
import { BiomarkerResultCard } from "@/components/biomarker/biomarker-result-card";
import { LifestyleGuide, type LifestyleItem } from "@/components/biomarker/lifestyle-guide";
import { ResultExplainer } from "@/components/result-explainer";
import { activeBiomarkerBands, gradeResult, latestConfirmedConfig } from "@/lib/biomarkers/grade";
import { filterTrendPoints, parseTrendRange, sourcesIn, TREND_RANGES } from "@/lib/biomarkers/filter";
import { displayCode, groupByUnit, labRangeLabel, parseTrend, targetLabel, type TrendPoint } from "@/lib/biomarkers/trend";
import { TrendChart } from "./trend-chart";

interface ListItem {
  code: string;
  readings: number;
  last_at: string;
  latest_value: number | null;
  latest_unit: string | null;
  disputed?: boolean;
  latest_flag: string | null;
  latest_ref_low: number | null;
  latest_ref_high: number | null;
  latest_ref_text: string | null;
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
export default async function BiomarkersPage({ searchParams }: { searchParams: Promise<{ code?: string; range?: string; source?: string }> }) {
  const { subjectId, uiLanguage } = await getPatientDashboardContext();
  const { code, range: rangeParam, source: sourceParam } = await searchParams;
  const range = parseTrendRange(rangeParam);
  const supabase = await createClient();

  const { data: listRaw } = await supabase.rpc("patient_biomarker_list", { p_patient: subjectId });
  const list = (Array.isArray(listRaw) ? listRaw : []) as unknown as ListItem[];
  const selected = code && list.some((i) => i.code === code) ? code : list[0]?.code;

  let series = null;
  if (selected) {
    const { data } = await supabase.rpc("patient_biomarker_trend", { p_code: selected, p_patient: subjectId });
    series = parseTrend(data);
  }
  const allSources = series ? sourcesIn(series.points) : [];
  const source = sourceParam && allSources.includes(sourceParam) ? sourceParam : undefined;
  const filtered = series ? filterTrendPoints(series.points, range, source) : [];
  const groups = series ? groupByUnit(filtered) : [];
  const filterHref = (next: { range?: string; source?: string }) => {
    const q = new URLSearchParams();
    if (selected) q.set("code", selected);
    const r = next.range ?? range;
    if (r !== "all") q.set("range", r);
    const s = "source" in next ? next.source : source;
    if (s) q.set("source", s);
    return `/patient/biomarkers?${q.toString()}`;
  };
  // Switching test keeps the chosen period; the source is dropped because another test may not have it.
  const codeHref = (c: string) => `/patient/biomarkers?code=${encodeURIComponent(c)}${range === "all" ? "" : `&range=${range}`}`;
  const KNOWN_SOURCES = ["lab_result", "legacy_report"];
  const sourceLabel = (s: string) => (KNOWN_SOURCES.includes(s) ? t(`biomarkers.source.${s}` as MessageKey, uiLanguage) : s);
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm ${on ? "border-brand-green bg-soft-sage font-medium text-deep-forest" : "border-charcoal-ink/15 hover:bg-charcoal-ink/5"}`;

  // One latest-result card per test. The Tarragon grade and range bar appear only once the CMO has confirmed the bands.
  const bands = activeBiomarkerBands();
  const cards = list.flatMap((item) =>
    item.latest_value === null
      ? []
      : [{
          code: item.code,
          latest: {
            takenAt: item.last_at,
            value: Number(item.latest_value),
            unit: item.latest_unit,
            refLow: item.latest_ref_low === null ? null : Number(item.latest_ref_low),
            refHigh: item.latest_ref_high === null ? null : Number(item.latest_ref_high),
            refText: item.latest_ref_text,
            flag: item.latest_flag,
            source: "lab_result",
            laboratory: null,
          } satisfies TrendPoint,
        }],
  );
  // Unapproved wording is never shown: the guide appears only once the CMO has confirmed it.
  const guide = latestConfirmedConfig<{ items: LifestyleItem[] }>("biomarkers.lifestyle_guide");

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
                  href={codeHref(c)}
                  uiLanguage={uiLanguage}
                >
                  <ResultExplainer kind="lab_analyte" subjectKey={c} label={displayCode(c)} />
                </BiomarkerResultCard>
              );
            })}
          </section>
          {list.some((i) => i.disputed === true) && (
            <nav aria-label={t("biomarkers.pick", uiLanguage)} className="flex flex-wrap gap-2">
              {list
                .filter((i) => i.disputed === true)
                .map((item) => (
                  <Link
                    key={item.code}
                    href={codeHref(item.code)}
                    aria-current={item.code === selected ? "page" : undefined}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      item.code === selected ? "border-brand-green bg-soft-sage font-medium text-deep-forest" : "border-charcoal-ink/15 hover:bg-charcoal-ink/5"
                    }`}
                  >
                    {displayCode(item.code)}
                    <span className="ml-2 text-xs text-amber-900">{t("biomarkers.list_disputed", uiLanguage)}</span>
                  </Link>
                ))}
            </nav>
          )}

          {series && (
            <>
              <div className="space-y-3">
                <nav aria-label={t("biomarkers.filter.range", uiLanguage)} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-charcoal-ink/70">{t("biomarkers.filter.range", uiLanguage)}</span>
                  {TREND_RANGES.map((r) => (
                    <Link key={r} href={filterHref({ range: r })} aria-current={r === range ? "true" : undefined} className={chip(r === range)}>
                      {t(`biomarkers.filter.range.${r}` as MessageKey, uiLanguage)}
                    </Link>
                  ))}
                </nav>
                {allSources.length > 1 && (
                  <nav aria-label={t("biomarkers.filter.source", uiLanguage)} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-charcoal-ink/70">{t("biomarkers.filter.source", uiLanguage)}</span>
                    <Link href={filterHref({ source: undefined })} aria-current={!source ? "true" : undefined} className={chip(!source)}>
                      {t("biomarkers.filter.source.all", uiLanguage)}
                    </Link>
                    {allSources.map((s) => (
                      <Link key={s} href={filterHref({ source: s })} aria-current={s === source ? "true" : undefined} className={chip(s === source)}>
                        {sourceLabel(s)}
                      </Link>
                    ))}
                  </nav>
                )}
              </div>
              {groups.length === 0 && (
                <p role="status" className="text-sm text-charcoal-ink/70">{t("biomarkers.filter.empty", uiLanguage)}</p>
              )}
              {groups.length > 1 && (
                <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  {t("biomarkers.unit_mixed", uiLanguage)}
                </p>
              )}
              {filtered.some((p) => p.disagrees) && (
                <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  {t("biomarkers.disputed", uiLanguage)}
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
                              <td className="py-1">
                                {p.laboratory ?? t(`biomarkers.source.${p.source}` as MessageKey, uiLanguage)}
                                {p.alsoFrom && (
                                  <span className="block text-xs text-charcoal-ink/60">
                                    {t("biomarkers.also_from", uiLanguage, { source: t(`biomarkers.source.${p.alsoFrom}` as MessageKey, uiLanguage) })}
                                  </span>
                                )}
                                {p.disagrees && <span className="block text-xs text-amber-900">{t("biomarkers.disagrees", uiLanguage)}</span>}
                              </td>
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
          {guide && <LifestyleGuide items={guide.items} uiLanguage={uiLanguage} />}
        </>
      )}
    </div>
  );
}

export type { ListItem };
