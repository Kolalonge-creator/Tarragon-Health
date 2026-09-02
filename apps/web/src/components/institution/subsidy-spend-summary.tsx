import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { koboToNaira } from "@tarragon/shared";

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString()}`;

type InstitutionSubsidySummary =
  | { suppressed: true; min_cohort_size: number; note: string }
  | {
      suppressed: false;
      min_cohort_size: number;
      total_sponsor_paid_kobo: number;
      claim_count: number;
      category_breakdown: { category_label: string; sponsor_paid_kobo: number; claim_count: number }[];
    };

/**
 * §91.9 institution-facing view of what this employer/HMO has subsidized for
 * its people — deliberately aggregate-only, forever (I9). This calls
 * public.institution_subsidy_summary, which re-checks
 * private.can_manage_employer(organisationId) itself and applies the same
 * small-cell suppression as public.payer_dashboard_analytics — so even a
 * caller who reaches this component with the wrong organisationId gets
 * nothing beyond what that RPC would have refused directly.
 *
 * No per-patient row is ever fetched, requested, or renderable here — the
 * category breakdown is a label and a total, matching the platform's
 * standing rule that only a superadmin may ever drill into an individual.
 */
export async function SubsidySpendSummary({ organisationId }: { organisationId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("institution_subsidy_summary", {
    p_organisation_id: organisationId,
  });

  if (error || !data) {
    return null;
  }

  const summary = data as InstitutionSubsidySummary;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Care you&apos;ve helped fund</CardTitle>
        <CardDescription>
          Totals only — the same platform-wide rule that keeps your other reporting aggregate-only
          applies here too.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {summary.suppressed ? (
          <p className="text-sm text-charcoal-ink/60">{summary.note}</p>
        ) : summary.claim_count === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing subsidized yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="font-heading text-2xl font-semibold text-charcoal-ink">
                  {naira(summary.total_sponsor_paid_kobo)}
                </p>
                <p className="text-sm text-charcoal-ink/60">total you&apos;ve contributed</p>
              </div>
              <div>
                <p className="font-heading text-2xl font-semibold text-charcoal-ink">
                  {summary.claim_count}
                </p>
                <p className="text-sm text-charcoal-ink/60">
                  {summary.claim_count === 1 ? "person helped" : "people helped"}
                </p>
              </div>
            </div>
            <ul className="divide-y divide-charcoal-ink/10">
              {summary.category_breakdown.map((row) => (
                <li key={row.category_label} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-charcoal-ink/80">
                    {row.category_label} · {row.claim_count}
                  </span>
                  <span className="font-medium text-charcoal-ink">{naira(row.sponsor_paid_kobo)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
