import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FertilityRequestStatusForm } from "./fertility-request-status-form";

/**
 * Clinician-facing read model for the Women's Health platform (§44) — the
 * counterpart to the patient's own /patient/womens-health page. Read-only
 * except for progressing a fertility_assessment_requests row (the one place
 * this pathway is deliberately staff-gated, see the migration's RLS notes).
 * Everything else already surfaces where a clinician already looks: pattern
 * alerts (menstrual/breast/menopause) land in the existing clinician_alerts
 * inbox, not duplicated here.
 */
export async function WomensHealthPanel({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  const [
    { data: pregnancy },
    { data: antenatalVisits },
    { data: cycleLogs },
    { data: postnatalProfiles },
    { data: breastReports },
    { data: menopauseLogs },
    { data: fertilityRequests },
  ] = await Promise.all([
    supabase
      .from("patient_pregnancy")
      .select("is_pregnant, estimated_due_date, last_menstrual_period_date, high_risk, high_risk_notes")
      .eq("patient_id", patientId)
      .maybeSingle(),
    supabase
      .from("antenatal_visits")
      .select("id, visit_number, gestational_week_at_visit, status, findings")
      .eq("patient_id", patientId)
      .order("gestational_week_at_visit", { ascending: true }),
    supabase
      .from("menstrual_cycle_logs")
      .select("id, period_start_date, flow_level, pain_level")
      .eq("patient_id", patientId)
      .order("period_start_date", { ascending: false })
      .limit(5),
    supabase
      .from("postnatal_profiles")
      .select("id, delivery_date, delivery_mode, complications")
      .eq("patient_id", patientId)
      .order("delivery_date", { ascending: false }),
    supabase
      .from("breast_symptom_reports")
      .select("id, created_at, symptom_types, laterality")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("menopause_symptom_logs")
      .select("id, logged_at, symptom_types, severity, postmenopausal_bleeding")
      .eq("patient_id", patientId)
      .order("logged_at", { ascending: false })
      .limit(5),
    supabase
      .from("fertility_assessment_requests")
      .select("id, created_at, trying_duration_months, concern_notes, status")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false }),
  ]);

  const hasAnyData =
    pregnancy?.is_pregnant ||
    (antenatalVisits?.length ?? 0) > 0 ||
    (cycleLogs?.length ?? 0) > 0 ||
    (postnatalProfiles?.length ?? 0) > 0 ||
    (breastReports?.length ?? 0) > 0 ||
    (menopauseLogs?.length ?? 0) > 0 ||
    (fertilityRequests?.length ?? 0) > 0;

  if (!hasAnyData) {
    return <p className="text-sm text-charcoal-ink/60">No Women&apos;s Health data recorded yet.</p>;
  }

  return (
    <div className="space-y-4">
      {pregnancy?.is_pregnant && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pregnancy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              LMP: {pregnancy.last_menstrual_period_date ?? "not recorded"} · EDD:{" "}
              {pregnancy.estimated_due_date ?? "not recorded"}
              {pregnancy.high_risk && <span className="ml-2 font-medium text-amber-700">High risk</span>}
            </p>
            {pregnancy.high_risk_notes && <p className="text-charcoal-ink/70">{pregnancy.high_risk_notes}</p>}
            {antenatalVisits && antenatalVisits.length > 0 && (
              <ul className="space-y-1">
                {antenatalVisits.map((v) => (
                  <li key={v.id}>
                    {v.gestational_week_at_visit != null ? `Week ${v.gestational_week_at_visit}` : `Visit ${v.visit_number}`}
                    {" — "}
                    {v.status}
                    {v.findings ? `: ${v.findings}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {cycleLogs && cycleLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent menstrual cycle logs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {cycleLogs.map((log) => (
              <p key={log.id}>
                {log.period_start_date}
                {log.flow_level ? ` · ${log.flow_level} flow` : ""}
                {log.pain_level != null ? ` · pain ${log.pain_level}/10` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {postnatalProfiles && postnatalProfiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Postnatal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {postnatalProfiles.map((p) => (
              <p key={p.id}>
                Delivered {p.delivery_date} ({p.delivery_mode})
                {p.complications ? ` — ${p.complications}` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {breastReports && breastReports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Breast symptom reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {breastReports.map((r) => (
              <p key={r.id}>
                {new Date(r.created_at).toLocaleDateString()} — {r.symptom_types.join(", ")}
                {r.laterality ? ` (${r.laterality})` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {menopauseLogs && menopauseLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Menopause symptom logs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {menopauseLogs.map((log) => (
              <p key={log.id}>
                {log.logged_at} — {log.symptom_types.join(", ") || "no symptoms"}
                {log.severity != null ? ` (severity ${log.severity}/10)` : ""}
                {log.postmenopausal_bleeding ? " · bleeding reported" : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {fertilityRequests && fertilityRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fertility assessment requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {fertilityRequests.map((r) => (
              <div key={r.id} className="rounded-md border border-charcoal-ink/10 p-2.5">
                <p>
                  {new Date(r.created_at).toLocaleDateString()}
                  {r.trying_duration_months != null ? ` · trying ${r.trying_duration_months} months` : ""}
                </p>
                {r.concern_notes && <p className="text-charcoal-ink/70">{r.concern_notes}</p>}
                <FertilityRequestStatusForm requestId={r.id} currentStatus={r.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
