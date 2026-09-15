import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { VaccinationCoverageSummary } from "@/lib/vaccination/load-coverage-analytics";

/**
 * Spec §43.15 — vaccination coverage for employers/insurers: eligible
 * population, vaccinated, overdue, uptake, and geographic variation.
 * Extracted from the corporate dashboard so it can be reused verbatim by the
 * HMO dashboard, same as CohortSummary — the underlying loader is org-scoped,
 * not corporate/HMO-specific.
 *
 * Aggregate-only throughout (I9): every number here is a set size, never a
 * member; a suppressed cell renders as "too few to show" rather than 0 or a
 * blank, so it reads as withheld, not as "nobody."
 */
export function VaccinationCoveragePanel({
  coverage,
  entityLabel = "staff",
}: {
  coverage: VaccinationCoverageSummary | null;
  /** "staff" (default, corporate) or "member" (HMO) — copy only, same data. */
  entityLabel?: "staff" | "member";
}) {
  if (!coverage) return null;
  const plural = entityLabel === "member" ? "members" : "staff";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Vaccination coverage
        </CardTitle>
        <CardDescription>Aggregate immunisation status across enrolled {plural}.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            icon={SEMANTIC_ICON.family}
            label="Eligible population"
            value={String(coverage.eligiblePopulation)}
          />
          <StatTile
            icon={SEMANTIC_ICON.preventive}
            label="Vaccinated"
            value={String(coverage.vaccinatedCount)}
          />
          <StatTile
            icon={SEMANTIC_ICON.booking}
            label="Overdue"
            value={String(coverage.overdueCount)}
          />
          <StatTile
            icon={SEMANTIC_ICON.preventive}
            label="Uptake"
            value={String(coverage.uptakePercent)}
            unit="%"
          />
        </div>

        {coverage.byVaccine.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              By vaccine
            </p>
            <ul className="divide-y divide-charcoal-ink/10">
              {coverage.byVaccine.map((v) => (
                <li
                  key={v.vaccinationCatalogId}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="text-charcoal-ink">{v.vaccineName}</span>
                  <span className="text-charcoal-ink/60">
                    {v.vaccinatedCount === null ? "too few to show" : `${v.vaccinatedCount} vaccinated`}
                    {v.overdueCount !== null && v.overdueCount > 0
                      ? ` · ${v.overdueCount} overdue`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {coverage.byState.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              By state
            </p>
            <ul className="divide-y divide-charcoal-ink/10">
              {coverage.byState.map((s) => (
                <li key={s.state} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-charcoal-ink">{s.state}</span>
                  <span className="text-charcoal-ink/60">
                    {s.vaccinatedCount === null
                      ? "too few to show"
                      : `${s.vaccinatedCount} / ${s.eligibleCount} vaccinated`}
                  </span>
                </li>
              ))}
            </ul>
            {coverage.suppressedStateCount > 0 && (
              <p className="mt-1.5 text-xs text-charcoal-ink/50">
                {coverage.suppressedStateCount} further state
                {coverage.suppressedStateCount === 1 ? "" : "s"} not shown (too few {plural}).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
