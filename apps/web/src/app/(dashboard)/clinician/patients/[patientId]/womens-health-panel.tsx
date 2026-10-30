import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FertilityRequestStatusForm } from "./fertility-request-status-form";
import { CyclePatternReportPanel } from "./cycle-pattern-report";
import { loadWomensHealthRecord, womensHealthRecordIsEmpty } from "@/lib/womens-health/staff-record-read";

/**
 * Clinician-facing read model for the Women's Health platform (§44) — the
 * counterpart to the patient's own /patient/womens-health page. Read-only
 * except for progressing a fertility_assessment_requests row (the one place
 * this pathway is deliberately staff-gated, see the migration's RLS notes).
 * Everything else already surfaces where a clinician already looks: pattern
 * alerts (breast/menopause) land in the existing clinician_alerts inbox, not
 * duplicated here. Menstrual cycle history reads from the dedicated tracker's
 * own tables (menstrual_cycles) — org staff get read-only access there too,
 * see 20260902195456_menstrual_cycle_tracking.sql. Its own clinical flags
 * (postmenopausal bleeding, prolonged/heavy bleeding, amenorrhoea) are
 * deliberately a patient-facing, human-read prompt rather than a
 * clinician_alerts row — see that migration's notes.
 */
export async function WomensHealthPanel({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  // OQ-555 (INV-10, INV-12): all five record kinds come from ONE audited, tied function. The clinician types no reason (OQ-558). A refusal and a failed
  // read are shown as what they are, never as an empty record: "nothing recorded" for a pregnancy that was not shown is a wrong decision.
  const outcome = await loadWomensHealthRecord(supabase, patientId);

  if (outcome.kind === "denied") {
    return (
      <Card variant="soft">
        <CardContent className="py-4 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          You cannot open this patient&apos;s Women&apos;s Health record. It is available to the clinician looking after the patient, and the attempt has been recorded.
        </CardContent>
      </Card>
    );
  }
  if (outcome.kind === "error") {
    return (
      <div className="space-y-4">
        <Card variant="soft">
          <CardContent role="alert" className="py-4 text-sm text-red-700 dark:text-red-300">
            The Women&apos;s Health record could not be loaded just now. This is not the same as there being nothing recorded. Please refresh and try again.
          </CardContent>
        </Card>
        {/* The cycle and menopause report is its own audited read with its own states, so a failure of the record read does not hide it. */}
        <CyclePatternReportPanel patientId={patientId} />
      </div>
    );
  }

  const { pregnancy, antenatal_visits: antenatalVisits, postnatal_profiles: postnatalProfiles, breast_reports: breastReports, fertility_requests: fertilityRequests } =
    outcome.record;

  // S66: the cycle and menopause report is always rendered (it says for itself when it is closed, refused, failed or empty), so the
  // "nothing recorded" shortcut only applies to the other sections.
  const otherSections = !womensHealthRecordIsEmpty(outcome.record);
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
                    {", "}
                    {v.status}
                    {v.findings ? `: ${v.findings}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {!otherSections && <p className="text-sm text-charcoal-ink/60">No other Women&apos;s Health data recorded yet.</p>}
      {/* S66 (INV-10, INV-12): cycle and menopause history is read ONLY through the audited report function, never straight from the tables. */}
      <CyclePatternReportPanel patientId={patientId} />

      {postnatalProfiles && postnatalProfiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Postnatal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {postnatalProfiles.map((p) => (
              <p key={p.id}>
                Delivered {p.delivery_date} ({p.delivery_mode})
                {p.complications ? ` (${p.complications})` : ""}
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
                {new Date(r.created_at).toLocaleDateString()}: {r.symptom_types.join(", ")}
                {r.laterality ? ` (${r.laterality})` : ""}
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
