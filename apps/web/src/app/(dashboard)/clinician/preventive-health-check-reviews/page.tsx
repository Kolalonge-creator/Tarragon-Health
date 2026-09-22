import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Patients who have paid for a Preventive Health Check Review and are
 * waiting on a doctor's written plan — see
 * 20260922185300_preventive_health_check_review_sku.sql.
 *
 * Before this page existed, nothing surfaced "a patient is waiting on
 * this": a doctor could only reach the review step by already knowing the
 * patientId and navigating straight to /clinician/patients/[patientId],
 * where the actual review control lives (health-check-review.tsx /
 * completeHealthCheckReview) — deliberately reused rather than duplicated
 * here, per CLAUDE.md's rule against rebuilding a parallel review record.
 * This page is only the missing "who is waiting" list; every row links
 * straight to that existing per-patient page to do the actual work.
 *
 * RLS (annual_health_checks_select: patient_id = auth.uid() OR
 * private.is_org_staff(organisation_id)) already scopes this to the
 * caller's own organisation — no extra filtering needed here.
 */
export default async function PreventiveHealthCheckReviewsPage() {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("annual_health_checks")
    .select(
      "patient_id, year, review_requested_at, patient:profiles!annual_health_checks_patient_id_fkey(full_name, patient_number)"
    )
    .not("review_requested_at", "is", null)
    .is("reviewed_at", null)
    .order("review_requested_at", { ascending: true });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preventive Health Check reviews"
        description="Patients who paid for a doctor's written plan on this year's Health Check, waiting for one. Each opens the patient's own Health Check review control."
      />
      <Card>
        <CardContent className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 py-0">
          {error && (
            <p className="py-4 text-sm text-red-600 dark:text-red-300">
              Could not load this worklist: {error.message}
            </p>
          )}
          {!error && (rows ?? []).length === 0 && (
            <p className="py-4 text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              Nothing waiting right now.
            </p>
          )}
          {(rows ?? []).map((row) => (
            <div
              key={`${row.patient_id}-${row.year}`}
              className="flex items-center justify-between gap-3 py-3 first:pt-4 last:pb-4"
            >
              <div>
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                  {row.patient?.full_name ?? "Patient"}
                  {row.patient?.patient_number ? ` · ${row.patient.patient_number}` : ""}
                </p>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {row.year} check · requested{" "}
                  {row.review_requested_at
                    ? new Date(row.review_requested_at).toLocaleDateString("en-GB", {
                        timeZone: "Africa/Lagos",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </p>
              </div>
              <Link
                href={`/clinician/patients/${row.patient_id}`}
                className="text-sm text-brand-green dark:text-brand-green-bright hover:underline"
              >
                Open →
              </Link>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
