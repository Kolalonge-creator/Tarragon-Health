import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ActivationFunnel, DepartmentBreakdownRow } from "@/lib/corporate/load-activation-funnel";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-heading text-2xl font-semibold text-charcoal-ink">{value}</p>
      <p className="text-xs text-charcoal-ink/60">{label}</p>
    </div>
  );
}

/** Module 26 §26.8's worked example (Employees eligible / Activated / Engaged
 * / Health assessment % / Preventive completion %). Every figure here already
 * passed the org-wide small-cell floor in loadActivationFunnel — this
 * component only ever renders what it was handed, never re-derives a count. */
export function ActivationFunnelCard({ funnel }: { funnel: ActivationFunnel | null }) {
  if (!funnel) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workforce activation</CardTitle>
          <CardDescription>Not enough eligible staff yet to report safely.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workforce activation</CardTitle>
        <CardDescription>Module 26 §26.8: eligibility through to engagement, this billing period.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatTile label="Eligible" value={String(funnel.eligible)} />
        <StatTile label="Activated" value={String(funnel.activated)} />
        <StatTile label="Engaged (90d)" value={String(funnel.engaged)} />
        <StatTile
          label="Health assessment"
          value={funnel.healthAssessmentPct !== null ? `${funnel.healthAssessmentPct}%` : "—"}
        />
        <StatTile
          label="Preventive completion"
          value={funnel.preventiveCompletionPct !== null ? `${funnel.preventiveCompletionPct}%` : "—"}
        />
      </CardContent>
    </Card>
  );
}

/** §26.9 — a department below the org's suppression floor renders its row
 * with the figures withheld (never omitted; an omitted row would itself
 * leak "this one is small"). */
export function DepartmentBreakdownTable({ rows }: { rows: DepartmentBreakdownRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>By department</CardTitle>
        <CardDescription>
          Module 26 §26.9: a department too small to report on safely shows &quot;too small to show&quot;
          instead of a number that could identify someone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {rows.map((row) => (
            <li key={row.departmentId ?? "none"} className="flex items-center justify-between gap-2 py-2">
              <p className="text-sm text-charcoal-ink">{row.departmentName}</p>
              {row.suppressed ? (
                <Badge variant="grey">Too small to show</Badge>
              ) : (
                <p className="text-sm text-charcoal-ink/70">
                  {row.activated}/{row.eligible} activated
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
