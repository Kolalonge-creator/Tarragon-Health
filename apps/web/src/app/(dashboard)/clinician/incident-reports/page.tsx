import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { IncidentReportsManager, type IncidentReportRow } from "./incident-reports-manager";

// Kept as its own literal rather than importing the manager's copy: a value
// exported from a "use client" module becomes a client reference when
// imported into a Server Component, which breaks supabase-js's own
// `.select()` string handling.
const INCIDENT_REPORT_SELECT =
  "*, patient:profiles!clinical_incident_reports_patient_id_fkey(full_name), reporter:profiles!clinical_incident_reports_reported_by_fkey(full_name), reviewer:clinical_staff!clinical_incident_reports_reviewed_by_staff_fkey(full_name), closer:clinical_staff!clinical_incident_reports_closed_by_staff_fkey(full_name)";

/**
 * Clinical incident / near-miss log (clinical_incident_reports, 20260826225518)
 * — Clinical Tier Ladder's Tier 3 standing QA/spot-audit responsibility. The
 * table shipped with full RLS and a governed status workflow but no UI
 * anywhere to actually file or review a report. Any org staff member
 * (including a Care Coordinator) may file one and see the org's log; moving a
 * report into review or closing it is a clinical act, gated here to
 * isClinicalTier for a friendly early message — the DB trigger
 * (private.enforce_clinical_incident_report_attribution) is the real
 * enforcement boundary, same pattern as lifestyle-reviews/escalations.
 * RLS (private.is_org_staff) is what scopes the list to one organisation, so
 * no explicit organisation_id filter is needed on the query.
 */
export default async function IncidentReportsPage() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [staff, { data: profile }, { data: reportRows }, { data: patientRows }] = await Promise.all([
    getCurrentClinicalStaff(),
    supabase.from("profiles").select("organisation_id").eq("id", user.id).single(),
    supabase
      .from("clinical_incident_reports")
      .select(INCIDENT_REPORT_SELECT)
      .order("reported_at", { ascending: false }),
    // Capped at 200 for client-side search, same tradeoff as the lab-liaison
    // patient picker — a large org would move this to server-side search.
    supabase
      .from("profiles")
      .select("id, full_name, patient_number, phone")
      .eq("role", "patient")
      .order("full_name", { ascending: true })
      .limit(200),
  ]);

  if (!profile?.organisation_id) redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Incident &amp; near-miss reports
        </h1>
        <p className="text-charcoal-ink/60">
          File a report the moment you notice something that went wrong or nearly did — a
          medication error, a missed escalation, an AI recommendation that looked off, a protocol
          deviation. Anyone on the care team can file one; a clinical-tier doctor reviews and
          closes it.
        </p>
      </div>
      <IncidentReportsManager
        organisationId={profile.organisation_id}
        initialReports={(reportRows ?? []) as IncidentReportRow[]}
        canReview={isClinicalTier(staff)}
        patients={(patientRows ?? []).map((p) => ({
          id: p.id,
          fullName: p.full_name,
          patientNumber: p.patient_number,
          phone: p.phone,
        }))}
      />
    </div>
  );
}
