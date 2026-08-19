import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { MentalHealthScreenForm } from "../mental-health-form";
import { MentalHealthSummary } from "@/components/mental-health-summary";
import { AnnualHealthCheckBooking } from "../annual-health-check-booking";
import { LipidProfileCard } from "@/components/patient/lipid-profile-card";
import { RiskSignalsCard } from "../risk-signals-card";

/**
 * Stage 3 ("Your measurements") requires a real spread of readings taken
 * SINCE this year's check opened, not just any one reading ever logged —
 * a single stray blood-pressure log from January shouldn't tick the box for
 * a check opened in July. Two BP readings (the platform's own rest-interval
 * convention elsewhere) plus one each of weight/waist/pulse.
 */
const REQUIRED_SINGLE_VITALS = ["weight", "waist_circumference", "pulse"] as const;
const MIN_BP_READINGS = 2;
const VITAL_LABEL: Record<string, string> = {
  blood_pressure: "blood pressure",
  weight: "weight",
  waist_circumference: "waist circumference",
  pulse: "pulse",
};

export default async function HealthCheckPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  // Ensure this year's check row exists (caller-scoped, idempotent).
  await supabase.rpc("open_health_check");

  // Same gate as the prevention hub: the curated Screen ladder is a paid-plan
  // feature. Uploading a result and having a doctor read it never is.
  const { data: labCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "lab_coordination",
  });
  const { data: preventionCoordinationEnabled } = await supabase.rpc("has_feature_access", {
    feature: "prevention_coordination",
  });
  const screensEnabled =
    (labCoordinationEnabled ?? false) || (preventionCoordinationEnabled ?? false);

  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01T00:00:00.000Z`;

  const { data: check } = await supabase
    .from("annual_health_checks")
    .select(
      "created_at, reviewed_at, reviewed_by, review_summary, status, lab_order_id, lab_order:lab_orders!annual_health_checks_lab_order_id_fkey(panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name))"
    )
    .eq("patient_id", profile.id)
    .eq("year", year)
    .maybeSingle();

  // Vitals only count toward THIS check once it's genuinely open — a reading
  // logged in January doesn't retroactively complete a check opened in July.
  const vitalsWindowStart = check?.created_at ?? yearStart;

  const [
    { count: riskCount },
    { count: wellbeingCount },
    { data: vitalsRows },
    { count: screeningsDue },
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
      .select("vital_type")
      .eq("patient_id", profile.id)
      .gte("taken_at", vitalsWindowStart),
    supabase
      .from("screening_schedules")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", profile.id)
      .in("status", ["pending", "overdue"]),
  ]);

  const vitalTypeCounts = (vitalsRows ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.vital_type] = (acc[row.vital_type] ?? 0) + 1;
    return acc;
  }, {});
  const bpCount = vitalTypeCounts.blood_pressure ?? 0;
  const missingVitalKinds = [
    ...(bpCount < MIN_BP_READINGS ? ["blood_pressure"] : []),
    ...REQUIRED_SINGLE_VITALS.filter((kind) => (vitalTypeCounts[kind] ?? 0) < 1),
  ];
  const vitalsComplete = missingVitalKinds.length === 0;

  let reviewerName: string | null = null;
  if (check?.reviewed_by) {
    const { data: reviewer } = await supabase
      .from("clinical_staff")
      .select("full_name")
      .eq("id", check.reviewed_by)
      .maybeSingle();
    reviewerName = reviewer?.full_name ? `Dr. ${reviewer.full_name}` : null;
  }

  const tierName = check?.lab_order?.panel_bundle?.name ?? null;

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
      done: vitalsComplete,
      doneLabel: "All readings logged for this check",
      toDoLabel:
        missingVitalKinds.length === 0
          ? "Log blood pressure (×2), weight, waist and pulse"
          : `Still need: ${missingVitalKinds
              .map((kind) =>
                kind === "blood_pressure"
                  ? `blood pressure (${bpCount}/${MIN_BP_READINGS})`
                  : VITAL_LABEL[kind]
              )
              .join(", ")}`,
      href: "/patient/vitals",
    },
    {
      title: "4. Screenings",
      done: (screeningsDue ?? 0) === 0,
      doneLabel: "Up to date",
      toDoLabel: `${screeningsDue ?? 0} screening${(screeningsDue ?? 0) === 1 ? "" : "s"} due, book now`,
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
    <div className="space-y-6">
      <div className="space-y-2">
        <PageHeader
          title="Your Health Check"
          icon={NAV_ICON.review}
          backTo={{ href: "/patient/prevention", label: "Prevention" }}
          description="A yearly, whole-body check: the right checks for you, and a plan to keep you well. Work through each step; your care team reviews everything at the end."
        />
        {tierName && (
          <p className="text-sm text-charcoal-ink/70">
            You&apos;re completing the <span className="font-medium">{tierName}</span> this year.
          </p>
        )}
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

      {/* The lab tests that power stage 4. Self-arranged: we write the request,
          the patient uses any lab, and uploads the result back here. */}
      <AnnualHealthCheckBooking
        patientId={profile.id}
        organisationId={profile.organisation_id}
        sex={profile.sex}
        screensEnabled={screensEnabled}
      />

      {/* Lipid results + the CV-risk gloss they feed — both self-hide until
          there's real data, so nothing renders until a lipid panel lands. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <LipidProfileCard patientId={profile.id} />
        <RiskSignalsCard patientId={profile.id} />
      </div>

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
