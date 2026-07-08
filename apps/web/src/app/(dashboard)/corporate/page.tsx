import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ageFromDateOfBirth,
  createMlClientFromEnv,
  type CohortAnalyticsResponse,
  type CohortChronicCondition,
  type CohortMemberIn,
} from "@tarragon/shared";

const COHORT_CHRONIC_CONDITIONS: readonly CohortChronicCondition[] = ["hypertension", "diabetes"];

export default async function CorporatePage() {
  const profile = await getCurrentProfile();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  if (!profile?.organisation_id) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Corporate admin"
        comingUp={["Staff enrolment", "Workforce health — cohort risk distribution"]}
      />
    );
  }

  const analytics = await loadCohortAnalytics(profile.organisation_id);

  if (!analytics) {
    return (
      <DashboardPlaceholder
        greeting={greeting}
        roleLabel="Corporate admin"
        comingUp={[
          "Staff enrolment",
          "Workforce health — cohort risk distribution (no staff enrolled yet, or ML service unavailable)",
        ]}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{greeting}</h1>
        <p className="text-charcoal-ink/60">Corporate admin dashboard</p>
      </div>
      <CohortSummary analytics={analytics} />
    </div>
  );
}

async function loadCohortAnalytics(organisationId: string): Promise<CohortAnalyticsResponse | null> {
  const supabase = await createClient();

  const { data: patients } = await supabase
    .from("profiles")
    .select("id, sex, date_of_birth")
    .eq("organisation_id", organisationId)
    .eq("role", "patient");
  if (!patients || patients.length === 0) return null;

  const patientIds = patients.map((p) => p.id);
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: riskScores }, { data: carePlans }, { data: schedules }, { data: screeningResults }] =
    await Promise.all([
      supabase
        .from("patient_risk_scores")
        .select("patient_id, score_type, score, risk_level, inputs, computed_at")
        .in("patient_id", patientIds)
        .order("computed_at", { ascending: false }),
      supabase
        .from("care_plans")
        .select("patient_id, condition")
        .in("patient_id", patientIds)
        .eq("status", "active"),
      supabase
        .from("screening_schedules")
        .select("patient_id, due_date, status")
        .in("patient_id", patientIds)
        .in("status", ["pending", "booked"]),
      supabase
        .from("screening_results")
        .select("patient_id, abnormal_flags, result_status")
        .in("patient_id", patientIds)
        .in("result_status", ["abnormal", "critical"]),
    ]);

  const latestCvdByPatient = new Map<string, { score: number; risk_level: string }>();
  const latestBpControlByPatient = new Map<string, number>();
  const latestHba1cTrendByPatient = new Map<string, string>();
  for (const row of riskScores ?? []) {
    if (row.score_type === "cvd_10yr" && !latestCvdByPatient.has(row.patient_id) && row.score !== null) {
      latestCvdByPatient.set(row.patient_id, { score: row.score, risk_level: row.risk_level ?? "low" });
    }
    if (row.score_type === "bp_control" && !latestBpControlByPatient.has(row.patient_id) && row.score !== null) {
      latestBpControlByPatient.set(row.patient_id, row.score);
    }
    if (row.score_type === "hba1c_trajectory" && !latestHba1cTrendByPatient.has(row.patient_id)) {
      const trend = (row.inputs as { trend?: string } | null)?.trend;
      if (trend) latestHba1cTrendByPatient.set(row.patient_id, trend);
    }
  }

  const conditionsByPatient = new Map<string, Set<CohortChronicCondition>>();
  for (const row of carePlans ?? []) {
    if (!COHORT_CHRONIC_CONDITIONS.includes(row.condition as CohortChronicCondition)) continue;
    const set = conditionsByPatient.get(row.patient_id) ?? new Set();
    set.add(row.condition as CohortChronicCondition);
    conditionsByPatient.set(row.patient_id, set);
  }

  const overdueCountByPatient = new Map<string, number>();
  for (const row of schedules ?? []) {
    if (row.due_date >= today) continue;
    overdueCountByPatient.set(row.patient_id, (overdueCountByPatient.get(row.patient_id) ?? 0) + 1);
  }

  const flagsByPatient = new Map<string, Set<string>>();
  for (const row of screeningResults ?? []) {
    const set = flagsByPatient.get(row.patient_id) ?? new Set<string>();
    for (const flag of row.abnormal_flags) set.add(flag);
    flagsByPatient.set(row.patient_id, set);
  }

  const members: CohortMemberIn[] = patients
    .filter((p) => p.sex && p.date_of_birth)
    .map((p) => ({
      age: ageFromDateOfBirth(p.date_of_birth) ?? 0,
      sex: p.sex!,
      chronic_conditions: [...(conditionsByPatient.get(p.id) ?? [])],
      cvd_risk_10yr_percent: latestCvdByPatient.get(p.id)?.score ?? null,
      cvd_risk_level: (latestCvdByPatient.get(p.id)?.risk_level as CohortMemberIn["cvd_risk_level"]) ?? null,
      hba1c_trend: (latestHba1cTrendByPatient.get(p.id) as CohortMemberIn["hba1c_trend"]) ?? null,
      bp_control_rate_percent: latestBpControlByPatient.get(p.id) ?? null,
      screening_overdue_count: overdueCountByPatient.get(p.id) ?? 0,
      abnormal_flags: [...(flagsByPatient.get(p.id) ?? [])],
    }));
  if (members.length === 0) return null;

  const mlClient = createMlClientFromEnv();
  if (!mlClient) return null;

  return mlClient.analyseCohort({ members });
}

function CohortSummary({ analytics }: { analytics: CohortAnalyticsResponse }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Workforce overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-charcoal-ink/80">
          <p>Cohort size: {analytics.cohort_size}</p>
          <p>Average age: {analytics.age_mean}</p>
          <p>
            Sex: {analytics.sex_distribution.male ?? 0} male / {analytics.sex_distribution.female ?? 0}{" "}
            female
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chronic condition prevalence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-charcoal-ink/80">
          {Object.entries(analytics.chronic_condition_prevalence_percent).map(([condition, pct]) => (
            <p key={condition}>
              {condition}: {pct}%
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CVD risk distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-charcoal-ink/80">
          {Object.entries(analytics.cvd_risk_level_distribution).map(([level, count]) => (
            <p key={level}>
              {level}: {count}
            </p>
          ))}
          {analytics.cvd_risk_mean_percent !== null && (
            <p>Mean 10yr CVD risk: {analytics.cvd_risk_mean_percent}%</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Screening compliance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-charcoal-ink/80">
          <p>Overdue rate: {analytics.screening_overdue_rate_percent}%</p>
          <p>Abnormal findings (anonymised): {analytics.abnormal_findings_count}</p>
          {analytics.top_abnormal_flags.length > 0 && (
            <ul className="list-inside list-disc pt-1">
              {analytics.top_abnormal_flags.map(({ flag, count }) => (
                <li key={flag}>
                  {flag}: {count}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
