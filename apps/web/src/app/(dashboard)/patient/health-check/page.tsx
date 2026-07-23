import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MentalHealthScreenForm } from "../mental-health-form";
import { MentalHealthSummary } from "@/components/mental-health-summary";
import { AnnualHealthCheckBooking } from "../annual-health-check-booking";

/**
 * The Health Check — Tarragon's guided preventive journey (AHC pathway §5:
 * Prepare → Measure → Screen → Review → Act). It COMPOSES the surfaces that
 * already own each stage (risk profile, vitals, screening calendar,
 * vaccination registry) rather than rebuilding them, tracked on the
 * annual_health_checks row. Open to everyone — the prevention front door,
 * distinct from the paid Annual Review.
 */
export default async function HealthCheckPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  // Ensure this year's check row exists (caller-scoped, idempotent).
  await supabase.rpc("open_health_check");

  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01T00:00:00.000Z`;

  const [
    { count: riskCount },
    { count: wellbeingCount },
    { count: vitalsCount },
    { count: screeningsDue },
    { data: check },
  ] = await Promise.all([
    supabase
      .from("prevention_risk_scores")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profile.id),
    supabase
      .from("mental_health_screens")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", profile.id)
      .gte("created_at", yearStart),
    supabase
      .from("vitals_readings")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", profile.id)
      .gte("taken_at", yearStart),
    supabase
      .from("screening_schedules")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", profile.id)
      .in("status", ["pending", "overdue"]),
    supabase
      .from("annual_health_checks")
      .select("reviewed_at, reviewed_by, review_summary, status")
      .eq("patient_id", profile.id)
      .eq("year", year)
      .maybeSingle(),
  ]);

  let reviewerName: string | null = null;
  if (check?.reviewed_by) {
    const { data: reviewer } = await supabase
      .from("clinical_staff")
      .select("full_name")
      .eq("id", check.reviewed_by)
      .maybeSingle();
    reviewerName = reviewer?.full_name ? `Dr. ${reviewer.full_name}` : null;
  }

  const stages = [
    {
      title: "1. Your health profile",
      done: (riskCount ?? 0) > 0,
      doneLabel: "Completed",
      toDoLabel: "Tell us your history and lifestyle",
      href: "/patient/prevention#risk-assessment",
    },
    {
      title: "2. Mental wellbeing",
      done: (wellbeingCount ?? 0) > 0,
      doneLabel: "Checked in this year",
      toDoLabel: "A quick, private wellbeing check-in",
      href: null,
    },
    {
      title: "3. Your measurements",
      done: (vitalsCount ?? 0) > 0,
      doneLabel: "Readings logged this year",
      toDoLabel: "Log blood pressure, weight, waist",
      href: "/patient#vitals",
    },
    {
      title: "4. Screenings",
      done: (screeningsDue ?? 0) === 0,
      doneLabel: "Up to date",
      toDoLabel: `${screeningsDue ?? 0} screening${(screeningsDue ?? 0) === 1 ? "" : "s"} due — book now`,
      href: "/patient/prevention#screenings",
    },
    {
      title: "5. Immunisations",
      done: false,
      doneLabel: "",
      toDoLabel: "Review the vaccines you're due",
      href: "/patient/prevention#vaccinations",
      neutral: true as const,
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Your Health Check</h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          A yearly, whole-body check — the right checks for you, and a plan to keep you well.
          Work through each step; your care team reviews everything at the end.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your {year} check</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-charcoal-ink/10">
          {stages.map((stage) => (
            <div key={stage.title} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-charcoal-ink">{stage.title}</p>
                <p className="text-xs text-charcoal-ink/60">
                  {stage.done ? stage.doneLabel : stage.toDoLabel}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!("neutral" in stage) && (
                  <Badge variant={stage.done ? "green" : "amber"}>{stage.done ? "Done" : "To do"}</Badge>
                )}
                {stage.href && (
                  <Link href={stage.href} className="text-sm text-brand-green hover:underline">
                    Open →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* The one-off lab bundle that powers stage 4 — bookable here directly,
          on any plan (the self_bookable exception, migration 20260723150205). */}
      <AnnualHealthCheckBooking
        patientId={profile.id}
        organisationId={profile.organisation_id}
        patientLocation={{ state: profile.state, city: profile.city, area: profile.area }}
        sex={profile.sex}
      />

      {/* Review & communicate — the doctor's stage. Null-gated attribution. */}
      <Card variant={check?.reviewed_at ? "soft" : "default"}>
        <CardHeader>
          <CardTitle className="text-base">Review &amp; communicate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {check?.reviewed_at ? (
            <>
              <p className="text-charcoal-ink/80">
                Completed{reviewerName ? ` · Reviewed by ${reviewerName}` : " · Reviewed by your care team"} ·{" "}
                {new Date(check.reviewed_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
              {check.review_summary && <p className="text-charcoal-ink/70">{check.review_summary}</p>}
              <p>
                <a
                  href="/api/patient/health-check/report"
                  className="text-brand-green hover:underline"
                >
                  Download your Health Check report (PDF) →
                </a>
              </p>
            </>
          ) : (
            <p className="text-charcoal-ink/60">
              Once your checks are in, a doctor reviews everything and shares your results and plan.
            </p>
          )}
        </CardContent>
      </Card>

      <MentalHealthSummary patientId={profile.id} />

      <div>
        <h2 className="mb-2 font-heading text-lg font-semibold text-charcoal-ink">Mental wellbeing check-in</h2>
        <MentalHealthScreenForm patientId={profile.id} />
      </div>
    </div>
  );
}
